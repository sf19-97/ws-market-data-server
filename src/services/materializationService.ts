import { Pool } from 'pg';
import { R2Client } from './r2Client.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger();

export interface Candle {
  time: Date;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

export interface CandleCoverage {
  covered: boolean;
  missingRanges: Array<{ start: Date; end: Date }>;
  totalDays: number;
  coveredDays: number;
}

/**
 * MaterializationService - Materializes pre-built 5m candles from R2 to PostgreSQL
 *
 * Architecture:
 * - R2 stores pre-built 5m candles (cheap storage, built during import)
 * - PostgreSQL stores 5m candles (for fast queries)
 * - Higher timeframes (15m, 1h, 4h, 12h) computed from 5m candles via materialized views
 *
 * Note: Candles are built once during import (see import-to-r2.ts), not here.
 * This service just downloads and inserts pre-computed candles.
 */
export class MaterializationService {
  constructor(
    private pool: Pool,
    private r2Client: R2Client
  ) {}

  /**
   * Insert candles into candles_5m table with ON CONFLICT upsert
   * Uses batching to avoid PostgreSQL parameter limits
   */
  private async insertCandles(candles: Candle[]): Promise<void> {
    if (candles.length === 0) {
      logger.debug('No candles to insert');
      return;
    }

    logger.debug({ candleCount: candles.length }, 'Inserting candles into PostgreSQL');

    // Step 1: Validate candles have all required fields
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
      return;
    }

    if (validCandles.length !== candles.length) {
      logger.warn(
        { original: candles.length, valid: validCandles.length, dropped: candles.length - validCandles.length },
        'Some candles were invalid and dropped'
      );
    }

    // Step 2: Deduplicate by (symbol, time) - keep LAST candle (most recent)
    const dedupeMap = new Map<string, Candle>();
    for (const candle of validCandles) {
      const key = `${candle.symbol}_${candle.time.getTime()}`;
      dedupeMap.set(key, candle); // Overwrites earlier duplicates
    }
    const dedupedCandles = Array.from(dedupeMap.values());

    if (dedupedCandles.length !== validCandles.length) {
      logger.info(
        { original: validCandles.length, deduped: dedupedCandles.length, duplicates: validCandles.length - dedupedCandles.length },
        'Deduplicated candles'
      );
    }

    const client = await this.pool.connect();
    const BATCH_SIZE = 500; // Max candles per batch (500 * 8 = 4000 params, well under 32767 limit)

    try {
      let totalInserted = 0;

      // Process in batches
      for (let batchStart = 0; batchStart < dedupedCandles.length; batchStart += BATCH_SIZE) {
        const batch = dedupedCandles.slice(batchStart, batchStart + BATCH_SIZE);

        // Build values array - push each value individually to avoid any array issues
        const values: (Date | string | number)[] = [];
        const placeholders: string[] = [];

        for (let i = 0; i < batch.length; i++) {
          const candle = batch[i];
          const baseIdx = i * 8;

          placeholders.push(
            `($${baseIdx + 1}, $${baseIdx + 2}, $${baseIdx + 3}, $${baseIdx + 4}, $${baseIdx + 5}, $${baseIdx + 6}, $${baseIdx + 7}, $${baseIdx + 8})`
          );

          // Push each value individually
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

        logger.debug(
          { batchStart, batchSize: batch.length, valuesCount: values.length, placeholdersCount: placeholders.length },
          'Inserting batch'
        );

        const result = await client.query(query, values);
        totalInserted += result.rowCount || 0;
      }

      logger.info({ totalInserted, totalCandles: dedupedCandles.length }, 'Inserted/updated candles');

    } catch (error) {
      logger.error({ error }, 'Failed to insert candles');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Materialize 5-minute candles for a single day
   *
   * Downloads pre-built candles from R2 and inserts into PostgreSQL.
   * Candles are built during import (see import-to-r2.ts), not here.
   *
   * @param symbol Trading symbol (e.g., "EURUSD")
   * @param date Date to materialize
   */
  async materialize5mCandlesForDay(symbol: string, date: Date): Promise<number> {
    logger.debug({ symbol, date }, 'Materializing 5m candles for day');

    try {
      // Step 1: Download pre-built candles from R2
      const candles = await this.r2Client.downloadAllCandles(symbol, date);

      if (candles.length === 0) {
        logger.warn({ symbol, date }, 'No candles found in R2');
        return 0;
      }

      logger.debug({ symbol, date, candleCount: candles.length }, 'Downloaded candles from R2');

      // Step 2: Insert into PostgreSQL
      await this.insertCandles(candles);

      return candles.length;

    } catch (error: any) {
      logger.error({ error, symbol, date }, 'Materialization failed for day');
      throw error;
    }
  }

  /**
   * Materialize 5-minute candles for a date range
   *
   * @param symbol Trading symbol (e.g., "EURUSD")
   * @param startDate Start date (inclusive)
   * @param endDate End date (inclusive)
   * @returns Total number of candles materialized
   */
  async materialize5mCandles(symbol: string, startDate: Date, endDate: Date): Promise<number> {
    logger.info({ symbol, startDate, endDate }, 'Starting 5m candle materialization');

    let currentDate = new Date(startDate);
    let totalCandles = 0;
    let processedDays = 0;

    while (currentDate <= endDate) {
      const candleCount = await this.materialize5mCandlesForDay(symbol, new Date(currentDate));
      totalCandles += candleCount;
      processedDays++;

      // Move to next day
      currentDate = new Date(currentDate);
      currentDate.setDate(currentDate.getDate() + 1);

      // Small delay to avoid hammering R2
      if (currentDate <= endDate) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    logger.info(
      { symbol, startDate, endDate, processedDays, totalCandles },
      'Completed 5m candle materialization'
    );

    return totalCandles;
  }

  /**
   * Check which days have 5m candles in PostgreSQL for a date range
   *
   * @param symbol Trading symbol
   * @param startDate Start date (inclusive)
   * @param endDate End date (inclusive)
   * @returns Coverage information
   */
  async getCandleCoverage(
    symbol: string,
    startDate: Date,
    endDate: Date
  ): Promise<CandleCoverage> {
    logger.debug({ symbol, startDate, endDate }, 'Checking candle coverage');

    const client = await this.pool.connect();

    try {
      // Query to find all distinct days with candles
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
            // Consecutive day, extend range
            rangeEnd = currentDay;
          } else {
            // Gap, save current range and start new one
            missingRanges.push({ start: rangeStart, end: rangeEnd });
            rangeStart = currentDay;
            rangeEnd = currentDay;
          }
        }

        // Save last range
        missingRanges.push({ start: rangeStart, end: rangeEnd });
      }

      const coverage: CandleCoverage = {
        covered: missingRanges.length === 0,
        missingRanges,
        totalDays: allDays.length,
        coveredDays: coveredDays.size
      };

      logger.debug(
        {
          symbol,
          totalDays: coverage.totalDays,
          coveredDays: coverage.coveredDays,
          missingCount: missingRanges.length
        },
        'Coverage check complete'
      );

      return coverage;

    } catch (error) {
      logger.error({ error, symbol, startDate, endDate }, 'Coverage check failed');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check if R2 has candle data for a date range
   *
   * @param symbol Trading symbol
   * @param startDate Start date (inclusive)
   * @param endDate End date (inclusive)
   * @returns True if candles exist in R2
   */
  async checkR2Coverage(symbol: string, startDate: Date, endDate: Date): Promise<boolean> {
    return this.r2Client.hasCandlesForDateRange(symbol, startDate, endDate);
  }

  /**
   * Refresh materialized views for higher timeframes
   * NOTE: This can be slow and locks the views during refresh
   *
   * @param timeframes Optional list of timeframes to refresh (default: all)
   */
  async refreshMaterializedViews(timeframes?: string[]): Promise<void> {
    const viewMap: Record<string, string> = {
      '15m': 'candles_15m',
      '1h': 'candles_1h',
      '4h': 'candles_4h',
      '12h': 'candles_12h'
    };

    const toRefresh = timeframes || Object.keys(viewMap);

    logger.info({ timeframes: toRefresh }, 'Refreshing materialized views');

    for (const tf of toRefresh) {
      const viewName = viewMap[tf];

      if (!viewName) {
        logger.warn({ timeframe: tf }, 'Unknown timeframe, skipping');
        continue;
      }

      try {
        logger.debug({ viewName }, 'Refreshing materialized view');

        await this.pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName}`);

        logger.info({ viewName }, 'Materialized view refreshed');
      } catch (error) {
        logger.error({ error, viewName }, 'Failed to refresh materialized view');
        throw error;
      }
    }
  }
}
