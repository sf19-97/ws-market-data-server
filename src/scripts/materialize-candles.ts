#!/usr/bin/env tsx
import { S3Client, ListObjectsV2Command, GetObjectCommand, ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import { getPool, closePool } from '../utils/database.js';
import { createLogger } from '../utils/logger.js';

// Load environment variables
dotenv.config();

const logger = createLogger();

interface Tick {
  timestamp: number; // UNIX seconds
  bid: number;
  ask: number;
}

interface Candle {
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
 * Materializer Script - Converts R2 tick data into TimescaleDB 5-minute candles
 *
 * Usage:
 *   npx tsx src/scripts/materialize-candles.ts EURUSD 2025-11-13
 *   npx tsx src/scripts/materialize-candles.ts EURUSD 2025-11-13 --dry-run
 */
class CandleMaterializer {
  private s3: S3Client;
  private pool: any;
  private bucketName: string;

  constructor() {
    const endpoint = process.env.R2_ENDPOINT;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucketName = process.env.R2_BUCKET_NAME;

    if (!endpoint || !accessKeyId || !secretAccessKey || !bucketName) {
      throw new Error('R2 credentials not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME');
    }

    this.bucketName = bucketName;

    // Initialize S3 client for R2
    this.s3 = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });

    // Initialize database pool
    this.pool = getPool();

    logger.info({ endpoint, bucketName }, 'CandleMaterializer initialized');
  }

  /**
   * List all tick files for a given symbol and date from R2
   * Handles pagination (max 1000 objects per request)
   */
  async listTickFiles(symbol: string, date: Date): Promise<string[]> {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    const prefix = `ticks/${symbol}/${year}/${month}/${day}/`;

    console.log(`📂 Listing tick files from R2: ${prefix}`);

    const keys: string[] = [];
    let continuationToken: string | undefined = undefined;

    do {
      const command: ListObjectsV2Command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken
      });

      const response: ListObjectsV2CommandOutput = await this.s3.send(command);

      if (response.Contents) {
        for (const object of response.Contents) {
          if (object.Key) {
            keys.push(object.Key);
          }
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken); // Keep paginating until no more results

    console.log(`✅ Found ${keys.length} tick file(s)`);
    return keys;
  }

  /**
   * Download and parse a single tick file from R2
   */
  async downloadTickFile(key: string): Promise<Tick[]> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key
    });

    const response = await this.s3.send(command);

    if (!response.Body) {
      throw new Error(`No body in response for key: ${key}`);
    }

    // Convert stream to string
    const bodyString = await response.Body.transformToString();
    const ticks: Tick[] = JSON.parse(bodyString);

    return ticks;
  }

  /**
   * Download and merge all tick files for a date
   */
  async downloadAllTicks(symbol: string, date: Date): Promise<Tick[]> {
    const keys = await this.listTickFiles(symbol, date);

    if (keys.length === 0) {
      console.log('⚠️  No tick files found for this date');
      return [];
    }

    console.log(`📥 Downloading ${keys.length} tick file(s)...`);

    const allTicks: Tick[] = [];

    for (const key of keys) {
      const ticks = await this.downloadTickFile(key);
      // Avoid stack overflow from spread operator with large arrays
      for (const tick of ticks) {
        allTicks.push(tick);
      }
    }

    // Sort by timestamp (CRITICAL for candle building)
    allTicks.sort((a, b) => a.timestamp - b.timestamp);

    console.log(`✅ Downloaded and merged ${allTicks.length} ticks`);
    return allTicks;
  }

  /**
   * Build 5-minute candles from tick data
   */
  buildFiveMinuteCandles(symbol: string, ticks: Tick[]): Candle[] {
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
   * Insert candles into TimescaleDB with ON CONFLICT upsert
   */
  async insertCandles(candles: Candle[], dryRun: boolean = false): Promise<void> {
    if (candles.length === 0) {
      console.log('⚠️  No candles to insert');
      return;
    }

    if (dryRun) {
      console.log(`🔍 DRY RUN: Would insert ${candles.length} candles`);
      console.log('First candle:', candles[0]);
      console.log('Last candle:', candles[candles.length - 1]);
      return;
    }

    console.log(`💾 Inserting ${candles.length} candles into TimescaleDB...`);

    const client = await this.pool.connect();

    try {
      // Build batch INSERT with ON CONFLICT
      const values: any[] = [];
      const placeholders: string[] = [];

      candles.forEach((candle, idx) => {
        const baseIdx = idx * 8;
        placeholders.push(
          `($${baseIdx + 1}, $${baseIdx + 2}, $${baseIdx + 3}, $${baseIdx + 4}, $${baseIdx + 5}, $${baseIdx + 6}, $${baseIdx + 7}, $${baseIdx + 8})`
        );
        values.push(
          candle.time,
          candle.symbol,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume,
          candle.trades
        );
      });

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
      const rowCount = result.rowCount || 0;

      console.log(`✅ Inserted/updated ${rowCount} candles`);

    } catch (error) {
      console.error('❌ Insert error:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Materialize candles for a specific symbol and date
   */
  async materialize(symbol: string, date: Date, dryRun: boolean = false): Promise<void> {
    console.log(`\n🔄 Materializing candles for ${symbol} on ${date.toISOString().split('T')[0]}`);
    console.log(`Dry run: ${dryRun}\n`);

    try {
      // Step 1: Download all ticks from R2
      const ticks = await this.downloadAllTicks(symbol, date);

      if (ticks.length === 0) {
        console.log('⚠️  No ticks found - nothing to materialize');
        return;
      }

      // Step 2: Build 5-minute candles
      console.log(`🕯️  Building 5-minute candles from ${ticks.length} ticks...`);
      const candles = this.buildFiveMinuteCandles(symbol, ticks);
      console.log(`✅ Built ${candles.length} candles`);

      // Step 3: Insert into TimescaleDB
      await this.insertCandles(candles, dryRun);

      console.log(`\n🎉 Materialization complete!`);

    } catch (error: any) {
      console.error(`❌ Materialization failed:`, error.message);
      throw error;
    }
  }

  /**
   * Materialize a date range (multiple days)
   */
  async materializeRange(
    symbol: string,
    startDate: Date,
    endDate: Date,
    dryRun: boolean = false
  ): Promise<void> {
    console.log(`\n📅 Materializing ${symbol} from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}\n`);

    let currentDate = new Date(startDate);
    let processedDays = 0;

    while (currentDate <= endDate) {
      await this.materialize(symbol, new Date(currentDate), dryRun);
      processedDays++;

      // Move to next day - create new Date to avoid mutation issues
      currentDate = new Date(currentDate);
      currentDate.setDate(currentDate.getDate() + 1);

      // Small delay to avoid hammering R2
      if (currentDate <= endDate) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`\n✅ Completed materialization: ${processedDays} day(s) processed`);
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    await closePool();
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: npx tsx src/scripts/materialize-candles.ts <SYMBOL> <DATE> [--dry-run]');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx src/scripts/materialize-candles.ts EURUSD 2025-11-13');
    console.error('  npx tsx src/scripts/materialize-candles.ts EURUSD 2025-11-13 --dry-run');
    console.error('  npx tsx src/scripts/materialize-candles.ts EURUSD 2025-11-01:2025-11-13');
    process.exit(1);
  }

  const symbol = args[0].toUpperCase();
  const dateArg = args[1];
  const dryRun = args.includes('--dry-run');

  const materializer = new CandleMaterializer();

  try {
    // Check if date range
    if (dateArg.includes(':')) {
      const [startStr, endStr] = dateArg.split(':');
      const startDate = new Date(startStr);
      const endDate = new Date(endStr);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Invalid date range format. Use YYYY-MM-DD:YYYY-MM-DD');
      }

      await materializer.materializeRange(symbol, startDate, endDate, dryRun);
    } else {
      // Single date
      const date = new Date(dateArg);

      if (isNaN(date.getTime())) {
        throw new Error('Invalid date format. Use YYYY-MM-DD');
      }

      await materializer.materialize(symbol, date, dryRun);
    }

  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  } finally {
    await materializer.close();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { CandleMaterializer };
