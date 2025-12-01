import { EventEmitter } from "events";
import { MarketData, BrokerConfig } from "../types/index.js";

export abstract class BaseBroker extends EventEmitter {
  protected config: BrokerConfig;
  protected connected: boolean = false;
  protected subscriptions: Set<string> = new Set();

  constructor(config: BrokerConfig) {
    super();
    this.config = config;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract subscribe(symbols: string[]): Promise<void>;
  abstract unsubscribe(symbols: string[]): Promise<void>;

  isConnected(): boolean {
    return this.connected;
  }

  hasSymbol(symbol: string): boolean {
    return this.subscriptions.has(this.normalizeSymbol(symbol));
  }

  protected normalizeSymbol(symbol: string): string {
    // Override in specific broker implementations
    return symbol;
  }

  protected emitMarketData(data: MarketData): void {
    this.emit("data", data);
  }

  protected emitError(error: Error): void {
    this.emit("error", error);
  }
}
