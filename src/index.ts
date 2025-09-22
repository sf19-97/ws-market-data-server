import { WebSocketServer } from "ws";
import { createServer } from "http";
import express from "express";
import { BrokerManager } from "./core/BrokerManager.js";
import { ClientConnection } from "./core/ClientConnection.js";
import { MarketData } from "./types/index.js";
import { loadConfig } from "./utils/config.js";
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
    
    // Setup HTTP endpoints for health checks
    this.setupHttpEndpoints();
    
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
    this.app.get("/health", (_, res) => {
      res.json({
        status: "healthy",
        clients: this.clients.size,
        uptime: process.uptime()
      });
    });

    this.app.get("/metrics", (_, res) => {
      res.json({
        connections: this.clients.size,
        subscriptions: Array.from(this.clients.values())
          .reduce((acc, client) => acc + client.getSubscriptions().length, 0)
      });
    });
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
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
