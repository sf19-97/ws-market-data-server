/**
 * Application-wide constants
 */

/**
 * Cache durations for different timeframes (in seconds)
 */
export const CACHE_DURATIONS = {
  '1m': 60,          // 1 minute
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
export const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '12h'] as const;

/**
 * Mapping of timeframes to materialized view names
 */
export const TIMEFRAME_VIEW_MAP: Record<string, string> = {
  '5m': 'forex_candles_5m',
  '15m': 'forex_candles_15m',
  '1h': 'forex_candles_1h',
  '4h': 'forex_candles_4h',
  '12h': 'forex_candles_12h'
} as const;

/**
 * Mapping of timeframes to PostgreSQL intervals for computed aggregations
 */
export const TIMEFRAME_INTERVAL_MAP: Record<string, string> = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '4h': '4 hours',
  '12h': '12 hours'
} as const;

/**
 * Database index names
 */
export const DATABASE_INDEXES = {
  TIME_BRIN: 'forex_ticks_time_brin',
  TIME_BTREE: 'forex_ticks_time_idx',
  SYMBOL_TIME_UNIQUE: 'forex_ticks_symbol_time_uq',
  SYMBOL_TIME_BTREE: 'forex_ticks_symbol_time_idx'
} as const;

/**
 * Indexes to drop during bulk import for performance
 */
export const IMPORT_INDEXES_TO_DROP = [
  DATABASE_INDEXES.TIME_BTREE,
  DATABASE_INDEXES.SYMBOL_TIME_BTREE
] as const;

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
export const MAX_API_DATE_RANGE = 365 * 24 * 60 * 60; // 1 year

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
