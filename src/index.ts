import { WebSocketServer } from "ws";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { BrokerManager } from "./streaming/BrokerManager.js";
import { ClientConnection } from "./streaming/ClientConnection.js";
import { MarketData, ServerConfig } from "./types/index.js";
import { loadConfig } from "./services/configLoader.js";
import { testConnection, getPool } from "./services/database.js";
import { MetadataService } from "./services/metadataService.js";
import { CandlesService } from "./services/candlesService.js";
import { TickBatcher } from "./services/tickBatcher.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { createLogger } from "./utils/logger.js";
import { swaggerSpec } from "./services/swagger.js";
import swaggerUi from "swagger-ui-express";
import dotenv from "dotenv";

// Import API layer
import { HealthController, MetadataController, CandlesController } from "./api/controllers/index.js";
import { createHealthRoutes, createMetadataRoutes, createCandlesRoutes } from "./api/routes/index.js";

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
    this.config = loadConfig();

    // Test database connection
    try {
      await testConnection();
      logger.info('Database connection successful');
    } catch (error) {
      logger.error({ err: error }, 'Failed to connect to database');
      process.exit(1);
    }

    // Initialize services
    const pool = getPool();
    this.metadataService = new MetadataService(pool);

    // Initialize CandlesService WITHOUT auto-materialization
    // Auto-materialization was causing 60s+ timeouts by downloading R2 data for every weekend
    // Data should already be in PostgreSQL - if missing, run materialization scripts manually
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
        'http://localhost:5173',  // Vite default port
        'http://localhost:1420'   // Tauri default port
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

      // Create controllers
      const pool = getPool();
      const healthController = new HealthController(
        pool,
        () => this.clients.size,
        () => Array.from(this.clients.values())
          .reduce((acc, client) => acc + client.getSubscriptions().length, 0)
      );
      const metadataController = new MetadataController(this.metadataService);
      const candlesController = new CandlesController(this.candlesService, this.metadataService);

      // Mount routes
      this.app.use(createHealthRoutes(healthController));
      this.app.use(createMetadataRoutes(metadataController));
      this.app.use(createCandlesRoutes(candlesController));

      logger.debug('Registered API routes via controllers');

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
      client.on("subscribe", (data) => {
        logger.info(`Client ${clientId} subscribing to:`, data);
        if (data.symbols && data.symbols.length > 0) {
          this.brokerManager.subscribe(data.broker, data.symbols, clientId).catch((err) => {
            logger.error({ err, clientId }, 'Subscribe failed');
          });
        }
      });

      client.on("unsubscribe", (data) => {
        logger.info(`Client ${clientId} unsubscribing from:`, data.symbols);
        this.brokerManager.unsubscribe(data.broker, data.symbols, clientId).catch((err) => {
          logger.error({ err, clientId }, 'Unsubscribe failed');
        });
      });

      client.on("broker-auth", (data) => {
        logger.info(`Client ${clientId} authenticating with ${data.broker}`);
        this.brokerManager.addClientBroker(clientId, data.broker, data.credentials).catch((err) => {
          const message = err instanceof Error ? err.message : 'Unknown error';
          logger.error({ err, clientId, broker: data.broker }, 'Authentication failed');
          client.sendError(`Authentication failed: ${message}`);
        });
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
process.on("SIGINT", () => {
  server.stop().then(() => process.exit(0)).catch(() => process.exit(1));
});

process.on("SIGTERM", () => {
  server.stop().then(() => process.exit(0)).catch(() => process.exit(1));
});
