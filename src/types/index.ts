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
  data?: any;
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
