import { Pool } from 'pg';
import { SymbolMetadata, Timeframe } from '../types/index.js';
import { TIMEFRAMES } from '../utils/constants.js';

/**
 * Service for managing market data metadata queries.
 *
 * Provides access to symbol information, available date ranges,
 * and tick counts for all symbols stored in the database.
 *
 * @example
 * ```typescript
 * const service = new MetadataService(pool);
 * const metadata = await service.getSymbolMetadata('EURUSD');
 * console.log(`EURUSD has ${metadata.tick_count} ticks`);
 * ```
 */
export class MetadataService {
  /**
   * Creates a new MetadataService instance.
   *
   * @param pool - PostgreSQL connection pool for database queries
   */
  constructor(private pool: Pool) {}

  /**
   * Retrieves metadata for a specific trading symbol.
   *
   * Queries both candles_5m (R2 materialized data) and market_ticks (legacy data).
   * Merges results to provide complete date range and candle count.
   *
   * @param symbol - Normalized symbol identifier (e.g., 'EURUSD', 'GBPUSD')
   * @returns Symbol metadata object, or null if symbol doesn't exist
   *
   * @example
   * ```typescript
   * const metadata = await service.getSymbolMetadata('EURUSD');
   * if (metadata) {
   *   console.log(`Data available from ${metadata.earliest} to ${metadata.latest}`);
   * }
   * ```
   */
  async getSymbolMetadata(symbol: string): Promise<SymbolMetadata | null> {
    // Query candles_5m (R2 materialized data)
    const candlesResult = await this.pool.query(`
      SELECT
        symbol,
        MIN(time) as earliest,
        MAX(time) as latest,
        COUNT(*) as candle_count
      FROM candles_5m
      WHERE symbol = $1
      GROUP BY symbol
    `, [symbol]);

    // Query market_ticks (legacy data) as fallback
    const ticksResult = await this.pool.query(`
      SELECT
        symbol,
        MIN(time) as earliest,
        MAX(time) as latest,
        COUNT(*) as tick_count
      FROM market_ticks
      WHERE symbol = $1
      GROUP BY symbol
    `, [symbol]);

    // If no data in either table, symbol doesn't exist
    if (candlesResult.rows.length === 0 && ticksResult.rows.length === 0) {
      return null;
    }

    // Merge results - use earliest from either source, latest from either source
    let earliest: Date | null = null;
    let latest: Date | null = null;
    let candleCount = 0;

    if (candlesResult.rows.length > 0) {
      const row = candlesResult.rows[0];
      earliest = row.earliest;
      latest = row.latest;
      candleCount = parseInt(row.candle_count);
    }

    if (ticksResult.rows.length > 0) {
      const row = ticksResult.rows[0];
      if (!earliest || row.earliest < earliest) {
        earliest = row.earliest;
      }
      if (!latest || row.latest > latest) {
        latest = row.latest;
      }
    }

    if (!earliest || !latest) {
      return null;
    }

    return {
      symbol,
      earliest: Math.floor(new Date(earliest).getTime() / 1000),
      latest: Math.floor(new Date(latest).getTime() / 1000),
      tick_count: candleCount, // Using candle count as proxy for tick count
      timeframes: Array.from(TIMEFRAMES)
    };
  }

  /**
   * Retrieves metadata for all symbols available in the database.
   *
   * Returns a comprehensive list of all trading symbols with their
   * metadata (date ranges, tick counts) and available timeframes.
   * Results are ordered alphabetically by symbol.
   *
   * @returns Object containing array of symbol metadata and available timeframes
   *
   * @example
   * ```typescript
   * const { symbols, timeframes } = await service.getAllSymbols();
   * console.log(`Found ${symbols.length} symbols`);
   * console.log(`Available timeframes: ${timeframes.join(', ')}`);
   * ```
   */
  async getAllSymbols(): Promise<{ symbols: SymbolMetadata[]; timeframes: readonly Timeframe[] }> {
    // Query both market_ticks (legacy) and candles_5m (R2 materialized) tables
    const result = await this.pool.query(`
      SELECT
        symbol,
        MIN(earliest) as earliest,
        MAX(latest) as latest,
        SUM(count) as tick_count
      FROM (
        SELECT symbol, MIN(time) as earliest, MAX(time) as latest, COUNT(*) as count
        FROM market_ticks
        GROUP BY symbol
        UNION ALL
        SELECT symbol, MIN(time) as earliest, MAX(time) as latest, COUNT(*) as count
        FROM candles_5m
        GROUP BY symbol
      ) combined
      GROUP BY symbol
      ORDER BY symbol
    `);

    const symbols = result.rows.map(row => ({
      symbol: row.symbol,
      earliest: Math.floor(new Date(row.earliest).getTime() / 1000),
      latest: Math.floor(new Date(row.latest).getTime() / 1000),
      tick_count: parseInt(row.tick_count)
    }));

    return {
      symbols,
      timeframes: TIMEFRAMES
    };
  }

  /**
   * Checks if a symbol exists in the market data database.
   *
   * Checks both candles_5m (R2 materialized data) and market_ticks (legacy data).
   * Performs optimized queries using LIMIT 1 for fast existence checking.
   *
   * @param symbol - Normalized symbol identifier to check
   * @returns True if at least one candle or tick exists for the symbol, false otherwise
   *
   * @example
   * ```typescript
   * if (await service.symbolExists('EURUSD')) {
   *   console.log('EURUSD data is available');
   * }
   * ```
   */
  async symbolExists(symbol: string): Promise<boolean> {
    // Check candles_5m first (R2 materialized data)
    const candlesResult = await this.pool.query(
      'SELECT 1 FROM candles_5m WHERE symbol = $1 LIMIT 1',
      [symbol]
    );

    if (candlesResult.rows.length > 0) {
      return true;
    }

    // Fall back to market_ticks (legacy data)
    const ticksResult = await this.pool.query(
      'SELECT 1 FROM market_ticks WHERE symbol = $1 LIMIT 1',
      [symbol]
    );

    return ticksResult.rows.length > 0;
  }

  /**
   * Retrieves the earliest and latest timestamp for a symbol's data.
   *
   * Useful for determining the full date range of available historical data.
   *
   * @param symbol - Normalized symbol identifier
   * @returns Object with earliest and latest Unix timestamps (seconds), or null if no data exists
   *
   * @example
   * ```typescript
   * const range = await service.getSymbolDateRange('GBPUSD');
   * if (range) {
   *   const span = range.latest - range.earliest;
   *   console.log(`Data spans ${span / 86400} days`);
   * }
   * ```
   */
  async getSymbolDateRange(symbol: string): Promise<{ earliest: number; latest: number } | null> {
    const result = await this.pool.query(`
      SELECT
        MIN(time) as earliest,
        MAX(time) as latest
      FROM market_ticks
      WHERE symbol = $1
    `, [symbol]);

    if (result.rows.length === 0 || !result.rows[0].earliest) {
      return null;
    }

    const row = result.rows[0];
    return {
      earliest: Math.floor(new Date(row.earliest).getTime() / 1000),
      latest: Math.floor(new Date(row.latest).getTime() / 1000)
    };
  }
}
