#!/usr/bin/env tsx
/**
 * Import command - Imports tick data from Dukascopy to R2 data lake
 *
 * Usage:
 *   npx tsx src/cli/commands/import.ts <SYMBOL> <START_DATE> <END_DATE> [CHUNK_HOURS] [DELAY_SECONDS]
 *
 * Examples:
 *   npx tsx src/cli/commands/import.ts EURUSD 2024-02-01 2024-02-29
 *   npx tsx src/cli/commands/import.ts EURUSD 2024-01-01 2024-12-31 24 5
 */
import { getHistoricalRates } from 'dukascopy-node';
import dotenv from 'dotenv';
import { getR2Client, Tick } from '../../services/r2Client.js';

dotenv.config();

// Supported Dukascopy instruments (forex pairs)
const VALID_SYMBOLS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD',
  'EURGBP', 'EURJPY', 'EURCHF', 'GBPJPY', 'AUDJPY', 'EURAUD', 'GBPAUD'
] as const;

type ValidSymbol = typeof VALID_SYMBOLS[number];

/**
 * Import raw tick data from Dukascopy to R2 data lake
 *
 * This is the OPTIMIZED data lake approach:
 * 1. Fetch ticks from Dukascopy
 * 2. Store raw ticks in R2 (cheap storage: $0.015/GB vs $0.15/GB PostgreSQL)
 * 3. Materialize to PostgreSQL candles on-demand (use materialize command)
 */
export class DukascopyToR2Importer {
  private r2Client = getR2Client();

  constructor() {
    if (!this.r2Client) {
      throw new Error('R2 client not configured. Set R2 credentials in environment.');
    }
  }

  /**
   * Validate symbol is supported by Dukascopy
   */
  private validateSymbol(symbol: string): ValidSymbol {
    const upper = symbol.toUpperCase();
    if (!VALID_SYMBOLS.includes(upper as ValidSymbol)) {
      throw new Error(`Invalid symbol: ${symbol}. Supported: ${VALID_SYMBOLS.join(', ')}`);
    }
    return upper as ValidSymbol;
  }

  /**
   * Fetch historical rates from Dukascopy with retry logic
   */
  private async fetchFromDukascopy(
    symbol: string,
    from: Date,
    to: Date
  ): Promise<Tick[]> {
    const data = await getHistoricalRates({
      instrument: symbol.toLowerCase() as any,
      dates: { from, to },
      timeframe: 'tick',
      format: 'json',
      batchSize: 100,
      pauseBetweenBatchesMs: 100,
      useCache: true,
      retryOnEmpty: true,
      retryCount: 10,
      pauseBetweenRetriesMs: 10000,
      failAfterRetryCount: true
    });

    if (!data || data.length === 0) {
      return [];
    }

    // Sanitize ticks from Dukascopy - reject NaNs and invalid prices
    const mapped = data.map(tick => ({
      timestamp: typeof tick.timestamp === 'number' ? tick.timestamp / 1000 : NaN,
      bid: typeof tick.bidPrice === 'number' ? tick.bidPrice : NaN,
      ask: typeof tick.askPrice === 'number' ? tick.askPrice : NaN
    }));

    const valid = mapped.filter(t =>
      Number.isFinite(t.timestamp) &&
      Number.isFinite(t.bid) &&
      Number.isFinite(t.ask) &&
      t.bid > 0 &&
      t.ask > 0
    );

    const dropped = mapped.length - valid.length;
    if (dropped > 0) {
      console.warn(`   ⚠️  Dropped ${dropped} malformed ticks from Dukascopy`);
    }

    return valid;
  }

  /**
   * Fetch and upload a time range with adaptive chunk sizing
   * If a large chunk fails with BufferFetcher, automatically retry with smaller chunks
   */
  private async fetchAndUploadWithAdaptiveChunks(
    symbol: string,
    from: Date,
    to: Date,
    currentChunkHours: number
  ): Promise<{ ticks: number; chunks: number }> {
    try {
      const ticks = await this.fetchFromDukascopy(symbol, from, to);

      if (ticks.length === 0) {
        return { ticks: 0, chunks: 0 };
      }

      const key = await this.r2Client!.uploadTicks(symbol, from, ticks);
      console.log(`   ✅ Fetched ${ticks.length.toLocaleString()} ticks → ${key.split('/').pop()}`);

      return { ticks: ticks.length, chunks: 1 };

    } catch (error: any) {
      const isBufferFetcher = error.message?.includes('BufferFetcher') || error.stack?.includes('BufferFetcher');

      if (!isBufferFetcher) {
        throw error;
      }

      if (currentChunkHours <= 1) {
        const timeStr = from.toISOString().slice(11, 16);
        console.log(`   ⏭️  Skipping ${from.toISOString().split('T')[0]} ${timeStr} (no data)`);
        return { ticks: 0, chunks: 0 };
      }

      const smallerChunk = currentChunkHours >= 12 ? 6 : 1;
      console.log(`   🔄 Retrying ${from.toISOString().slice(0, 16)} to ${to.toISOString().slice(0, 16)} with ${smallerChunk}h chunks...`);

      let totalTicks = 0;
      let totalChunks = 0;
      let current = new Date(from);

      while (current < to) {
        const subChunkEnd = new Date(current);
        subChunkEnd.setTime(current.getTime() + smallerChunk * 60 * 60 * 1000 - 1);

        if (subChunkEnd > to) {
          subChunkEnd.setTime(to.getTime());
        }

        const result = await this.fetchAndUploadWithAdaptiveChunks(symbol, current, subChunkEnd, smallerChunk);
        totalTicks += result.ticks;
        totalChunks += result.chunks;

        current.setTime(subChunkEnd.getTime() + 1);
      }

      return { ticks: totalTicks, chunks: totalChunks };
    }
  }

  /**
   * Import tick data for a date range from Dukascopy to R2
   */
  async import(
    symbol: string,
    startDate: Date,
    endDate: Date,
    chunkHours: number = 24,
    delaySeconds: number = 10
  ): Promise<void> {
    const validatedSymbol = this.validateSymbol(symbol);

    const start = new Date(startDate);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setUTCHours(23, 59, 59, 999);

    if (start.toISOString().split('T')[0] === end.toISOString().split('T')[0]) {
      const dayOfWeek = start.getUTCDay();
      if (dayOfWeek === 6) {
        console.log(`⚠️  Cannot import Saturday: ${start.toISOString().split('T')[0]}`);
        console.log(`   Forex markets are closed on Saturdays.`);
        return;
      }
    }

    console.log(`\n📦 Importing ${validatedSymbol} from Dukascopy → R2`);
    console.log(`   From: ${start.toISOString()}`);
    console.log(`   To: ${end.toISOString()}`);
    console.log(`   Chunk size: ${chunkHours} hour(s)`);
    console.log(`   NOTE: All times are UTC\n`);

    let currentDate = new Date(start);
    let processedChunks = 0;
    let totalTicks = 0;

    while (currentDate <= end) {
      const dayOfWeek = currentDate.getUTCDay();
      const hour = currentDate.getUTCHours();

      const isSaturday = dayOfWeek === 6;
      const isSundayBeforeOpen = dayOfWeek === 0 && hour < 22;

      if (isSaturday || isSundayBeforeOpen) {
        const skipLabel = currentDate.toISOString().slice(0, 16);
        console.log(`⏭️  Skipping ${skipLabel} (market closed)`);

        if (isSaturday) {
          currentDate.setUTCDate(currentDate.getUTCDate() + 1);
          currentDate.setUTCHours(22, 0, 0, 0);
        } else {
          currentDate.setUTCHours(22, 0, 0, 0);
        }
        continue;
      }

      const chunkEnd = new Date(currentDate);
      chunkEnd.setTime(currentDate.getTime() + chunkHours * 60 * 60 * 1000 - 1);

      const chunkDayOfWeek = currentDate.getUTCDay();
      if (chunkDayOfWeek === 5 && chunkEnd.getUTCHours() >= 22) {
        chunkEnd.setUTCHours(22, 0, 0, 0);
      }

      const endOfDay = new Date(currentDate);
      endOfDay.setUTCHours(23, 59, 59, 999);
      if (chunkEnd > endOfDay) {
        chunkEnd.setTime(endOfDay.getTime());
      }

      if (chunkEnd > end) {
        chunkEnd.setTime(end.getTime());
      }

      const chunkLabel = `${currentDate.toISOString().slice(0, 16)} to ${chunkEnd.toISOString().slice(0, 16)}`;
      console.log(`\n📦 Chunk ${processedChunks + 1}: ${chunkLabel}`);

      try {
        const result = await this.fetchAndUploadWithAdaptiveChunks(
          validatedSymbol,
          currentDate,
          chunkEnd,
          chunkHours
        );

        totalTicks += result.ticks;
        processedChunks += result.chunks;

        if (result.ticks === 0) {
          console.log(`   ⚠️  No data found for this chunk`);
        }

      } catch (error: any) {
        const isNetworkError = error.message?.includes('ENOTFOUND') ||
                              error.message?.includes('getaddrinfo') ||
                              error.message?.includes('EAI_AGAIN') ||
                              error.message?.includes('ETIMEDOUT') ||
                              error.message?.includes('ECONNREFUSED') ||
                              error.message?.includes('network') ||
                              error.message?.includes('socket hang up');

        if (isNetworkError) {
          console.error(`   ⚠️  Network error (will retry):`, error.message);
          console.log(`   ⏸️  Waiting 30 seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, 30000));

          try {
            const result = await this.fetchAndUploadWithAdaptiveChunks(
              validatedSymbol,
              currentDate,
              chunkEnd,
              chunkHours
            );
            totalTicks += result.ticks;
            processedChunks += result.chunks;
          } catch (retryError: any) {
            console.error(`   ❌ Retry failed:`, retryError.message);
            console.log(`   ⏭️  Skipping chunk after retry failure`);
          }
        } else {
          console.error(`   ❌ Error:`, error.message);
          throw error;
        }
      }

      const wasEndOfDay = chunkEnd.getUTCHours() === 23 && chunkEnd.getUTCMinutes() === 59;
      const wasFridayClose = chunkDayOfWeek === 5 && chunkEnd.getUTCHours() === 22;

      if (wasEndOfDay || wasFridayClose) {
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
        currentDate.setUTCHours(0, 0, 0, 0);
      } else {
        currentDate.setTime(chunkEnd.getTime() + 1);
      }

      if (currentDate <= end && delaySeconds > 0) {
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
      }
    }

    console.log(`\n🎉 Import complete!`);
    console.log(`   Chunks processed: ${processedChunks}`);
    console.log(`   Total ticks uploaded: ${totalTicks.toLocaleString()}`);
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error('Usage: npx tsx src/cli/commands/import.ts <SYMBOL> <START_DATE> <END_DATE> [CHUNK_HOURS] [DELAY_SECONDS]');
    console.error('');
    console.error('Arguments:');
    console.error('  SYMBOL         - Forex pair (e.g., EURUSD, GBPUSD)');
    console.error('  START_DATE     - Start date in YYYY-MM-DD format');
    console.error('  END_DATE       - End date in YYYY-MM-DD format');
    console.error('  CHUNK_HOURS    - Optional: Hours per chunk (default: 24)');
    console.error('  DELAY_SECONDS  - Optional: Delay between chunks in seconds (default: 10)');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx src/cli/commands/import.ts EURUSD 2024-02-01 2024-02-29');
    console.error('  npx tsx src/cli/commands/import.ts EURUSD 2024-01-01 2024-12-31 24 5');
    process.exit(1);
  }

  const symbol = args[0].toUpperCase();
  const startDate = new Date(args[1] + 'T00:00:00Z');
  const endDate = new Date(args[2] + 'T23:59:59Z');
  const chunkHours = args[3] ? parseInt(args[3]) : 24;
  const delaySeconds = args[4] ? parseInt(args[4]) : 10;

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    console.error('❌ Invalid date format. Use YYYY-MM-DD');
    process.exit(1);
  }

  if (isNaN(chunkHours) || chunkHours <= 0) {
    console.error('❌ Invalid chunk hours. Must be a positive number.');
    process.exit(1);
  }

  if (isNaN(delaySeconds) || delaySeconds < 0) {
    console.error('❌ Invalid delay seconds. Must be zero or positive.');
    process.exit(1);
  }

  const importer = new DukascopyToR2Importer();

  try {
    await importer.import(symbol, startDate, endDate, chunkHours, delaySeconds);
  } catch (error: any) {
    console.error('\n❌ Fatal error details:');
    console.error('Error message:', error.message);
    console.error('Error name:', error.name);
    console.error('Error code:', error.code);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
