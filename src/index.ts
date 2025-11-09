import { WebSocketServer } from "ws";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import { BrokerManager } from "./core/BrokerManager.js";
import { ClientConnection } from "./core/ClientConnection.js";
import { MarketData } from "./types/index.js";
import { loadConfig } from "./utils/config.js";
import { testConnection } from "./utils/database.js";
import pino from "pino";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

const logger = pino({
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true
    }
  }
});

class MarketDataServer {
  private app = express();
  private server = createServer(this.app);
  private wss = new WebSocketServer({ server: this.server });
  private brokerManager = new BrokerManager();
  private clients = new Map<string, ClientConnection>();
  private config: any;

  async start(): Promise<void> {
    // Load configuration
    this.config = await loadConfig();
    
    // Test database connection
    try {
      await testConnection();
    } catch (error: any) {
      logger.error('Failed to connect to database:', error);
      process.exit(1);
    }
    
    // Setup HTTP endpoints
    console.log('About to setup HTTP endpoints...');
    try {
      this.setupHttpEndpoints();
      console.log('HTTP endpoints setup completed successfully');
    } catch (error) {
      console.error('CRITICAL: HTTP endpoints setup failed:', error);
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

  private getCacheDuration(timeframe: string): number {
    switch(timeframe) {
      case '1m':
        return 60;    // 1 minute
      case '5m':
        return 300;   // 5 minutes
      case '15m':
        return 600;   // 10 minutes
      case '1h':
        return 1800;  // 30 minutes
      case '4h':
      case '12h':
        return 3600;  // 1 hour
      default:
        return 600;   // 10 minutes default
    }
  }

  private setupHttpEndpoints(): void {
    try {
      console.log('Setting up HTTP endpoints...');
      
      // Enable CORS for all routes
      this.app.use(cors());
      
      // Parse JSON bodies
      this.app.use(express.json());
      
      // Health check endpoint
      this.app.get("/health", (_, res) => {
        res.json({
          status: "healthy",
          clients: this.clients.size,
          uptime: process.uptime()
        });
      });
      console.log('✓ Registered /health route');

      // Metrics endpoint
      this.app.get("/metrics", (_, res) => {
        res.json({
          connections: this.clients.size,
          subscriptions: Array.from(this.clients.values())
            .reduce((acc, client) => acc + client.getSubscriptions().length, 0)
        });
      });
      console.log('✓ Registered /metrics route');

      // Candles API endpoint
      this.app.get("/api/candles", async (req, res): Promise<void> => {
        try {
          const { symbol, timeframe = '1h', from, to } = req.query;

          if (!symbol || !from || !to) {
            res.status(400).json({
              error: "Missing required parameters: symbol, from, to"
            });
            return;
          }

          // Normalize symbol format (remove slashes for database compatibility)
          const normalizedSymbol = (symbol as string).replace('/', '');

          // Generate a cache key for ETag
          const cacheKey = `${normalizedSymbol}-${timeframe}-${from}-${to}`;
          const etag = crypto.createHash('md5').update(cacheKey).digest('hex');

          // Check if client has valid cache
          if (req.headers['if-none-match'] === etag) {
            res.status(304).end(); // Not Modified
            return;
          }

          // Import database and execute query
          const { getPool } = await import("./utils/database.js");

          // Map timeframes to materialized view names
          const timeframeViewMap: Record<string, string> = {
            '5m': 'forex_candles_5m',
            '15m': 'forex_candles_15m',
            '1h': 'forex_candles_1h',
            '4h': 'forex_candles_4h',
            '12h': 'forex_candles_12h'
          };

          const pool = getPool();
          const viewName = timeframeViewMap[timeframe as string];

          let query: string;
          let queryParams: any[];

          if (viewName) {
            // Use materialized view for supported timeframes
            query = `
              SELECT
                EXTRACT(EPOCH FROM t_open)::bigint AS time,
                open,
                high,
                low,
                close
              FROM ${viewName}
              WHERE symbol = $1
                AND t_open >= to_timestamp($2)
                AND t_open <= to_timestamp($3)
              ORDER BY t_open ASC;
            `;
            queryParams = [
              normalizedSymbol,
              parseInt(from as string),
              parseInt(to as string)
            ];
          } else {
            // Fallback to raw ticks for unsupported timeframes (e.g., 1m)
            const timeframeMap: Record<string, string> = {
              '1m': '1 minute'
            };
            const interval = timeframeMap[timeframe as string] || '1 hour';

            query = `
              SELECT
                EXTRACT(EPOCH FROM time_bucket($1, time))::bigint AS time,
                (array_agg(mid_price ORDER BY time ASC))[1] AS open,
                MAX(mid_price) AS high,
                MIN(mid_price) AS low,
                (array_agg(mid_price ORDER BY time DESC))[1] AS close
              FROM forex_ticks
              WHERE symbol = $2
                AND time >= to_timestamp($3)
                AND time <= to_timestamp($4)
              GROUP BY time_bucket($1, time)
              ORDER BY time ASC;
            `;
            queryParams = [
              interval,
              normalizedSymbol,
              parseInt(from as string),
              parseInt(to as string)
            ];
          }

          const result = await pool.query(query, queryParams);
          
          const candles = result.rows.map(row => ({
            time: parseInt(row.time),
            open: parseFloat(parseFloat(row.open).toFixed(5)),
            high: parseFloat(parseFloat(row.high).toFixed(5)),
            low: parseFloat(parseFloat(row.low).toFixed(5)),
            close: parseFloat(parseFloat(row.close).toFixed(5))
          }));

          // Set cache headers
          res.set({
            'Cache-Control': `public, max-age=${this.getCacheDuration(timeframe as string)}`,
            'ETag': etag,
            'Vary': 'Accept-Encoding', // Important for CDNs
            'Last-Modified': new Date().toUTCString()
          });

          res.json(candles);
        } catch (error) {
          console.error('Candles endpoint error:', error);
          res.status(500).json({ error: "Internal server error" });
        }
      });
      console.log('✓ Registered /api/candles route');
      
      console.log('✓ All HTTP endpoints setup complete');
    } catch (error) {
      console.error('✗ Error setting up HTTP endpoints:', error);
      throw error;
    }
  }


  private async initializeBrokers(): Promise<void> {
    const brokers = this.config.brokers || [];
    
    console.log('Initializing brokers:', brokers);
    
    if (Array.isArray(brokers)) {
      for (const brokerConfig of brokers) {
        if (brokerConfig.enabled) {
          console.log(`Adding broker: ${brokerConfig.name}`);
          await this.brokerManager.addBroker(brokerConfig);
        }
      }
    }

    // Listen for market data from all brokers
    this.brokerManager.on("data", (data: MarketData) => {
      this.broadcastToClients(data);
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
