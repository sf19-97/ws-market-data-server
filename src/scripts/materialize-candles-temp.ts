#!/usr/bin/env tsx
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import { getPool, closePool } from '../utils/database.js';
import { createLogger } from '../utils/logger.js';

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
 * Materializer Script - Converts R2 tick data into candles_5m_temp (workaround for restore mode)
 *
 * TEMPORARY: Uses candles_5m_temp instead of candles_5m due to timescaledb.restoring='on' issue
 */
class CandleMaterializerTemp {
  private s3: S3Client;
  private pool: any;
  private bucketName: string;

  constructor() {
    const endpoint = process.env.R2_ENDPOINT;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucketName = process.env.R2_BUCKET_NAME;

    if (!endpoint || !accessKeyId || !secretAccessKey || !bucketName) {
      throw new Error('R2 credentials not configured');
    }

    this.bucketName = bucketName;

    this.s3 = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey }
    });

    this.pool = getPool();
    logger.info({ endpoint, bucketName }, 'CandleMaterializer initialized (TEMP)');
  }

  async materialize(symbol: string, date: Date): Promise<void> {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    console.log(`\n🔄 Materializing candles for ${symbol} on ${year}-${month}-${day}`);

    // List all tick files for this day
    const prefix = `ticks/${symbol}/${year}/${month}/${day}/`;
    console.log(`\n📂 Listing tick files from R2: ${prefix}`);

    const list = await this.s3.send(new ListObjectsV2Command({
      Bucket: this.bucketName,
      Prefix: prefix
    }));

    if (!list.Contents || list.Contents.length === 0) {
      console.log(`   ⚠️  No tick files found for this date`);
      return;
    }

    console.log(`✅ Found ${list.Contents.length} tick file(s)`);

    // Download and merge all ticks
    console.log(`\n📥 Downloading ${list.Contents.length} tick file(s)...`);
    const allTicks: Tick[] = [];

    for (const item of list.Contents) {
      const obj = await this.s3.send(new GetObjectCommand({
        Bucket: this.bucketName,
        Key: item.Key
      }));

      const body = await obj.Body?.transformToString();
      if (body) {
        const ticks = JSON.parse(body);
        allTicks.push(...ticks);
      }
    }

    allTicks.sort((a, b) => a.timestamp - b.timestamp);
    console.log(`✅ Downloaded and merged ${allTicks.length.toLocaleString()} ticks`);

    // Build 5-minute candles
    console.log(`\n🕯️  Building 5-minute candles from ${allTicks.length.toLocaleString()} ticks...`);
    const candles = this.buildFiveMinuteCandles(symbol, allTicks);
    console.log(`✅ Built ${candles.length} candles`);

    // Insert into candles_5m_temp
    console.log(`\n💾 Inserting ${candles.length} candles into candles_5m_temp...`);
    await this.insertCandles(candles);
    console.log(`✅ Inserted/updated ${candles.length} candles`);
  }

  buildFiveMinuteCandles(symbol: string, ticks: Tick[]): Candle[] {
    const candles: Candle[] = [];
    const bucketSizeSeconds = 5 * 60;

    let currentBucketStart: number | null = null;
    let currentCandle: Partial<Candle> = {};
    let tickCount = 0;

    for (const tick of ticks) {
      const bucketStart = Math.floor(tick.timestamp / bucketSizeSeconds) * bucketSizeSeconds;
      const midPrice = (tick.bid + tick.ask) / 2;

      if (bucketStart !== currentBucketStart) {
        if (currentBucketStart !== null) {
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

        currentBucketStart = bucketStart;
        currentCandle = {
          open: midPrice,
          high: midPrice,
          low: midPrice,
          close: midPrice
        };
        tickCount = 1;
      } else {
        currentCandle.high = Math.max(currentCandle.high!, midPrice);
        currentCandle.low = Math.min(currentCandle.low!, midPrice);
        currentCandle.close = midPrice;
        tickCount++;
      }
    }

    if (currentBucketStart !== null) {
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

  async insertCandles(candles: Candle[]): Promise<void> {
    const values = candles.map(c =>
      `('${c.time.toISOString()}', '${c.symbol}', ${c.open}, ${c.high}, ${c.low}, ${c.close}, ${c.volume}, ${c.trades}, 'r2')`
    ).join(',\n      ');

    const query = `
      INSERT INTO candles_5m_temp (time, symbol, open, high, low, close, volume, trades, source)
      VALUES
      ${values}
      ON CONFLICT (symbol, time) DO UPDATE SET
        open = EXCLUDED.open,
        high = EXCLUDED.high,
        low = EXCLUDED.low,
        close = EXCLUDED.close,
        volume = EXCLUDED.volume,
        trades = EXCLUDED.trades,
        source = EXCLUDED.source;
    `;

    await this.pool.query(query);
  }

  async materializeRange(symbol: string, startDate: Date, endDate: Date): Promise<void> {
    console.log(`\n📅 Materializing ${symbol} from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}\n`);

    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      await this.materialize(symbol, currentDate);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log(`\n🎉 Materialization complete!`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: npx tsx src/scripts/materialize-candles-temp.ts <SYMBOL> <DATE|RANGE>');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx src/scripts/materialize-candles-temp.ts EURUSD 2024-02-01');
    console.error('  npx tsx src/scripts/materialize-candles-temp.ts EURUSD 2024-02-01:2024-02-29');
    process.exit(1);
  }

  const symbol = args[0].toUpperCase();
  const dateArg = args[1];

  const materializer = new CandleMaterializerTemp();

  try {
    if (dateArg.includes(':')) {
      const [start, end] = dateArg.split(':');
      const startDate = new Date(start);
      const endDate = new Date(end);
      await materializer.materializeRange(symbol, startDate, endDate);
    } else {
      const date = new Date(dateArg);
      await materializer.materialize(symbol, date);
    }
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  } finally {
    await closePool();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { CandleMaterializerTemp };
