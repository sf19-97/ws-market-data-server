import WebSocket from "ws";
import { BaseBroker } from "./BaseBroker.js";
import { MarketData } from "../types/index.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger();

export class BinanceBroker extends BaseBroker {
  private ws?: WebSocket;
  private reconnectTimeout?: NodeJS.Timeout;

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const streams = Array.from(this.subscriptions).map(s => 
        `${s.toLowerCase().replace("/", "")}@ticker`
      ).join("/");
      
      const wsUrl = this.config.url || 'wss://stream.binance.com:9443';
      const url = streams
        ? `${wsUrl}/stream?streams=${streams}`
        : `${wsUrl}/ws`;

      logger.info({ url }, 'Connecting to Binance WebSocket');
      this.ws = new WebSocket(url);

      this.ws.on("open", () => {
        this.connected = true;
        logger.info('Binance broker connected');
        resolve();
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch (err) {
          this.emitError(new Error(`Failed to parse Binance message: ${err}`));
        }
      });

      this.ws.on("error", (err) => {
        this.emitError(new Error(`Binance WebSocket error: ${err}`));
        reject(err);
      });

      this.ws.on("close", () => {
        this.connected = false;
        this.handleReconnect();
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    this.connected = false;
  }

  async subscribe(symbols: string[]): Promise<void> {
    symbols.forEach(s => this.subscriptions.add(s));
    if (this.connected) {
      // Reconnect with new streams
      await this.disconnect();
      await this.connect();
    }
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    symbols.forEach(s => this.subscriptions.delete(s));
    if (this.connected && this.subscriptions.size > 0) {
      await this.disconnect();
      await this.connect();
    }
  }

  private handleMessage(msg: any): void {
    if (msg.k) { // Kline/candle data
      const candle = msg.k;
      const symbol = msg.s.replace("USDT", "/USDT");
      
      const marketData: MarketData = {
        broker: "binance",
        symbol,
        type: "candle",
        timestamp: candle.t,
        data: {
          open: parseFloat(candle.o),
          high: parseFloat(candle.h),
          low: parseFloat(candle.l),
          close: parseFloat(candle.c),
          volume: parseFloat(candle.v),
          period: candle.i
        }
      };
      
      this.emitMarketData(marketData);
    }
  }

  private handleReconnect(): void {
    if (!this.reconnectTimeout) {
      this.reconnectTimeout = setTimeout(() => {
        logger.info('Attempting to reconnect to Binance');
        this.connect().catch((err) => {
          logger.error({ err }, 'Binance reconnection failed');
        });
        this.reconnectTimeout = undefined;
      }, 5000);
    }
  }

  protected normalizeSymbol(symbol: string): string {
    return symbol.replace("/", "").toLowerCase();
  }
}
