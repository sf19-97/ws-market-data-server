import { Pool } from 'pg';
import { Candle } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger();

/**
 * Candle data access object with validation for batch operations
 */
export interface CandleRow {
  time: Date;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

/**
 * Coverage result for date range queries
 */
export interface CoverageResult {
  covered: boolean;
  missingRanges: Array<{ start: Date; end: Date }>;
  totalDays: number;
  coveredDays: number;
}

/**
 * Repository for candle data access
 *
 * Encapsulates all database operations for candles, including:
 * - Querying materialized views for different timeframes
 * - Batch inserting candles with deduplication
 * - Checking coverage for date ranges
 */
export class CandlesRepository {
  constructor(private pool: Pool) {}

  /**
   * Query candles from the appropriate materialized view
   *
   * @param viewName - Name of the materialized view (e.g., 'forex_candles_1h')
   * @param symbol - Trading symbol
   * @param from - Start timestamp (Unix seconds)
   * @param to - End timestamp (Unix seconds)
   * @returns Array of candles ordered by time
   */
  async getCandlesByView(
    viewName: string,
    symbol: string,
    from: number,
    to: number
  ): Promise<Candle[]> {
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
   * Insert candles into candles_5m table with upsert semantics
   *
   * Handles validation, deduplication, and batching automatically.
   *
   * @param candles - Array of candles to insert
   * @returns Number of rows affected
   */
  async insertCandles(candles: CandleRow[]): Promise<number> {
    if (candles.length === 0) {
      logger.debug('No candles to insert');
      return 0;
    }

    logger.debug({ candleCount: candles.length }, 'Inserting candles into PostgreSQL');

    // Step 1: Validate candles
    const validCandles = candles.filter(c => {
      const isValid = c.time instanceof Date &&
        typeof c.symbol === 'string' && c.symbol.length > 0 &&
        typeof c.open === 'number' && !isNaN(c.open) &&
        typeof c.high === 'number' && !isNaN(c.high) &&
        typeof c.low === 'number' && !isNaN(c.low) &&
        typeof c.close === 'number' && !isNaN(c.close) &&
        typeof c.volume === 'number' &&
        typeof c.trades === 'number';

      if (!isValid) {
        logger.warn({ candle: c }, 'Invalid candle skipped');
      }
      return isValid;
    });

    if (validCandles.length === 0) {
      logger.warn('No valid candles to insert after validation');
      return 0;
    }

    // Step 2: Deduplicate by (symbol, time)
    const dedupeMap = new Map<string, CandleRow>();
    for (const candle of validCandles) {
      const key = `${candle.symbol}_${candle.time.getTime()}`;
      dedupeMap.set(key, candle);
    }
    const dedupedCandles = Array.from(dedupeMap.values());

    if (dedupedCandles.length !== validCandles.length) {
      logger.info(
        { original: validCandles.length, deduped: dedupedCandles.length },
        'Deduplicated candles'
      );
    }

    const client = await this.pool.connect();
    const BATCH_SIZE = 500;

    try {
      let totalInserted = 0;

      for (let batchStart = 0; batchStart < dedupedCandles.length; batchStart += BATCH_SIZE) {
        const batch = dedupedCandles.slice(batchStart, batchStart + BATCH_SIZE);

        const values: (Date | string | number)[] = [];
        const placeholders: string[] = [];

        for (let i = 0; i < batch.length; i++) {
          const candle = batch[i];
          const baseIdx = i * 8;

          placeholders.push(
            `($${baseIdx + 1}, $${baseIdx + 2}, $${baseIdx + 3}, $${baseIdx + 4}, $${baseIdx + 5}, $${baseIdx + 6}, $${baseIdx + 7}, $${baseIdx + 8})`
          );

          values.push(candle.time);
          values.push(candle.symbol);
          values.push(candle.open);
          values.push(candle.high);
          values.push(candle.low);
          values.push(candle.close);
          values.push(candle.volume);
          values.push(candle.trades);
        }

        const query = `
          INSERT INTO candles_5m (time, symbol, open, high, low, close, volume, trades)
          VALUES ${placeholders.join(', ')}
          ON CONFLICT (symbol, time) DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume,
            trades = EXCLUDED.trades
        `;

        const result = await client.query(query, values);
        totalInserted += result.rowCount || 0;
      }

      logger.info({ totalInserted, totalCandles: dedupedCandles.length }, 'Inserted/updated candles');
      return totalInserted;

    } finally {
      client.release();
    }
  }

  /**
   * Check candle coverage for a date range
   *
   * @param symbol - Trading symbol
   * @param startDate - Start date (inclusive)
   * @param endDate - End date (inclusive)
   * @returns Coverage information with missing ranges
   */
  async getCoverage(
    symbol: string,
    startDate: Date,
    endDate: Date
  ): Promise<CoverageResult> {
    const client = await this.pool.connect();

    try {
      const result = await client.query(
        `
        SELECT DISTINCT DATE(time) as day
        FROM candles_5m
        WHERE symbol = $1
          AND time >= $2
          AND time < $3::timestamp + INTERVAL '1 day'
        ORDER BY day
        `,
        [symbol, startDate, endDate]
      );

      const coveredDays = new Set(result.rows.map(row => row.day.toISOString().split('T')[0]));

      // Calculate all days in range
      const allDays: string[] = [];
      let currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        allDays.push(currentDate.toISOString().split('T')[0]);
        currentDate = new Date(currentDate);
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Find missing days
      const missingDays = allDays.filter(day => !coveredDays.has(day));

      // Build missing ranges
      const missingRanges: Array<{ start: Date; end: Date }> = [];

      if (missingDays.length > 0) {
        let rangeStart = new Date(missingDays[0]);
        let rangeEnd = new Date(missingDays[0]);

        for (let i = 1; i < missingDays.length; i++) {
          const currentDay = new Date(missingDays[i]);
          const dayDiff = (currentDay.getTime() - rangeEnd.getTime()) / (1000 * 60 * 60 * 24);

          if (dayDiff === 1) {
            rangeEnd = currentDay;
          } else {
            missingRanges.push({ start: rangeStart, end: rangeEnd });
            rangeStart = currentDay;
            rangeEnd = currentDay;
          }
        }

        missingRanges.push({ start: rangeStart, end: rangeEnd });
      }

      return {
        covered: missingRanges.length === 0,
        missingRanges,
        totalDays: allDays.length,
        coveredDays: coveredDays.size
      };

    } finally {
      client.release();
    }
  }

  /**
   * Refresh a materialized view
   *
   * @param viewName - Name of the view to refresh
   */
  async refreshMaterializedView(viewName: string): Promise<void> {
    logger.debug({ viewName }, 'Refreshing materialized view');
    await this.pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName}`);
    logger.info({ viewName }, 'Materialized view refreshed');
  }
}
