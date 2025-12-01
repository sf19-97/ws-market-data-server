import { BaseBroker } from "./BaseBroker.js";
import { MarketData } from "../types/index.js";

export class MockBinanceBroker extends BaseBroker {
  private interval?: NodeJS.Timeout;

  async connect(): Promise<void> {
    this.connected = true;
    console.log(`Mock Binance broker connected`);
    return Promise.resolve();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    console.log(`Mock Binance broker disconnected`);
  }

  async subscribe(symbols: string[]): Promise<void> {
    symbols.forEach(s => this.subscriptions.add(s));
    
    if (this.connected && !this.interval) {
      // Start generating mock data
      this.interval = setInterval(() => {
        this.subscriptions.forEach(symbol => {
          const marketData: MarketData = {
            broker: "binance",
            symbol,
            type: "tick",
            timestamp: Date.now(),
            data: {
              price: 100000 + Math.random() * 1000,
              volume: Math.random() * 100
            }
          };
          
          this.emitMarketData(marketData);
        });
      }, 1000); // Send data every second
    }
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    symbols.forEach(s => this.subscriptions.delete(s));
    
    if (this.subscriptions.size === 0 && this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }
}