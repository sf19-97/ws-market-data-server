#!/usr/bin/env tsx
/**
 * Migrate command - Migrates tick data from R2 to candle data
 *
 * This script:
 * 1. Lists all tick files in R2
 * 2. For each tick file, downloads ticks, builds 5-minute candles, uploads to candles/
 * 3. Optionally deletes old tick files after successful migration
 *
 * Usage:
 *   npx tsx src/cli/commands/migrate.ts <SYMBOL> <START_DATE> <END_DATE> [--dry-run] [--delete-ticks]
 *   npx tsx src/cli/commands/migrate.ts --symbol <SYMBOL> [--dry-run] [--delete-ticks]
 *
 * Examples:
 *   npx tsx src/cli/commands/migrate.ts EURUSD 2025-01-01 2025-10-31
 *   npx tsx src/cli/commands/migrate.ts --symbol EURUSD --dry-run
 */
import dotenv from 'dotenv';
import { getR2Client, Tick, Candle } from '../../services/r2Client.js';
import { ListObjectsV2Command, ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { createLogger } from '../../utils/logger.js';

dotenv.config();

const logger = createLogger();

/**
 * Migrate tick data from R2 to candle data
 */
export class TickToCandleMigrator {
  private r2Client = getR2Client();

  constructor() {
    if (!this.r2Client) {
      throw new Error('R2 client not configured');
    }
  }

  private buildFiveMinuteCandles(symbol: string, ticks: Tick[]): Candle[] {
    if (ticks.length === 0) return [];

    const candles: Candle[] = [];
    const bucketSizeSeconds = 5 * 60;

    let currentBucketStart: number | null = null;
    let currentCandle: Partial<Candle> | null = null;
    let tickCount = 0;

    const round5 = (n: number) => Math.round(n * 100000) / 100000;

    for (const tick of ticks) {
      const bucketStart = Math.floor(tick.timestamp / bucketSizeSeconds) * bucketSizeSeconds;

      if (bucketStart !== currentBucketStart) {
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

        const midPrice = round5((tick.bid + tick.ask) / 2);
        currentBucketStart = bucketStart;
        currentCandle = {
          open: midPrice,
          high: midPrice,
          low: midPrice,
          close: midPrice
        };
        tickCount = 1;
      } else {
        const midPrice = round5((tick.bid + tick.ask) / 2);
        currentCandle!.high = Math.max(currentCandle!.high!, midPrice);
        currentCandle!.low = Math.min(currentCandle!.low!, midPrice);
        currentCandle!.close = midPrice;
        tickCount++;
      }
    }

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

  private cleanTicks(ticks: Tick[], qualityThreshold: number = 5): Tick[] {
    if (ticks.length === 0) return [];

    const stats = {
      total: ticks.length,
      invalidTimestamp: 0,
      invalidBid: 0,
      invalidAsk: 0,
      invalidSpread: 0,
      duplicates: 0
    };

    const validTicks: Tick[] = [];

    for (const tick of ticks) {
      if (!Number.isFinite(tick.timestamp) || tick.timestamp <= 0) {
        stats.invalidTimestamp++;
        continue;
      }
      if (!Number.isFinite(tick.bid) || tick.bid <= 0) {
        stats.invalidBid++;
        continue;
      }
      if (!Number.isFinite(tick.ask) || tick.ask <= 0) {
        stats.invalidAsk++;
        continue;
      }
      if (tick.bid >= tick.ask) {
        stats.invalidSpread++;
        continue;
      }
      validTicks.push(tick);
    }

    const deduped = new Map<number, Tick>();
    for (const tick of validTicks) {
      deduped.set(tick.timestamp, tick);
    }

    stats.duplicates = validTicks.length - deduped.size;

    const cleanedTicks = Array.from(deduped.values()).sort((a, b) => a.timestamp - b.timestamp);

    const totalDropped = stats.invalidTimestamp + stats.invalidBid + stats.invalidAsk + stats.invalidSpread;
    const dropPercent = (totalDropped / stats.total) * 100;

    console.log(`   🧹 Tick cleaning: ${stats.total.toLocaleString()} → ${cleanedTicks.length.toLocaleString()}`);
    if (totalDropped > 0 || stats.duplicates > 0) {
      console.log(`      Dropped: ${totalDropped} invalid (${dropPercent.toFixed(2)}%)`);
      if (stats.invalidTimestamp > 0) console.log(`        - Invalid timestamp: ${stats.invalidTimestamp}`);
      if (stats.invalidBid > 0) console.log(`        - Invalid bid: ${stats.invalidBid}`);
      if (stats.invalidAsk > 0) console.log(`        - Invalid ask: ${stats.invalidAsk}`);
      if (stats.invalidSpread > 0) console.log(`        - Invalid spread (bid >= ask): ${stats.invalidSpread}`);
      if (stats.duplicates > 0) console.log(`      Deduped: ${stats.duplicates} duplicates removed (kept last)`);
    }

    if (dropPercent > qualityThreshold) {
      throw new Error(
        `Quality gate failed: ${dropPercent.toFixed(2)}% bad ticks exceeds ${qualityThreshold}% threshold. ` +
        `(${totalDropped} dropped out of ${stats.total})`
      );
    }

    return cleanedTicks;
  }

  private parseTickKey(key: string): { symbol: string; year: string; month: string; day: string } | null {
    const parts = key.split('/');
    if (parts.length !== 6 || parts[0] !== 'ticks') {
      return null;
    }
    const [, symbol, year, month, day] = parts;
    return { symbol, year, month, day };
  }

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

  private async migrateMonth(
    symbol: string,
    year: string,
    month: string,
    tickKeys: string[],
    dryRun: boolean
  ): Promise<{ success: boolean; tickCount: number; candleCount: number }> {
    const monthKey = `${symbol}/${year}/${month}`;

    try {
      console.log(`   📥 Downloading ${tickKeys.length} tick files...`);
      const allTicks: Tick[] = [];

      for (const tickKey of tickKeys) {
        const ticks = await this.r2Client!.downloadTickFile(tickKey);
        for (const tick of ticks) {
          allTicks.push(tick);
        }
      }

      if (allTicks.length === 0) {
        logger.warn({ monthKey }, 'No ticks found for month');
        return { success: true, tickCount: 0, candleCount: 0 };
      }

      allTicks.sort((a, b) => a.timestamp - b.timestamp);

      const cleanedTicks = this.cleanTicks(allTicks);

      console.log(`   🕯️  Building candles from ${cleanedTicks.length.toLocaleString()} clean ticks...`);
      const candles = this.buildFiveMinuteCandles(symbol, cleanedTicks);

      if (dryRun) {
        logger.info(
          { monthKey, fileCount: tickKeys.length, tickCount: cleanedTicks.length, candleCount: candles.length },
          '[DRY RUN] Would migrate month'
        );
        return { success: true, tickCount: cleanedTicks.length, candleCount: candles.length };
      }

      const date = new Date(parseInt(year), parseInt(month) - 1, 1);
      const candleKey = await this.r2Client!.uploadCandles(symbol, date, candles);

      console.log(`   ✅ Uploaded to: ${candleKey}`);
      logger.info(
        { monthKey, candleKey, fileCount: tickKeys.length, tickCount: cleanedTicks.length, candleCount: candles.length },
        'Migrated month to candles'
      );

      return { success: true, tickCount: cleanedTicks.length, candleCount: candles.length };

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

  private async deleteTickFiles(tickKeys: string[], dryRun: boolean): Promise<number> {
    if (dryRun) {
      console.log(`\n[DRY RUN] Would delete ${tickKeys.length} tick files`);
      return 0;
    }

    console.log(`\n🗑️  Deleting ${tickKeys.length} tick files...`);

    let deletedCount = 0;

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

  async migrateRange(
    symbol: string,
    startDate: Date,
    endDate: Date,
    options: { dryRun: boolean; deleteTicks: boolean }
  ): Promise<void> {
    const { dryRun, deleteTicks } = options;

    console.log('\n🔄 Starting tick-to-candle migration (date range)');
    console.log(`   Symbol: ${symbol}`);
    console.log(`   From: ${startDate.toISOString().split('T')[0]}`);
    console.log(`   To: ${endDate.toISOString().split('T')[0]}`);
    console.log(`   Dry run: ${dryRun}`);
    console.log(`   Delete ticks after migration: ${deleteTicks}\n`);

    console.log('📂 Listing tick files...');
    const allTickKeys = await this.listTickFiles(symbol);

    const tickKeys = allTickKeys.filter(key => {
      const metadata = this.parseTickKey(key);
      if (!metadata) return false;

      const { year, month, day } = metadata;
      const fileDate = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));

      return fileDate >= startDate && fileDate <= endDate;
    });

    console.log(`   Found ${tickKeys.length} tick files in date range (${allTickKeys.length} total)\n`);

    if (tickKeys.length === 0) {
      console.log('✅ No tick files to migrate in date range');
      return;
    }

    console.log('📊 Grouping tick files by month...');
    const monthGroups = this.groupTickFilesByMonth(tickKeys);
    console.log(`   Found ${monthGroups.size} months to process\n`);

    let processedCount = 0;
    let successCount = 0;
    let failureCount = 0;
    let totalTicks = 0;
    let totalCandles = 0;

    const startTime = Date.now();

    for (const [monthKey, monthTickKeys] of monthGroups) {
      processedCount++;
      const progress = `[${processedCount}/${monthGroups.size}]`;

      const [sym, year, month] = monthKey.split('/');
      console.log(`\n${progress} ${monthKey} (${monthTickKeys.length} files)`);

      const result = await this.migrateMonth(sym, year, month, monthTickKeys, dryRun);

      if (result.success) {
        successCount++;
        totalTicks += result.tickCount;
        totalCandles += result.candleCount;
        console.log(`   ✅ ${result.tickCount.toLocaleString()} ticks → ${result.candleCount.toLocaleString()} candles`);
      } else {
        failureCount++;
        console.log(`   ❌ Failed`);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const elapsedMinutes = ((Date.now() - startTime) / 1000 / 60).toFixed(2);

    if (deleteTicks && !dryRun && successCount > 0) {
      await this.deleteTickFiles(tickKeys, dryRun);
    }

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

  async migrate(options: { symbol?: string; dryRun: boolean; deleteTicks: boolean }): Promise<void> {
    const { symbol, dryRun, deleteTicks } = options;

    console.log('\n🔄 Starting tick-to-candle migration');
    console.log(`   Symbol filter: ${symbol || 'ALL'}`);
    console.log(`   Dry run: ${dryRun}`);
    console.log(`   Delete ticks after migration: ${deleteTicks}\n`);

    console.log('📂 Listing tick files...');
    const tickKeys = await this.listTickFiles(symbol);

    console.log(`   Found ${tickKeys.length} tick files\n`);

    if (tickKeys.length === 0) {
      console.log('✅ No tick files to migrate');
      return;
    }

    console.log('📊 Grouping tick files by month...');
    const monthGroups = this.groupTickFilesByMonth(tickKeys);
    console.log(`   Found ${monthGroups.size} months to process\n`);

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

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const elapsedMinutes = ((Date.now() - startTime) / 1000 / 60).toFixed(2);

    if (deleteTicks && !dryRun && successCount > 0) {
      await this.deleteTickFiles(tickKeys, dryRun);
    }

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

async function main() {
  const args = process.argv.slice(2);

  if (args.length >= 3 && !args[0].startsWith('--')) {
    const symbol = args[0].toUpperCase();
    const startDate = new Date(args[1] + 'T00:00:00Z');
    const endDate = new Date(args[2] + 'T23:59:59Z');
    const dryRun = args.includes('--dry-run');
    const deleteTicks = args.includes('--delete-ticks');

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.error('❌ Invalid date format. Use YYYY-MM-DD');
      process.exit(1);
    }

    const migrator = new TickToCandleMigrator();

    try {
      await migrator.migrateRange(symbol, startDate, endDate, { dryRun, deleteTicks });
    } catch (error: any) {
      console.error('\n❌ Migration failed:', error.message);
      logger.error({ error }, 'Migration failed');
      process.exit(1);
    }
    return;
  }

  const options = {
    symbol: undefined as string | undefined,
    dryRun: args.includes('--dry-run'),
    deleteTicks: args.includes('--delete-ticks')
  };

  const symbolIndex = args.indexOf('--symbol');
  if (symbolIndex !== -1 && args[symbolIndex + 1]) {
    options.symbol = args[symbolIndex + 1].toUpperCase();
  }

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  npx tsx src/cli/commands/migrate.ts <SYMBOL> <START_DATE> <END_DATE> [--dry-run] [--delete-ticks]');
    console.log('  npx tsx src/cli/commands/migrate.ts --symbol <SYMBOL> [--dry-run] [--delete-ticks]');
    console.log('');
    console.log('Examples:');
    console.log('  npx tsx src/cli/commands/migrate.ts EURUSD 2025-01-01 2025-10-31');
    console.log('  npx tsx src/cli/commands/migrate.ts --symbol EURUSD --dry-run');
    process.exit(0);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
