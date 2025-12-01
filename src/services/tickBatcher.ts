import { getR2Client, Tick } from './r2Client.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger();

interface BatchConfig {
  maxBatchSize?: number;      // Upload after N ticks (default: 1000)
  maxBatchAgeMs?: number;      // Upload after N milliseconds (default: 5 minutes)
}

interface SymbolBatch {
  ticks: Tick[];
  firstTickTime: number;      // Timestamp of first tick in batch
  lastUpdated: number;        // When batch was last updated
}

/**
 * TickBatcher - Accumulates live ticks and uploads to R2 in batches
 *
 * Batches are uploaded when either:
 * - Batch size reaches maxBatchSize (default: 1000 ticks)
 * - Batch age reaches maxBatchAgeMs (default: 5 minutes)
 */
export class TickBatcher {
  private batches = new Map<string, SymbolBatch>();
  private r2Client = getR2Client();
  private config: Required<BatchConfig>;
  private flushTimer?: NodeJS.Timeout;

  constructor(config: BatchConfig = {}) {
    this.config = {
      maxBatchSize: config.maxBatchSize || 1000,
      maxBatchAgeMs: config.maxBatchAgeMs || 5 * 60 * 1000 // 5 minutes
    };

    if (!this.r2Client) {
      logger.warn('TickBatcher initialized but R2 client not available - batching disabled');
    } else {
      logger.info(this.config, 'TickBatcher initialized');
      this.startFlushTimer();
    }
  }

  /**
   * Start periodic flush timer to upload aged batches
   */
  private startFlushTimer(): void {
    // Check every minute for batches that need flushing
    this.flushTimer = setInterval(() => {
      this.flushAgedBatches().catch((err) => {
        logger.error({ err }, 'Failed to flush aged batches');
      });
    }, 60 * 1000);
  }

  /**
   * Add a tick to the batch
   */
  async addTick(symbol: string, timestamp: number, bid: number, ask: number): Promise<void> {
    if (!this.r2Client) {
      return; // R2 not configured, skip batching
    }

    // PATCH 3: Validate tick data before batching
    if (!Number.isFinite(timestamp) || !Number.isFinite(bid) || !Number.isFinite(ask)) {
      logger.warn({ symbol, timestamp, bid, ask }, 'Rejecting malformed tick in TickBatcher');
      return;
    }

    // Sanity check: timestamp should be reasonable (2020-2030 range in Unix seconds)
    const minTs = 1577836800; // 2020-01-01
    const maxTs = 1893456000; // 2030-01-01
    if (timestamp < minTs || timestamp > maxTs) {
      logger.warn({ symbol, timestamp }, 'Rejecting tick with absurd timestamp in TickBatcher');
      return;
    }

    // Sanity check: prices should be positive
    if (bid <= 0 || ask <= 0) {
      logger.warn({ symbol, bid, ask }, 'Rejecting tick with non-positive price in TickBatcher');
      return;
    }

    const tick: Tick = { timestamp, bid, ask };

    // Get or create batch for this symbol
    let batch = this.batches.get(symbol);
    if (!batch) {
      batch = {
        ticks: [],
        firstTickTime: timestamp,
        lastUpdated: Date.now()
      };
      this.batches.set(symbol, batch);
    }

    // Add tick to batch
    batch.ticks.push(tick);
    batch.lastUpdated = Date.now();

    // Check if batch is full
    if (batch.ticks.length >= this.config.maxBatchSize) {
      logger.debug({ symbol, batchSize: batch.ticks.length }, 'Batch size limit reached, flushing');
      await this.flushBatch(symbol);
    }
  }

  /**
   * Flush a specific symbol's batch to R2
   */
  private async flushBatch(symbol: string): Promise<void> {
    const batch = this.batches.get(symbol);
    if (!batch || batch.ticks.length === 0) {
      return;
    }

    if (!this.r2Client) {
      logger.warn('Cannot flush batch - R2 client not available');
      return;
    }

    try {
      // Use the date from the first tick for partitioning
      const date = new Date(batch.firstTickTime * 1000);

      logger.info(
        { symbol, tickCount: batch.ticks.length, date: date.toISOString().split('T')[0] },
        'Uploading tick batch to R2'
      );

      const key = await this.r2Client.uploadTicks(symbol, date, batch.ticks);

      logger.info({ symbol, tickCount: batch.ticks.length, key }, 'Batch uploaded successfully');

      // Clear batch
      this.batches.delete(symbol);

    } catch (error: any) {
      logger.error({ error, symbol, tickCount: batch.ticks.length }, 'Failed to upload batch to R2');
      // Don't delete batch on error - will retry on next flush
    }
  }

  /**
   * Flush batches that have exceeded max age
   */
  private async flushAgedBatches(): Promise<void> {
    const now = Date.now();
    const promises: Promise<void>[] = [];

    for (const [symbol, batch] of this.batches.entries()) {
      const age = now - batch.lastUpdated;

      if (age >= this.config.maxBatchAgeMs) {
        logger.debug({ symbol, ageMs: age, tickCount: batch.ticks.length }, 'Batch age limit reached, flushing');
        promises.push(this.flushBatch(symbol));
      }
    }

    // Flush all aged batches in parallel
    await Promise.all(promises);
  }

  /**
   * Flush all batches immediately (useful for graceful shutdown)
   */
  async flushAll(): Promise<void> {
    logger.info('Flushing all batches...');

    const promises: Promise<void>[] = [];
    for (const symbol of this.batches.keys()) {
      promises.push(this.flushBatch(symbol));
    }

    await Promise.all(promises);
    logger.info('All batches flushed');
  }

  /**
   * Stop the batcher and flush remaining ticks
   */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    await this.flushAll();
  }

  /**
   * Get current batch stats (for monitoring/debugging)
   */
  getStats(): Record<string, { tickCount: number; ageMs: number }> {
    const now = Date.now();
    const stats: Record<string, { tickCount: number; ageMs: number }> = {};

    for (const [symbol, batch] of this.batches.entries()) {
      stats[symbol] = {
        tickCount: batch.ticks.length,
        ageMs: now - batch.lastUpdated
      };
    }

    return stats;
  }
}
