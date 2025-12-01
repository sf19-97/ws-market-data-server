import { Pool } from 'pg';
import { Candle, Timeframe } from '../types/index.js';
import { TIMEFRAME_VIEW_MAP } from '../utils/constants.js';
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
 * Uses pre-computed materialized views for 5m, 15m, 1h, 4h, and 12h timeframes
 * to provide sub-second query response times.
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
   * Uses optimized materialized views for 5m, 15m, 1h, 4h, and 12h timeframes.
   *
   * @param symbol - Normalized symbol identifier (e.g., 'EURUSD')
   * @param timeframe - Candle timeframe: '5m', '15m', '1h', '4h', or '12h'
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

    if (!viewName) {
      throw new ApiError(400, `Unsupported timeframe: ${timeframe}`, 'INVALID_TIMEFRAME');
    }

    // Security check
    validateMaterializedViewName(viewName);

    const query = `
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

    const result = await this.pool.query(query, [symbol, from, to]);

    return result.rows
      // Filter out any rows with null or NaN OHLC values
      .filter(row =>
        row.open !== null && row.high !== null && row.low !== null && row.close !== null &&
        !isNaN(parseFloat(row.open)) && !isNaN(parseFloat(row.high)) &&
        !isNaN(parseFloat(row.low)) && !isNaN(parseFloat(row.close))
      )
      .map(row => ({
        time: parseInt(row.time),
        open: parseFloat(parseFloat(row.open).toFixed(5)),
        high: parseFloat(parseFloat(row.high).toFixed(5)),
        low: parseFloat(parseFloat(row.low).toFixed(5)),
        close: parseFloat(parseFloat(row.close).toFixed(5))
      }));
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
    if (!this.materializationService) {
      return;
    }

    const startDate = new Date(fromTimestamp * 1000);
    const endDate = new Date(toTimestamp * 1000);

    logger.debug(
      { symbol, startDate, endDate, timeframe },
      'Checking 5m candle coverage'
    );

    // Step 1: Check if 5m candles exist for this range
    const coverage = await this.materializationService.getCandleCoverage(
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

      await this.materializationService.materialize5mCandles(
        symbol,
        range.start,
        range.end
      );
    }

    // Step 3: For higher timeframes, refresh materialized views
    if (timeframe !== '5m' && TIMEFRAME_VIEW_MAP[timeframe]) {
      logger.info({ timeframe }, 'Refreshing materialized view for higher timeframe');

      await this.materializationService.refreshMaterializedViews([timeframe]);
    }

    logger.info({ symbol, timeframe }, 'Materialization complete');
  }
}