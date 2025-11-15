import { WebSocketServer } from "ws";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import { BrokerManager } from "./core/BrokerManager.js";
import { ClientConnection } from "./core/ClientConnection.js";
import { MarketData, ServerConfig, Timeframe } from "./types/index.js";
import { loadConfig } from "./utils/config.js";
import { testConnection, getPool } from "./utils/database.js";
import { MetadataService } from "./services/metadataService.js";
import { CandlesService } from "./services/candlesService.js";
import { TickBatcher } from "./services/tickBatcher.js";
import { schemas, validateQuery, sanitizeSymbol, ApiError } from "./middleware/validation.js";
import { errorHandler, notFoundHandler, asyncHandler } from "./middleware/errorHandler.js";
import { apiLimiter, strictLimiter, healthLimiter } from "./middleware/rateLimiter.js";
import { CACHE_DURATIONS } from "./utils/constants.js";
import { createLogger } from "./utils/logger.js";
import { swaggerSpec } from "./config/swagger.js";
import swaggerUi from "swagger-ui-express";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const logger = createLogger();

class MarketDataServer {
  private app = express();
  private server = createServer(this.app);
  private wss = new WebSocketServer({ server: this.server });
  private brokerManager = new BrokerManager(logger);
  private clients = new Map<string, ClientConnection>();
  private config!: ServerConfig;
  private metadataService!: MetadataService;
  private candlesService!: CandlesService;
  private tickBatcher!: TickBatcher;

  async start(): Promise<void> {
    // Load configuration
    this.config = await loadConfig();

    // Test database connection
    try {
      await testConnection();
      logger.info('Database connection successful');
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to connect to database');
      process.exit(1);
    }

    // Initialize services
    const pool = getPool();
    this.metadataService = new MetadataService(pool);
    this.candlesService = new CandlesService(pool);
    this.tickBatcher = new TickBatcher({
      maxBatchSize: 1000,     // Upload after 1000 ticks
      maxBatchAgeMs: 5 * 60 * 1000  // Or after 5 minutes
    });
    logger.info('Services initialized');

    // Setup HTTP endpoints
    logger.info('Setting up HTTP endpoints');
    try {
      this.setupHttpEndpoints();
      logger.info('HTTP endpoints setup completed successfully');
    } catch (error) {
      logger.error({ err: error }, 'CRITICAL: HTTP endpoints setup failed');
      throw error;
    }

    // Initialize brokers
    await this.initializeBrokers();

    // Setup WebSocket server
    this.setupWebSocketServer();

    // Start server
    const port = this.config.server?.port || 8080;
    this.server.listen(port, () => {
      logger.info(`Market Data Server listening on port ${port}`);
    });
  }

  private setupHttpEndpoints(): void {
    try {
      logger.debug('Setting up HTTP endpoints');

      // Enable CORS with origin restrictions
      const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
        'http://localhost:3000',
        'http://localhost:5173'  // Vite default port
      ];

      this.app.use(cors({
        origin: (origin, callback) => {
          // Allow requests with no origin (like mobile apps, curl, Postman)
          if (!origin) return callback(null, true);

          // Check exact matches first
          if (allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
          }

          // Check wildcard patterns (e.g., https://*.vercel.app)
          const isAllowed = allowedOrigins.some(allowed => {
            if (allowed.includes('*')) {
              // Convert wildcard pattern to regex
              const pattern = allowed
                .replace(/\./g, '\\.')  // Escape dots
                .replace(/\*/g, '.*');   // Convert * to .*
              const regex = new RegExp(`^${pattern}$`);
              return regex.test(origin);
            }
            return false;
          });

          if (isAllowed) {
            callback(null, true);
          } else {
            logger.warn({ origin }, 'Blocked CORS request from unauthorized origin');
            callback(new Error('Not allowed by CORS'));
          }
        },
        credentials: true,
        methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
      }));

      // Parse JSON bodies
      this.app.use(express.json());

      // Swagger API Documentation
      this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'Market Data Server API Docs'
      }));
      logger.debug('Registered /api-docs route (Swagger UI)');

      // Health check endpoint with database connectivity check
      this.app.get("/health", healthLimiter, asyncHandler(async (_, res) => {
        try {
          // Check database connectivity
          const pool = getPool();
          await pool.query('SELECT 1');

          res.json({
            status: "healthy",
            database: "connected",
            clients: this.clients.size,
            uptime: process.uptime()
          });
        } catch (err) {
          logger.error({ err }, 'Health check failed - database unavailable');
          res.status(503).json({
            status: "unhealthy",
            database: "disconnected",
            clients: this.clients.size,
            uptime: process.uptime()
          });
        }
      }));
      logger.debug('Registered /health route');

      // Metrics endpoint
      this.app.get("/metrics", healthLimiter, (_, res) => {
        res.json({
          connections: this.clients.size,
          subscriptions: Array.from(this.clients.values())
            .reduce((acc, client) => acc + client.getSubscriptions().length, 0)
        });
      });
      logger.debug('Registered /metrics route');

      // Metadata API endpoint - discover available symbols and date ranges
      this.app.get("/api/metadata",
        apiLimiter,
        validateQuery(schemas.metadata),
        asyncHandler(async (req, res): Promise<void> => {
          const { symbol } = req.query;

          if (symbol) {
            // Get metadata for a specific symbol
            const normalizedSymbol = sanitizeSymbol(symbol as string);
            const metadata = await this.metadataService.getSymbolMetadata(normalizedSymbol);

            if (!metadata) {
              throw new ApiError(404, "Symbol not found", "SYMBOL_NOT_FOUND");
            }

            res.json(metadata);
          } else {
            // Get list of all available symbols
            const data = await this.metadataService.getAllSymbols();
            res.json(data);
          }
        })
      );
      logger.debug('Registered /api/metadata route');

      // Metadata API endpoint - path parameter version for compatibility
      this.app.get("/api/metadata/:symbol",
        apiLimiter,
        asyncHandler(async (req, res): Promise<void> => {
          const { symbol } = req.params;
          const normalizedSymbol = sanitizeSymbol(symbol);
          const metadata = await this.metadataService.getSymbolMetadata(normalizedSymbol);

          if (!metadata) {
            throw new ApiError(404, "Symbol not found", "SYMBOL_NOT_FOUND");
          }

          res.json(metadata);
        })
      );
      logger.debug('Registered /api/metadata/:symbol route');

      // Candles API endpoint
      this.app.get("/api/candles",
        strictLimiter,
        validateQuery(schemas.candles),
        asyncHandler(async (req, res): Promise<void> => {
          const { symbol, timeframe, from, to } = req.query as unknown as {
            symbol: string;
            timeframe: Timeframe;
            from: number;
            to: number;
          };

          // Normalize symbol format (remove slashes)
          const normalizedSymbol = sanitizeSymbol(symbol);

          // Check if symbol exists in database
          const symbolExists = await this.metadataService.symbolExists(normalizedSymbol);
          if (!symbolExists) {
            throw new ApiError(
              404,
              `Symbol '${normalizedSymbol}' not found in database`,
              'SYMBOL_NOT_FOUND'
            );
          }

          // Get available date range for this symbol
          const dateRange = await this.metadataService.getSymbolDateRange(normalizedSymbol);

          // Generate ETag for browser caching
          const cacheKey = `${normalizedSymbol}-${timeframe}-${from}-${to}`;
          const etag = crypto.createHash('md5').update(cacheKey).digest('hex');

          // Check if client has valid cache
          if (req.headers['if-none-match'] === etag) {
            res.status(304).end(); // Not Modified
            return;
          }

          // Fetch candles using service
          const candles = await this.candlesService.getCandles(
            normalizedSymbol,
            timeframe,
            from,
            to
          );

          // Set cache headers
          const cacheDuration = CACHE_DURATIONS[timeframe] || CACHE_DURATIONS.default;
          res.set({
            'Cache-Control': `public, max-age=${cacheDuration}`,
            'ETag': etag,
            'Vary': 'Accept-Encoding', // Important for CDNs
            'Last-Modified': new Date().toUTCString()
          });

          // Add helpful headers when no data is returned
          if (candles.length === 0 && dateRange) {
            res.set({
              'X-Data-Available': 'false',
              'X-Available-From': new Date(dateRange.earliest * 1000).toISOString(),
              'X-Available-To': new Date(dateRange.latest * 1000).toISOString(),
              'Warning': '199 - "No data available for requested date range. Check X-Available-From and X-Available-To headers for available data range."'
            });
          }

          res.json(candles);
        })
      );
      logger.debug('Registered /api/candles route');

      // Candles API endpoint - path parameter version for compatibility
      this.app.get("/api/candles/:symbol/:timeframe",
        strictLimiter,
        asyncHandler(async (req, res): Promise<void> => {
          const { symbol, timeframe } = req.params;
          const { from, to } = req.query as { from?: string; to?: string };

          // Validate required query parameters
          if (!from || !to) {
            throw new ApiError(
              400,
              "Missing required query parameters: 'from' and 'to' (Unix timestamps in seconds)",
              'MISSING_PARAMETERS'
            );
          }

          const normalizedSymbol = sanitizeSymbol(symbol);
          const fromTimestamp = parseInt(from);
          const toTimestamp = parseInt(to);

          // Validate timeframe
          if (!['1m', '5m', '15m', '1h', '4h', '12h'].includes(timeframe)) {
            throw new ApiError(
              400,
              `Invalid timeframe '${timeframe}'. Must be one of: 1m, 5m, 15m, 1h, 4h, 12h`,
              'INVALID_TIMEFRAME'
            );
          }

          // Check if symbol exists
          const symbolExists = await this.metadataService.symbolExists(normalizedSymbol);
          if (!symbolExists) {
            throw new ApiError(
              404,
              `Symbol '${normalizedSymbol}' not found in database`,
              'SYMBOL_NOT_FOUND'
            );
          }

          // Get available date range
          const dateRange = await this.metadataService.getSymbolDateRange(normalizedSymbol);

          // Generate ETag for caching
          const cacheKey = `${normalizedSymbol}-${timeframe}-${fromTimestamp}-${toTimestamp}`;
          const etag = crypto.createHash('md5').update(cacheKey).digest('hex');

          // Check client cache
          if (req.headers['if-none-match'] === etag) {
            res.status(304).end();
            return;
          }

          // Fetch candles
          const candles = await this.candlesService.getCandles(
            normalizedSymbol,
            timeframe as Timeframe,
            fromTimestamp,
            toTimestamp
          );

          // Set cache headers
          const cacheDuration = CACHE_DURATIONS[timeframe as Timeframe] || CACHE_DURATIONS.default;
          res.set({
            'Cache-Control': `public, max-age=${cacheDuration}`,
            'ETag': etag,
            'Vary': 'Accept-Encoding',
            'Last-Modified': new Date().toUTCString()
          });

          // Add helpful headers when no data
          if (candles.length === 0 && dateRange) {
            res.set({
              'X-Data-Available': 'false',
              'X-Available-From': new Date(dateRange.earliest * 1000).toISOString(),
              'X-Available-To': new Date(dateRange.latest * 1000).toISOString(),
              'Warning': '199 - "No data available for requested date range. Check X-Available-From and X-Available-To headers."'
            });
          }

          res.json(candles);
        })
      );
      logger.debug('Registered /api/candles/:symbol/:timeframe route');

      // Error handling middleware (must be last)
      this.app.use(notFoundHandler);
      this.app.use(errorHandler(logger));

      logger.debug('All HTTP endpoints setup complete');
    } catch (error) {
      logger.error({ err: error }, 'Error setting up HTTP endpoints');
      throw error;
    }
  }


  private async initializeBrokers(): Promise<void> {
    const brokers = this.config.brokers || [];

    logger.info({ brokerCount: brokers.length }, 'Initializing brokers');

    if (Array.isArray(brokers)) {
      for (const brokerConfig of brokers) {
        if (brokerConfig.enabled) {
          logger.info({ broker: brokerConfig.name }, 'Adding broker');
          await this.brokerManager.addBroker(brokerConfig);
        }
      }
    }

    // Listen for market data from all brokers
    this.brokerManager.on("data", (data: MarketData) => {
      // Broadcast to WebSocket clients
      this.broadcastToClients(data);

      // Batch ticks for R2 upload (if tick data)
      if (data.type === 'tick' && data.data.bid && data.data.ask && data.timestamp) {
        // Convert timestamp to Unix seconds if it's in milliseconds
        const timestampSeconds = data.timestamp > 1e12
          ? Math.floor(data.timestamp / 1000)
          : data.timestamp;

        this.tickBatcher.addTick(
          data.symbol,
          timestampSeconds,
          data.data.bid,
          data.data.ask
        ).catch(error => {
          logger.error({ error, symbol: data.symbol }, 'Failed to batch tick for R2');
        });
      }
    });
  }

  private setupWebSocketServer(): void {
    this.wss.on("connection", (ws) => {
      const clientId = this.generateClientId();
      const client = new ClientConnection(ws, clientId);
      
      this.clients.set(clientId, client);
      logger.info(`Client connected: ${clientId}`);
      
      // Handle client events
      client.on("subscribe", async (data) => {
        logger.info(`Client ${clientId} subscribing to:`, data);
        if (data.symbols && data.symbols.length > 0) {
          await this.brokerManager.subscribe(data.broker, data.symbols, clientId);
        }
      });

      client.on("unsubscribe", async (data) => {
        logger.info(`Client ${clientId} unsubscribing from:`, data.symbols);
        await this.brokerManager.unsubscribe(data.broker, data.symbols, clientId);
      });
      
      client.on("broker-auth", async (data) => {
        logger.info(`Client ${clientId} authenticating with ${data.broker}`);
        try {
          await this.brokerManager.addClientBroker(clientId, data.broker, data.credentials);
        } catch (error: any) {
          logger.error(`Failed to authenticate client ${clientId} with ${data.broker}:`, error.message);
          client.sendError(`Authentication failed: ${error.message}`);
        }
      });

      client.on("disconnect", (id) => {
        logger.info(`Client disconnected: ${id}`);
        this.clients.delete(id);
      });

      // Send welcome message
      client.sendStatus("Connected to Market Data Server");
    });
  }

  private broadcastToClients(data: MarketData): void {
    for (const client of this.clients.values()) {
      if (client.isAlive()) {
        client.sendData(data);
      }
    }
  }

  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  async stop(): Promise<void> {
    logger.info("Shutting down server...");

    // Flush any pending tick batches to R2
    if (this.tickBatcher) {
      await this.tickBatcher.stop();
    }

    // Disconnect all clients
    for (const client of this.clients.values()) {
      client.disconnect();
    }

    // Disconnect all brokers
    await this.brokerManager.disconnectAll();

    // Close server
    this.server.close();
  }
}

// Start server
const server = new MarketDataServer();
server.start().catch(console.error);

// Handle graceful shutdown
process.on("SIGINT", async () => {
  await server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.stop();
  process.exit(0);
});
