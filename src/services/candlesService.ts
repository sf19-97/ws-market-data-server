import { Pool } from 'pg';
import { Candle, Timeframe } from '../types/index.js';
import { TIMEFRAME_VIEW_MAP, TIMEFRAME_INTERVAL_MAP } from '../utils/constants.js';
import { ApiError, validateMaterializedViewName } from '../middleware/validation.js';
import { MaterializationService } from './materializationService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger();

/**
 * Service for fetching historical OHLC candle data from the database.
 *
 * With auto-triggering materialization:
 * - Checks if 5m candles exist in PostgreSQL for requested range
 * - If missing, automatically materializes from R2 data lake
 * - For higher timeframes (15m, 1h, 4h, 12h), refreshes materialized views
 * - Then returns candles with sub-second query performance
 *
 * Intelligently uses pre-computed materialized views for 5m, 15m, 1h, 4h, and 12h timeframes
 * to provide sub-second query response times. For 1m timeframe, aggregates raw tick data on-demand.
 *
 * All prices are formatted to 5 decimal places for forex accuracy.
 *
 * @example
 * ```typescript
 * const service = new CandlesService(pool, materializationService);
 * const candles = await service.getCandles('EURUSD', '1h', 1704067200, 1704153600);
 * console.log(`Retrieved ${candles.length} hourly candles`);
 * ```
 */
export class CandlesService {
  /**
   * Creates a new CandlesService instance.
   *
   * @param pool - PostgreSQL connection pool for database queries
   * @param materializationService - Optional service for auto-materialization from R2
   */
  constructor(
    private pool: Pool,
    private materializationService?: MaterializationService
  ) {}

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
    // Auto-trigger materialization if service is configured
    if (this.materializationService) {
      await this.ensureCandles5mExist(symbol, from, to, timeframe);
    }

    const viewName = TIMEFRAME_VIEW_MAP[timeframe];

    let query: string;
    let queryParams: (string | number)[];

    if (viewName) {
      // Use materialized view for supported timeframes
      validateMaterializedViewName(viewName); // Security check

      query = `
        SELECT
          EXTRACT(EPOCH FROM time)::bigint AS time,
          open,
          high,
          low,
          close
        FROM ${viewName}
        WHERE symbol = $1
          AND time >= to_timestamp($2)
          AND time <= to_timestamp($3)
        ORDER BY time ASC;
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

  /**
   * Ensure 5m candles exist for the requested range
   * Auto-triggers materialization from R2 if missing
   *
   * @private
   */
  private async ensureCandles5mExist(
    symbol: string,
    fromTimestamp: number,
    toTimestamp: number,
    timeframe: Timeframe
  ): Promise<void> {
    const startDate = new Date(fromTimestamp * 1000);
    const endDate = new Date(toTimestamp * 1000);

    logger.debug(
      { symbol, startDate, endDate, timeframe },
      'Checking 5m candle coverage'
    );

    // Step 1: Check if 5m candles exist for this range
    const coverage = await this.materializationService!.getCandleCoverage(
      symbol,
      startDate,
      endDate
    );

    if (coverage.covered) {
      logger.debug({ symbol }, '5m candles already exist, skipping materialization');
      return;
    }

    // Step 2: If missing, materialize from R2
    logger.info(
      {
        symbol,
        missingDays: coverage.totalDays - coverage.coveredDays,
        missingRanges: coverage.missingRanges.length
      },
      'Materializing missing 5m candles from R2'
    );

    // Materialize each missing range
    for (const range of coverage.missingRanges) {
      logger.debug(
        { symbol, start: range.start, end: range.end },
        'Materializing date range'
      );

      await this.materializationService!.materialize5mCandles(
        symbol,
        range.start,
        range.end
      );
    }

    // Step 3: For higher timeframes, refresh materialized views
    if (timeframe !== '5m' && TIMEFRAME_VIEW_MAP[timeframe]) {
      logger.info({ timeframe }, 'Refreshing materialized view for higher timeframe');

      await this.materializationService!.refreshMaterializedViews([timeframe]);
    }

    logger.info({ symbol, timeframe }, 'Materialization complete');
  }
}