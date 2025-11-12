import { Pool } from 'pg';
import { Candle, Timeframe } from '../types/index.js';
import { TIMEFRAME_VIEW_MAP, TIMEFRAME_INTERVAL_MAP } from '../utils/constants.js';
import { ApiError, validateMaterializedViewName } from '../middleware/validation.js';

/**
 * Service for fetching historical OHLC candle data from the database.
 *
 * Intelligently uses pre-computed materialized views for 5m, 15m, 1h, 4h, and 12h timeframes
 * to provide sub-second query response times. For 1m timeframe, aggregates raw tick data on-demand.
 *
 * All prices are formatted to 5 decimal places for forex accuracy.
 *
 * @example
 * ```typescript
 * const service = new CandlesService(pool);
 * const candles = await service.getCandles('EURUSD', '1h', 1704067200, 1704153600);
 * console.log(`Retrieved ${candles.length} hourly candles`);
 * ```
 */
export class CandlesService {
  /**
   * Creates a new CandlesService instance.
   *
   * @param pool - PostgreSQL connection pool for database queries
   */
  constructor(private pool: Pool) {}

  /**
   * Retrieves historical OHLC candle data for a trading symbol.
   *
   * Uses optimized materialized views for 5m+ timeframes (instant queries).
   * For 1m timeframe, aggregates raw ticks using PostgreSQL time_bucket().
   *
   * @param symbol - Normalized symbol identifier (e.g., 'EURUSD')
   * @param timeframe - Candle timeframe: '1m', '5m', '15m', '1h', '4h', or '12h'
   * @param from - Start timestamp (Unix epoch seconds)
   * @param to - End timestamp (Unix epoch seconds)
   * @returns Array of OHLC candles, ordered by time ascending
   * @throws {ApiError} If timeframe is invalid
   *
   * @example
   * ```typescript
   * // Get 1-hour candles for EURUSD
   * const candles = await service.getCandles(
   *   'EURUSD',
   *   '1h',
   *   1704067200,  // 2024-01-01 00:00:00 UTC
   *   1704153600   // 2024-01-02 00:00:00 UTC
   * );
   *
   * candles.forEach(c => {
   *   console.log(`${c.time}: O=${c.open} H=${c.high} L=${c.low} C=${c.close}`);
   * });
   * ```
   */
  async getCandles(
    symbol: string,
    timeframe: Timeframe,
    from: number,
    to: number
  ): Promise<Candle[]> {
    const viewName = TIMEFRAME_VIEW_MAP[timeframe];

    let query: string;
    let queryParams: (string | number)[];

    if (viewName) {
      // Use materialized view for supported timeframes
      validateMaterializedViewName(viewName); // Security check

      query = `
        SELECT
          EXTRACT(EPOCH FROM t_open)::bigint AS time,
          open,
          high,
          low,
          close
        FROM ${viewName}
        WHERE symbol = $1
          AND t_open >= to_timestamp($2)
          AND t_open <= to_timestamp($3)
        ORDER BY t_open ASC;
      `;
      queryParams = [symbol, from, to];
    } else {
      // Compute candles on-demand for unsupported timeframes
      const interval = TIMEFRAME_INTERVAL_MAP[timeframe];

      if (!interval) {
        throw new ApiError(400, `Unsupported timeframe: ${timeframe}`, 'INVALID_TIMEFRAME');
      }

      query = `
        SELECT
          EXTRACT(EPOCH FROM time_bucket($1, time))::bigint AS time,
          (array_agg(mid_price ORDER BY time ASC))[1] AS open,
          MAX(mid_price) AS high,
          MIN(mid_price) AS low,
          (array_agg(mid_price ORDER BY time DESC))[1] AS close
        FROM market_ticks
        WHERE symbol = $2
          AND time >= to_timestamp($3)
          AND time <= to_timestamp($4)
        GROUP BY time_bucket($1, time)
        ORDER BY time ASC;
      `;
      queryParams = [interval, symbol, from, to];
    }

    const result = await this.pool.query(query, queryParams);

    return result.rows.map(row => ({
      time: parseInt(row.time),
      open: parseFloat(parseFloat(row.open).toFixed(5)),
      high: parseFloat(parseFloat(row.high).toFixed(5)),
      low: parseFloat(parseFloat(row.low).toFixed(5)),
      close: parseFloat(parseFloat(row.close).toFixed(5))
    }));
  }

  /**
   * Check if data exists for a date range
   */
  async hasDataInRange(symbol: string, from: number, to: number): Promise<boolean> {
    const result = await this.pool.query(`
      SELECT 1
      FROM market_ticks
      WHERE symbol = $1
        AND time >= to_timestamp($2)
        AND time <= to_timestamp($3)
      LIMIT 1
    `, [symbol, from, to]);

    return result.rows.length > 0;
  }

  /**
   * Get count of ticks in a date range
   */
  async getTickCount(symbol: string, from: number, to: number): Promise<number> {
    const result = await this.pool.query(`
      SELECT COUNT(*) as count
      FROM market_ticks
      WHERE symbol = $1
        AND time >= to_timestamp($2)
        AND time <= to_timestamp($3)
    `, [symbol, from, to]);

    return parseInt(result.rows[0].count);
  }
}