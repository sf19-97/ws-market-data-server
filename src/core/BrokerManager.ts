import { EventEmitter } from "events";
import { BaseBroker } from "../brokers/BaseBroker.js";
import { BinanceBroker } from "../brokers/BinanceBroker.js";
import { MockBinanceBroker } from "../brokers/MockBinanceBroker.js";
import { OandaBroker } from "../brokers/OandaBroker.js";
import { MockOandaBroker } from "../brokers/MockOandaBroker.js";
import { BrokerConfig, MarketData } from "../types/index.js";

export class BrokerManager extends EventEmitter {
  private globalBrokers: Map<string, BaseBroker> = new Map();
  private clientBrokers: Map<string, Map<string, BaseBroker>> = new Map();
  private symbolToBroker: Map<string, string> = new Map();

  async addBroker(config: BrokerConfig): Promise<void> {
    if (!config.enabled) return;

    let broker: BaseBroker;
    
    switch (config.name.toLowerCase()) {
      case "binance":
        // Use mock broker for now due to 451 error
        broker = new MockBinanceBroker(config);
        break;
      case "oanda":
        // Use real broker with API credentials
        broker = new OandaBroker(config);
        break;
      default:
        console.warn(`Unknown broker type: ${config.name}`);
        return;
    }

    broker.on("data", (data: MarketData) => {
      this.emit("data", data);
    });

    broker.on("error", (error: Error) => {
      console.error(`Broker ${config.name} error:`, error);
    });

    this.globalBrokers.set(config.name, broker);

    try {
      await broker.connect();
    } catch (err) {
      console.error(`Failed to connect broker ${config.name}:`, err);
    }
  }

  async addClientBroker(clientId: string, brokerName: string, credentials: any): Promise<void> {
    if (!this.clientBrokers.has(clientId)) {
      this.clientBrokers.set(clientId, new Map());
    }
    
    // Build a config for the broker
    const config: BrokerConfig = {
      name: brokerName,
      type: brokerName === 'oanda' ? 'http-stream' : 'websocket',
      url: brokerName === 'oanda' ? 'https://stream-fxtrade.oanda.com' : 'wss://stream.binance.com:9443',
      auth: brokerName === 'oanda' ? 'bearer' : 'none',
      enabled: true,
      credentials
    };
    
    let broker: BaseBroker;
    
    switch (brokerName.toLowerCase()) {
      case "binance":
        broker = new MockBinanceBroker(config);
        break;
      case "oanda":
        // Use real broker with API credentials
        broker = new OandaBroker(config);
        break;
      default:
        throw new Error(`Unknown broker type: ${brokerName}`);
    }
    
    broker.on("data", (data: MarketData) => {
      this.emit("data", { ...data, clientId });
    });
    
    await broker.connect();
    this.clientBrokers.get(clientId)!.set(brokerName, broker);
  }

  async subscribe(broker: string | undefined, symbols: string[], clientId?: string): Promise<void> {
    console.log(`BrokerManager.subscribe called with broker: ${broker}, symbols:`, symbols);
    if (broker) {
      const brokerInstance = this.getBroker(broker, clientId);
      if (brokerInstance) {
        console.log(`Found broker instance for ${broker}, subscribing...`);
        await brokerInstance.subscribe(symbols);
        symbols.forEach(s => this.symbolToBroker.set(s, broker));
      } else {
        console.log(`No broker instance found for ${broker}`);
      }
    } else {
      // Auto-route to best available broker
      for (const symbol of symbols) {
        const bestBroker = this.findBestBroker(symbol);
        if (bestBroker) {
          await bestBroker.subscribe([symbol]);
          this.symbolToBroker.set(symbol, bestBroker.constructor.name);
        }
      }
    }
  }

  private getBroker(brokerName: string, clientId?: string): BaseBroker | undefined {
    if (clientId && this.clientBrokers.has(clientId)) {
      const clientBrokerMap = this.clientBrokers.get(clientId);
      if (clientBrokerMap?.has(brokerName)) {
        return clientBrokerMap.get(brokerName);
      }
    }
    return this.globalBrokers.get(brokerName);
  }

  async unsubscribe(broker: string | undefined, symbols: string[], clientId?: string): Promise<void> {
    if (broker) {
      const brokerInstance = this.getBroker(broker, clientId);
      if (brokerInstance) {
        await brokerInstance.unsubscribe(symbols);
        symbols.forEach(s => this.symbolToBroker.delete(s));
      }
    } else {
      // Unsubscribe from all brokers
      for (const [brokerName, brokerInstance] of this.globalBrokers) {
        await brokerInstance.unsubscribe(symbols);
      }
      symbols.forEach(s => this.symbolToBroker.delete(s));
    }
  }

  private findBestBroker(symbol: string): BaseBroker | undefined {
    // Prefer forex pairs on Oanda
    if (symbol.includes("/") && !symbol.includes("BTC") && !symbol.includes("ETH")) {
      const oanda = this.globalBrokers.get("oanda");
      if (oanda?.isConnected()) return oanda;
    }

    // Prefer crypto on Binance
    if (symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("USDT")) {
      const binance = this.globalBrokers.get("binance");
      if (binance?.isConnected()) return binance;
    }

    // Return any connected broker
    for (const broker of this.globalBrokers.values()) {
      if (broker.isConnected()) return broker;
    }

    return undefined;
  }

  async disconnectAll(): Promise<void> {
    // Disconnect global brokers
    for (const broker of this.globalBrokers.values()) {
      await broker.disconnect();
    }
    
    // Disconnect client-specific brokers
    for (const clientBrokers of this.clientBrokers.values()) {
      for (const broker of clientBrokers.values()) {
        await broker.disconnect();
      }
    }
  }
}
