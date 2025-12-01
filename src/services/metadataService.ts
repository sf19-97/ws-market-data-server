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
   * Queries candles_5m table for date range and candle count.
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
    const result = await this.pool.query(`
      SELECT
        symbol,
        MIN(time) as earliest,
        MAX(time) as latest,
        COUNT(*) as candle_count
      FROM candles_5m
      WHERE symbol = $1
      GROUP BY symbol
    `, [symbol]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      symbol,
      earliest: Math.floor(new Date(row.earliest).getTime() / 1000),
      latest: Math.floor(new Date(row.latest).getTime() / 1000),
      tick_count: parseInt(row.candle_count),
      timeframes: Array.from(TIMEFRAMES)
    };
  }

  /**
   * Retrieves metadata for all symbols available in the database.
   *
   * Returns a comprehensive list of all trading symbols with their
   * metadata (date ranges, candle counts) and available timeframes.
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
    const result = await this.pool.query(`
      SELECT
        symbol,
        MIN(time) as earliest,
        MAX(time) as latest,
        COUNT(*) as candle_count
      FROM candles_5m
      GROUP BY symbol
      ORDER BY symbol
    `);

    const symbols = result.rows.map(row => ({
      symbol: row.symbol,
      earliest: Math.floor(new Date(row.earliest).getTime() / 1000),
      latest: Math.floor(new Date(row.latest).getTime() / 1000),
      tick_count: parseInt(row.candle_count)
    }));

    return {
      symbols,
      timeframes: TIMEFRAMES
    };
  }

  /**
   * Checks if a symbol exists in the market data database.
   *
   * Performs optimized query using LIMIT 1 for fast existence checking.
   *
   * @param symbol - Normalized symbol identifier to check
   * @returns True if at least one candle exists for the symbol, false otherwise
   *
   * @example
   * ```typescript
   * if (await service.symbolExists('EURUSD')) {
   *   console.log('EURUSD data is available');
   * }
   * ```
   */
  async symbolExists(symbol: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM candles_5m WHERE symbol = $1 LIMIT 1',
      [symbol]
    );

    return result.rows.length > 0;
  }
}
