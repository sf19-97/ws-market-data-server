import { Pool } from 'pg';
import { SymbolMetadata, Timeframe } from '../types/index.js';
import { TIMEFRAMES } from '../utils/constants.js';

/**
 * Raw metadata row from database
 */
interface MetadataRow {
  symbol: string;
  earliest: Date;
  latest: Date;
  candle_count: string;
}

/**
 * Repository for symbol metadata queries
 *
 * Encapsulates all database operations for metadata, including:
 * - Querying symbol information (date ranges, counts)
 * - Listing all available symbols
 * - Checking symbol existence
 */
export class MetadataRepository {
  constructor(private pool: Pool) {}

  /**
   * Get metadata for a specific symbol
   *
   * @param symbol - Trading symbol (e.g., 'EURUSD')
   * @returns Symbol metadata or null if not found
   */
  async getSymbolMetadata(symbol: string): Promise<SymbolMetadata | null> {
    const result = await this.pool.query<MetadataRow>(`
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
   * Get metadata for all symbols in the database
   *
   * @returns Object with symbols array and available timeframes
   */
  async getAllSymbols(): Promise<{ symbols: SymbolMetadata[]; timeframes: readonly Timeframe[] }> {
    const result = await this.pool.query<MetadataRow>(`
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
   * Check if a symbol exists in the database
   *
   * @param symbol - Trading symbol to check
   * @returns True if symbol has data
   */
  async symbolExists(symbol: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM candles_5m WHERE symbol = $1 LIMIT 1',
      [symbol]
    );

    return result.rows.length > 0;
  }
}
