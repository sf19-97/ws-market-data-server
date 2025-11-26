#!/usr/bin/env tsx
import dotenv from 'dotenv';
import { getR2Client, Tick, Candle } from '../services/r2Client.js';
import { ListObjectsV2Command, ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { createLogger } from '../utils/logger.js';

dotenv.config();

const logger = createLogger();

/**
 * Migrate tick data from R2 to candle data
 *
 * This script:
 * 1. Lists all tick files in R2
 * 2. For each tick file:
 *    - Downloads ticks
 *    - Builds 5-minute candles
 *    - Uploads candles to candles/{SYMBOL}/{DATE}/
 * 3. Optionally deletes old tick files after successful migration
 *
 * Usage:
 *   npx tsx src/scripts/migrate-ticks-to-candles.ts [--symbol EURUSD] [--dry-run] [--delete-ticks]
 */
class TickToCandleMigrator {
  private r2Client = getR2Client();

  constructor() {
    if (!this.r2Client) {
      throw new Error('R2 client not configured');
    }
  }

  /**
   * Build 5-minute candles from tick data
   * Uses midpoint price (bid + ask) / 2
   *
   * NOTE: This is the SAME logic as import-to-r2.ts
   */
  private buildFiveMinuteCandles(symbol: string, ticks: Tick[]): Candle[] {
    if (ticks.length === 0) return [];

    const candles: Candle[] = [];
    const bucketSizeSeconds = 5 * 60; // 5 minutes in seconds

    let currentBucketStart: number | null = null;
    let currentCandle: Partial<Candle> | null = null;
    let tickCount = 0;

    for (const tick of ticks) {
      // Calculate bucket start time (floor to nearest 5 minutes)
      const bucketStart = Math.floor(tick.timestamp / bucketSizeSeconds) * bucketSizeSeconds;

      // New bucket? Save previous candle and start new one
      if (bucketStart !== currentBucketStart) {
        if (currentCandle && currentBucketStart !== null) {
          candles.push({
            time: new Date(currentBucketStart * 1000), // Convert to milliseconds for Date
            symbol,
            open: currentCandle.open!,
            high: currentCandle.high!,
            low: currentCandle.low!,
            close: currentCandle.close!,
            volume: 0, // We don't have volume data from Dukascopy ticks
            trades: tickCount
          });
        }

        // Start new candle
        const midPrice = (tick.bid + tick.ask) / 2;
        currentBucketStart = bucketStart;
        currentCandle = {
          open: midPrice,
          high: midPrice,
          low: midPrice,
          close: midPrice
        };
        tickCount = 1;
      } else {
        // Update current candle
        const midPrice = (tick.bid + tick.ask) / 2;
        currentCandle!.high = Math.max(currentCandle!.high!, midPrice);
        currentCandle!.low = Math.min(currentCandle!.low!, midPrice);
        currentCandle!.close = midPrice;
        tickCount++;
      }
    }

    // Save last candle
    if (currentCandle && currentBucketStart !== null) {
      candles.push({
        time: new Date(currentBucketStart * 1000),
        symbol,
        open: currentCandle.open!,
        high: currentCandle.high!,
        low: currentCandle.low!,
        close: currentCandle.close!,
        volume: 0,
        trades: tickCount
      });
    }

    return candles;
  }

  /**
   * Parse tick file key to extract metadata
   * Example: ticks/EURUSD/2024/01/15/part-1234567890.json
   */
  private parseTickKey(key: string): { symbol: string; year: string; month: string; day: string } | null {
    const parts = key.split('/');
    if (parts.length !== 6 || parts[0] !== 'ticks') {
      return null;
    }

    const [, symbol, year, month, day] = parts;

    return { symbol, year, month, day };
  }

  /**
   * Group tick files by symbol/year/month
   * Returns: Map<"SYMBOL/YYYY/MM", string[]>
   */
  private groupTickFilesByMonth(tickKeys: string[]): Map<string, string[]> {
    const groups = new Map<string, string[]>();

    for (const key of tickKeys) {
      const metadata = this.parseTickKey(key);
      if (!metadata) continue;

      const { symbol, year, month } = metadata;
      const monthKey = `${symbol}/${year}/${month}`;

      if (!groups.has(monthKey)) {
        groups.set(monthKey, []);
      }
      groups.get(monthKey)!.push(key);
    }

    return groups;
  }

  /**
   * Migrate all tick files for a given month into a single candle file
   */
  private async migrateMonth(
    symbol: string,
    year: string,
    month: string,
    tickKeys: string[],
    dryRun: boolean
  ): Promise<{ success: boolean; tickCount: number; candleCount: number }> {
    const monthKey = `${symbol}/${year}/${month}`;

    try {
      // Download ALL tick files for this month
      console.log(`   📥 Downloading ${tickKeys.length} tick files...`);
      const allTicks: Tick[] = [];

      for (const tickKey of tickKeys) {
        const ticks = await this.r2Client!.downloadTickFile(tickKey);
        // Use concat instead of spread to avoid stack overflow with large arrays
        for (const tick of ticks) {
          allTicks.push(tick);
        }
      }

      if (allTicks.length === 0) {
        logger.warn({ monthKey }, 'No ticks found for month');
        return { success: true, tickCount: 0, candleCount: 0 };
      }

      // Sort ticks by timestamp (important for candle building)
      allTicks.sort((a, b) => a.timestamp - b.timestamp);

      // Build candles from ALL ticks in the month
      console.log(`   🕯️  Building candles from ${allTicks.length.toLocaleString()} ticks...`);
      const candles = this.buildFiveMinuteCandles(symbol, allTicks);

      if (dryRun) {
        logger.info(
          { monthKey, fileCount: tickKeys.length, tickCount: allTicks.length, candleCount: candles.length },
          '[DRY RUN] Would migrate month'
        );
        return { success: true, tickCount: allTicks.length, candleCount: candles.length };
      }

      // Upload as ONE monthly file
      // Use explicit Date constructor to avoid timezone parsing issues
      const date = new Date(parseInt(year), parseInt(month) - 1, 1);
      const candleKey = await this.r2Client!.uploadCandles(symbol, date, candles);

      console.log(`   ✅ Uploaded to: ${candleKey}`);
      logger.info(
        { monthKey, candleKey, fileCount: tickKeys.length, tickCount: allTicks.length, candleCount: candles.length },
        'Migrated month to candles'
      );

      return { success: true, tickCount: allTicks.length, candleCount: candles.length };

    } catch (error: any) {
      console.error(`   ❌ Error: ${error.message || error}`);
      if (error.stack) {
        logger.error({ error: error.stack, monthKey }, 'Failed to migrate month');
      } else {
        logger.error({ error: String(error), monthKey }, 'Failed to migrate month');
      }
      return { success: false, tickCount: 0, candleCount: 0 };
    }
  }

  /**
   * List all tick files in R2 (optionally filtered by symbol)
   */
  private async listTickFiles(symbol?: string): Promise<string[]> {
    const prefix = symbol ? `ticks/${symbol}/` : 'ticks/';
    const keys: string[] = [];
    let continuationToken: string | undefined = undefined;

    do {
      const command: ListObjectsV2Command = new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME!,
        Prefix: prefix,
        ContinuationToken: continuationToken
      });

      const response: ListObjectsV2CommandOutput = await this.r2Client!.s3Client.send(command);

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (obj.Key && obj.Key.endsWith('.json') && obj.Key !== 'ticks/') {
            keys.push(obj.Key);
          }
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return keys;
  }

  /**
   * Delete tick files after successful migration
   */
  private async deleteTickFiles(tickKeys: string[], dryRun: boolean): Promise<number> {
    if (dryRun) {
      console.log(`\n[DRY RUN] Would delete ${tickKeys.length} tick files`);
      return 0;
    }

    console.log(`\n🗑️  Deleting ${tickKeys.length} tick files...`);

    let deletedCount = 0;

    // Delete in batches of 100 (S3 batch delete limit is 1000)
    for (let i = 0; i < tickKeys.length; i += 100) {
      const batch = tickKeys.slice(i, i + 100);

      try {
        const { DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
        const command = new DeleteObjectsCommand({
          Bucket: process.env.R2_BUCKET_NAME!,
          Delete: {
            Objects: batch.map(Key => ({ Key }))
          }
        });

        await this.r2Client!.s3Client.send(command);
        deletedCount += batch.length;

        console.log(`   Deleted ${deletedCount}/${tickKeys.length} files`);

      } catch (error: any) {
        logger.error({ error, batchStart: i }, 'Failed to delete tick files');
      }
    }

    return deletedCount;
  }

  /**
   * Run the migration
   */
  async migrate(options: { symbol?: string; dryRun: boolean; deleteTicks: boolean }): Promise<void> {
    const { symbol, dryRun, deleteTicks } = options;

    console.log('\n🔄 Starting tick-to-candle migration');
    console.log(`   Symbol filter: ${symbol || 'ALL'}`);
    console.log(`   Dry run: ${dryRun}`);
    console.log(`   Delete ticks after migration: ${deleteTicks}\n`);

    // List all tick files
    console.log('📂 Listing tick files...');
    const tickKeys = await this.listTickFiles(symbol);

    console.log(`   Found ${tickKeys.length} tick files\n`);

    if (tickKeys.length === 0) {
      console.log('✅ No tick files to migrate');
      return;
    }

    // Group tick files by month
    console.log('📊 Grouping tick files by month...');
    const monthGroups = this.groupTickFilesByMonth(tickKeys);
    console.log(`   Found ${monthGroups.size} months to process\n`);

    // Migrate each month
    let processedCount = 0;
    let successCount = 0;
    let failureCount = 0;
    let totalTicks = 0;
    let totalCandles = 0;

    const startTime = Date.now();

    for (const [monthKey, monthTickKeys] of monthGroups) {
      processedCount++;
      const progress = `[${processedCount}/${monthGroups.size}]`;

      const [symbol, year, month] = monthKey.split('/');
      console.log(`\n${progress} ${monthKey} (${monthTickKeys.length} files)`);

      const result = await this.migrateMonth(symbol, year, month, monthTickKeys, dryRun);

      if (result.success) {
        successCount++;
        totalTicks += result.tickCount;
        totalCandles += result.candleCount;
        console.log(`   ✅ ${result.tickCount.toLocaleString()} ticks → ${result.candleCount.toLocaleString()} candles`);
      } else {
        failureCount++;
        console.log(`   ❌ Failed`);
      }

      // Small delay to avoid hammering R2
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const elapsedMinutes = ((Date.now() - startTime) / 1000 / 60).toFixed(2);

    // Delete tick files if requested
    if (deleteTicks && !dryRun && successCount > 0) {
      await this.deleteTickFiles(tickKeys, dryRun);
    }

    // Summary
    console.log('\n📊 Migration Summary:');
    console.log(`   Total months: ${processedCount}`);
    console.log(`   Successful: ${successCount}`);
    console.log(`   Failed: ${failureCount}`);
    console.log(`   Total tick files: ${tickKeys.length}`);
    console.log(`   Total ticks processed: ${totalTicks.toLocaleString()}`);
    console.log(`   Total candles created: ${totalCandles.toLocaleString()}`);
    console.log(`   Time elapsed: ${elapsedMinutes} minutes`);
    console.log(`   Dry run: ${dryRun ? 'YES (no changes made)' : 'NO'}`);

    if (dryRun) {
      console.log('\n💡 Run without --dry-run to perform actual migration');
    } else {
      console.log('\n🎉 Migration complete!');
    }
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  const options = {
    symbol: undefined as string | undefined,
    dryRun: args.includes('--dry-run'),
    deleteTicks: args.includes('--delete-ticks')
  };

  // Parse --symbol argument
  const symbolIndex = args.indexOf('--symbol');
  if (symbolIndex !== -1 && args[symbolIndex + 1]) {
    options.symbol = args[symbolIndex + 1].toUpperCase();
  }

  const migrator = new TickToCandleMigrator();

  try {
    await migrator.migrate(options);
  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    logger.error({ error }, 'Migration failed');
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { TickToCandleMigrator };
