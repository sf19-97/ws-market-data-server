export interface MarketData {
  broker: string;
  symbol: string;
  type: "tick" | "candle" | "orderbook" | "trade";
  timestamp: number;
  data: {
    price?: number;
    volume?: number;
    side?: "buy" | "sell";
    bid?: number;
    ask?: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    period?: string;
    bids?: Array<[number, number]>;
    asks?: Array<[number, number]>;
  };
}

export interface ClientMessage {
  action: "subscribe" | "unsubscribe" | "auth" | "authenticate";
  broker?: string;
  symbols?: string[];
  types?: Array<"tick" | "candle" | "orderbook" | "trade">;
  interval?: string;
  auth?: string;
  credentials?: {
    apiKey?: string;
    apiSecret?: string;
    accountId?: string;
    token?: string;
  };
}

export interface ServerMessage {
  type: "data" | "status" | "error";
  broker?: string;
  symbol?: string;
  data?: MarketData;
  message?: string;
}

export interface BrokerConfig {
  name: string;
  type: "websocket" | "http-stream";
  url: string;
  auth: "none" | "bearer" | "api-key";
  enabled: boolean;
  symbolsFormat?: string;
  rateLimit?: number;
  credentials?: {
    apiKey?: string;
    apiSecret?: string;
    accountId?: string;
    token?: string;
  };
}

export interface ServerConfig {
  server: {
    port: number;
    host: string;
  };
  brokers: BrokerConfig[];
}

export interface SymbolMetadata {
  symbol: string;
  earliest: number;
  latest: number;
  tick_count: number;
  timeframes?: string[];
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type Timeframe = '5m' | '15m' | '1h' | '4h' | '12h';

export interface DatabaseConfig {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  ssl?: boolean | {
    rejectUnauthorized: boolean;
    ca?: string;
  };
}
