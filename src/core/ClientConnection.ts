import WebSocket from "ws";
import { EventEmitter } from "events";
import { ClientMessage, ServerMessage, MarketData } from "../types/index.js";

export class ClientConnection extends EventEmitter {
  private ws: WebSocket;
  private id: string;
  private subscriptions: Set<string> = new Set();
  private authenticated: boolean = false;
  private brokerCredentials: Map<string, any> = new Map();

  constructor(ws: WebSocket, id: string) {
    super();
    this.ws = ws;
    this.id = id;
    
    this.setupHandlers();
    this.sendStatus("Connected to Market Data Server");
  }

  private setupHandlers(): void {
    this.ws.on("message", (data: Buffer) => {
      try {
        const message: ClientMessage = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (err) {
        this.sendError(`Invalid message format: ${err}`);
      }
    });

    this.ws.on("close", () => {
      this.emit("disconnect", this.id);
    });

    this.ws.on("error", (err) => {
      console.error(`Client ${this.id} error:`, err);
    });

    // Send heartbeat
    const heartbeat = setInterval(() => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      } else {
        clearInterval(heartbeat);
      }
    }, 30000);
  }

  private handleMessage(message: ClientMessage): void {
    console.log(`Client ${this.id} received message:`, message);
    switch (message.action) {
      case "subscribe":
        if (message.symbols && message.symbols.length > 0) {
          console.log(`Processing subscribe for ${message.symbols.length} symbols:`, message.symbols);
          message.symbols.forEach(s => {
            this.subscriptions.add(s);
            console.log(`Client ${this.id} subscribed to: ${s}`);
          });
          this.emit("subscribe", {
            clientId: this.id,
            broker: message.broker,
            symbols: message.symbols,
            types: message.types,
            interval: message.interval
          });
        } else {
          console.log(`No symbols in subscribe message`);
        }
        break;

      case "unsubscribe":
        if (message.symbols) {
          message.symbols.forEach(s => this.subscriptions.delete(s));
          this.emit("unsubscribe", {
            clientId: this.id,
            broker: message.broker,
            symbols: message.symbols
          });
        }
        break;

      case "auth":
        // Simple auth check - extend as needed
        if (message.auth) {
          this.authenticated = true;
          this.sendStatus("Authenticated successfully");
        } else {
          this.sendError("Invalid authentication");
        }
        break;

      case "authenticate":
        if (message.broker && message.credentials) {
          this.brokerCredentials.set(message.broker, message.credentials);
          this.emit("broker-auth", {
            clientId: this.id,
            broker: message.broker,
            credentials: message.credentials
          });
          this.sendStatus(`Authenticated with ${message.broker}`);
        } else {
          this.sendError("Missing broker or credentials");
        }
        break;
    }
  }

  sendData(data: MarketData): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      // Check both formats: EUR_USD and EUR/USD
      const normalizedSymbol = data.symbol.replace('/', '_');
      const hasSubscription = this.subscriptions.has(data.symbol) || this.subscriptions.has(normalizedSymbol);
      
      if (!hasSubscription) {
        console.log(`Client ${this.id} not subscribed to ${data.symbol}. Subscriptions:`, Array.from(this.subscriptions));
        return;
      }
      
      const message: ServerMessage = {
        type: "data",
        broker: data.broker,
        symbol: data.symbol,
        data: data
      };
      
      this.ws.send(JSON.stringify(message));
    }
  }

  sendStatus(message: string): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      const msg: ServerMessage = {
        type: "status",
        message
      };
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendError(message: string): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      const msg: ServerMessage = {
        type: "error",
        message
      };
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendMarketData(data: MarketData): void {
    if (this.ws.readyState === WebSocket.OPEN && this.subscriptions.has(data.symbol)) {
      const msg: ServerMessage = {
        type: "data",
        broker: data.broker,
        symbol: data.symbol,
        data: data
      };
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect(): void {
    this.ws.close();
  }

  isAlive(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }

  getBrokerCredentials(broker: string): any {
    return this.brokerCredentials.get(broker);
  }
}
