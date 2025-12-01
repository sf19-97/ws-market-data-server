/**
 * Application-wide constants
 */

/**
 * Cache durations for different timeframes (in seconds)
 */
export const CACHE_DURATIONS = {
  '5m': 300,         // 5 minutes
  '15m': 600,        // 10 minutes
  '1h': 1800,        // 30 minutes
  '4h': 3600,        // 1 hour
  '12h': 3600,       // 1 hour
  default: 600       // 10 minutes default
} as const;

/**
 * Supported timeframes for candle data
 */
export const TIMEFRAMES = ['5m', '15m', '1h', '4h', '12h'] as const;

/**
 * Mapping of timeframes to materialized view names
 * Uses new R2 data lake candle tables (candles_5m, candles_15m, etc.)
 */
export const TIMEFRAME_VIEW_MAP: Record<string, string> = {
  '5m': 'candles_5m',
  '15m': 'candles_15m',
  '1h': 'candles_1h',
  '4h': 'candles_4h',
  '12h': 'candles_12h'
} as const;

/**
 * WebSocket heartbeat interval (milliseconds)
 */
export const WS_HEARTBEAT_INTERVAL = 30000; // 30 seconds

/**
 * Database connection pool defaults
 */
export const DB_POOL_DEFAULTS = {
  max: 20,                        // Maximum connections
  idleTimeoutMillis: 30000,       // 30 seconds
  connectionTimeoutMillis: 2000   // 2 seconds
} as const;

/**
 * Import batch sizes
 */
export const IMPORT_BATCH_SIZE = 1000;

/**
 * Maximum date range for API queries (in seconds)
 */
export const MAX_API_DATE_RANGE = 2 * 365 * 24 * 60 * 60; // 2 years

/**
 * Default chunk size for historical data import (hours)
 */
export const DEFAULT_IMPORT_CHUNK_HOURS = 1;

/**
 * Default broker configurations
 */
export const DEFAULT_BROKER_CONFIGS = {
  binance: {
    name: "binance",
    type: "websocket" as const,
    url: "wss://stream.binance.com:9443",
    auth: "none" as const,
    enabled: true
  },
  oanda: {
    name: "oanda",
    type: "http-stream" as const,
    url: "https://stream-fxpractice.oanda.com",
    auth: "bearer" as const,
    enabled: false // Disabled by default, requires API key
  }
} as const;

/**
 * Default server configuration
 */
export const DEFAULT_SERVER_CONFIG = {
  port: 8080,
  host: '0.0.0.0'
} as const;
