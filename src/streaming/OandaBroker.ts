import axios from "axios";
import { IncomingMessage } from "http";
import { BaseBroker } from "./BaseBroker.js";
import { MarketData, BrokerConfig } from "../types/index.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger();

export class OandaBroker extends BaseBroker {
  private streamConnection?: IncomingMessage;
  private apiKey: string;
  private accountId: string;
  private reconnectTimeout?: NodeJS.Timeout;
  private isReconnecting: boolean = false;

  constructor(config: BrokerConfig) {
    super(config);
    // Use credentials from config first, then fall back to env vars
    this.apiKey = config.credentials?.apiKey || config.credentials?.token || process.env.OANDA_API_KEY || "";
    this.accountId = config.credentials?.accountId || process.env.OANDA_ACCOUNT_ID || "";
  }

  async connect(): Promise<void> {
    if (!this.apiKey) {
      throw new Error("OANDA API key not configured");
    }
    
    if (!this.accountId) {
      throw new Error("OANDA account ID not configured");
    }

    // Skip connection if no instruments subscribed yet
    if (this.subscriptions.size === 0) {
      logger.info('OANDA broker initialized, waiting for subscriptions');
      return;
    }

    const instruments = Array.from(this.subscriptions).join(",");
    
    try {
      const response = await axios({
        method: "GET",
        url: `${this.config.url}/v3/accounts/${this.accountId}/pricing/stream`,
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Accept-Datetime-Format": "UNIX"
        },
        params: {
          instruments
        },
        responseType: "stream"
      });

      this.streamConnection = response.data;
      this.connected = true;

      const stream = this.streamConnection!; // Non-null assertion: we just assigned it above
      let buffer = "";
      stream.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        
        lines.forEach((line: string) => {
          if (line.trim()) {
            try {
              const msg = JSON.parse(line);
              this.handleMessage(msg);
            } catch (err) {
              // Log non-heartbeat errors for debugging
              if (!line.includes("HEARTBEAT")) {
                logger.warn({
                  err,
                  line: line.substring(0, 100)
                }, 'OANDA parse error');
              }
            }
          }
        });
      });

      stream.on("error", (err: Error) => {
        logger.error({ err: err.message }, 'OANDA stream error');
        this.emitError(new Error(`Oanda stream error: ${err}`));
        this.connected = false;
        this.handleReconnect();
      });

      stream.on("end", () => {
        logger.info('OANDA stream ended');
        this.connected = false;
        this.handleReconnect();
      });

      logger.info({ instruments }, 'OANDA broker connected');
    } catch (err) {
      throw new Error(`Failed to connect to Oanda: ${err}`);
    }
  }

  async disconnect(): Promise<void> {
    this.clearReconnectTimeout();
    if (this.streamConnection) {
      this.streamConnection.destroy();
      this.streamConnection = undefined;
    }
    this.connected = false;
  }
  
  private handleReconnect(): void {
    if (this.isReconnecting || !this.subscriptions.size) return;

    this.clearReconnectTimeout();
    this.isReconnecting = true;

    logger.info('OANDA: Scheduling reconnect in 5 seconds');
    this.reconnectTimeout = setTimeout(() => {
      logger.info('OANDA: Attempting to reconnect');
      this.connect()
        .then(() => {
          this.isReconnecting = false;
        })
        .catch((err) => {
          logger.error({ err }, 'OANDA: Reconnection failed');
          this.isReconnecting = false;
          this.handleReconnect(); // Try again
        });
    }, 5000);
  }
  
  private clearReconnectTimeout(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
  }

  async subscribe(symbols: string[]): Promise<void> {
    const normalizedSymbols = symbols.map(s => this.normalizeSymbol(s));
    normalizedSymbols.forEach(s => this.subscriptions.add(s));
    
    // Connect if not connected yet, or reconnect with new symbols
    if (this.connected && this.streamConnection) {
      await this.disconnect();
      await this.connect();
    } else if (!this.connected) {
      await this.connect();
    }
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    const normalizedSymbols = symbols.map(s => this.normalizeSymbol(s));
    normalizedSymbols.forEach(s => this.subscriptions.delete(s));
    
    if (this.connected && this.subscriptions.size > 0) {
      await this.disconnect();
      await this.connect();
    }
  }

  private handleMessage(msg: any): void {
    if (msg.type === "PRICE") {
      try {
        // OANDA includes the instrument in each PRICE message
        const instrument = msg.instrument;

        if (!instrument) {
          logger.warn({ msg }, 'OANDA: PRICE message missing instrument field');
          return;
        }

        // Verify this is a subscribed instrument
        if (!this.subscriptions.has(instrument)) {
          logger.debug({ instrument }, 'OANDA: Received price for unsubscribed instrument');
          return;
        }

        const bid = parseFloat(msg.bids[0].price);
        const ask = parseFloat(msg.asks[0].price);
        const midPrice = (bid + ask) / 2;

        const marketData: MarketData = {
          broker: "oanda",
          symbol: this.denormalizeSymbol(instrument),
          type: "tick",
          timestamp: parseFloat(msg.time) * 1000,
          data: {
            price: midPrice,
            bid: bid,
            ask: ask,
            volume: parseFloat(msg.bids[0].liquidity)
          }
        };

        logger.debug({
          symbol: marketData.symbol,
          bid,
          ask,
          mid: midPrice
        }, 'OANDA tick received');
        this.emitMarketData(marketData);
      } catch (error) {
        logger.error({
          err: error,
          rawMessage: JSON.stringify(msg).substring(0, 200)
        }, 'Error parsing OANDA data');
      }
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
}
