import { BaseBroker } from "./BaseBroker.js";
import { MarketData } from "../types/index.js";

export class MockOandaBroker extends BaseBroker {
  private interval?: NodeJS.Timeout;
  private apiKey: string;
  private accountId: string;

  constructor(config: any) {
    super(config);
    this.apiKey = config.credentials?.apiKey || config.credentials?.token || "";
    this.accountId = config.credentials?.accountId || "";
  }

  async connect(): Promise<void> {
    if (!this.apiKey) {
      throw new Error("OANDA API key not configured");
    }
    
    if (!this.accountId) {
      throw new Error("OANDA account ID not configured");
    }
    
    this.connected = true;
    console.log(`Mock Oanda broker connected with account ${this.accountId}`);
    return Promise.resolve();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    console.log(`Mock Oanda broker disconnected`);
  }

  async subscribe(symbols: string[]): Promise<void> {
    const normalizedSymbols = symbols.map(s => this.normalizeSymbol(s));
    normalizedSymbols.forEach(s => this.subscriptions.add(s));
    
    if (this.connected && !this.interval) {
      // Start generating mock forex data
      this.interval = setInterval(() => {
        this.subscriptions.forEach(symbol => {
          const denormalized = this.denormalizeSymbol(symbol);
          const basePrice = this.getBasePrice(denormalized);
          
          const marketData: MarketData = {
            broker: "oanda",
            symbol: denormalized,
            type: "tick",
            timestamp: Date.now(),
            data: {
              price: basePrice + (Math.random() - 0.5) * 0.001,
              volume: Math.random() * 1000000
            }
          };
          
          this.emitMarketData(marketData);
        });
      }, 500); // Forex updates twice per second
    }
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    const normalizedSymbols = symbols.map(s => this.normalizeSymbol(s));
    normalizedSymbols.forEach(s => this.subscriptions.delete(s));
    
    if (this.subscriptions.size === 0 && this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  protected normalizeSymbol(symbol: string): string {
    // EUR/USD -> EUR_USD
    return symbol.replace("/", "_");
  }

  private denormalizeSymbol(symbol: string): string {
    // EUR_USD -> EUR/USD
    return symbol.replace("_", "/");
  }

  private getBasePrice(symbol: string): number {
    const prices: Record<string, number> = {
      'EUR/USD': 1.0850,
      'GBP/USD': 1.2650,
      'USD/JPY': 156.50,
      'AUD/USD': 0.6450,
      'USD/CAD': 1.3650
    };
    return prices[symbol] || 1.0;
  }
}