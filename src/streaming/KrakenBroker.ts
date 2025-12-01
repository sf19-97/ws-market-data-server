import WebSocket from "ws";
import { BaseBroker } from "./BaseBroker.js";
import { MarketData } from "../types/index.js";

export class KrakenBroker extends BaseBroker {
  private ws?: WebSocket;
  private reconnectTimeout?: NodeJS.Timeout;
  private pingInterval?: NodeJS.Timeout;
  private subscriptionMap: Map<number, string> = new Map();

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.config.url || 'wss://ws.kraken.com';
      
      console.log(`Connecting to Kraken WebSocket: ${url}`);
      
      const timeout = setTimeout(() => {
        reject(new Error('Kraken connection timeout after 10 seconds'));
        this.ws?.close();
      }, 10000);
      
      this.ws = new WebSocket(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      this.ws.on("open", () => {
        clearTimeout(timeout);
        this.connected = true;
        console.log("Kraken broker connected");
        this.startPingInterval();
        resolve();
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch (err) {
          console.error("Kraken parse error:", err);
        }
      });

      this.ws.on("error", (err) => {
        clearTimeout(timeout);
        console.error("Kraken WebSocket error:", err);
        console.error("Error details:", {
          message: err.message,
          code: (err as any).code,
          statusCode: (err as any).statusCode
        });
        reject(err);
      });

      this.ws.on("close", () => {
        this.connected = false;
        this.stopPingInterval();
        this.handleReconnect();
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
    this.stopPingInterval();
    this.ws?.close();
    this.connected = false;
  }

  async subscribe(symbols: string[]): Promise<void> {
    if (!this.connected || !this.ws) {
      // Store subscriptions for when we connect
      symbols.forEach(s => this.subscriptions.add(s));
      return;
    }

    const pairs = symbols.map(s => this.normalizeSymbol(s));
    
    const subscribeMsg = {
      event: "subscribe",
      pair: pairs,
      subscription: {
        name: "ticker"
      }
    };

    console.log("Kraken subscribing to:", pairs);
    this.ws.send(JSON.stringify(subscribeMsg));
    
    symbols.forEach(s => this.subscriptions.add(s));
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    if (!this.connected || !this.ws) return;

    const pairs = symbols.map(s => this.normalizeSymbol(s));
    
    const unsubscribeMsg = {
      event: "unsubscribe",
      pair: pairs,
      subscription: {
        name: "ticker"
      }
    };

    this.ws.send(JSON.stringify(unsubscribeMsg));
    symbols.forEach(s => this.subscriptions.delete(s));
  }

  private handleMessage(msg: any): void {
    console.log("Kraken message received:", JSON.stringify(msg, null, 2));
    
    // Kraken sends different message types
    if (msg.event === "systemStatus") {
      console.log("Kraken system status:", msg.status);
    } else if (msg.event === "subscriptionStatus") {
      console.log("Kraken subscription status:", msg.status, msg.pair);
      if (msg.channelID && msg.pair) {
        this.subscriptionMap.set(msg.channelID, msg.pair);
      }
    } else if (Array.isArray(msg) && msg.length >= 4) {
      // Ticker updates: [channelID, tickerData, "ticker", pair]
      const [, tickerData, type, pair] = msg;
      
      if (type === "ticker" && tickerData) {
        // Keep the symbol as-is (XBT/USD) to match client subscriptions
        
        // Kraken ticker format: https://docs.kraken.com/websockets/#message-ticker
        // a = ask [price, wholeLotVolume, lotVolume]
        // b = bid [price, wholeLotVolume, lotVolume]
        // c = close [price, lotVolume]
        // v = volume [today, last24Hours]
        
        const marketData: MarketData = {
          broker: "kraken",
          symbol: pair,
          type: "tick",
          timestamp: Date.now(),
          data: {
            price: parseFloat(tickerData.c[0]), // Last trade price
            bid: parseFloat(tickerData.b[0]),   // Best bid
            ask: parseFloat(tickerData.a[0]),   // Best ask
            volume: parseFloat(tickerData.v[1]) // 24h volume
          }
        };
        
        this.emitMarketData(marketData);
      }
    }
  }

  protected normalizeSymbol(symbol: string): string {
    // Convert BTCUSD to XBT/USD (Kraken uses XBT for Bitcoin)
    let normalized = symbol.replace('_', '/');
    
    // Handle Bitcoin specially
    if (normalized.startsWith('BTC')) {
      normalized = normalized.replace('BTC', 'XBT');
    }
    
    // Kraken uses specific format: XBT/USD not XBTUSD
    if (!normalized.includes('/')) {
      // Try to split currency pairs (ETHUSD -> ETH/USD)
      if (normalized.endsWith('USD')) {
        normalized = normalized.slice(0, -3) + '/USD';
      } else if (normalized.endsWith('EUR')) {
        normalized = normalized.slice(0, -3) + '/EUR';
      } else if (normalized.endsWith('USDT')) {
        normalized = normalized.slice(0, -4) + '/USDT';
      }
    }
    
    return normalized;
  }


  private handleReconnect(): void {
    if (!this.reconnectTimeout && this.subscriptions.size > 0) {
      this.reconnectTimeout = setTimeout(() => {
        console.log("Attempting to reconnect to Kraken...");
        this.connect()
          .then(() => {
            // Resubscribe to all symbols
            const symbols = Array.from(this.subscriptions);
            this.subscriptions.clear();
            return this.subscribe(symbols);
          })
          .catch(console.error);
        this.reconnectTimeout = undefined;
      }, 5000);
    }
  }

  private startPingInterval(): void {
    // Kraken recommends sending ping every 30 seconds
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ event: "ping" }));
      }
    }, 30000);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }
}