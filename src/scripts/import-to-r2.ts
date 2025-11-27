#!/usr/bin/env tsx
import { getHistoricalRates } from 'dukascopy-node';
import dotenv from 'dotenv';
import { getR2Client, Tick } from '../services/r2Client.js';

// Load environment variables
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
 * 3. Materialize to PostgreSQL candles on-demand (use materialize-candles.ts)
 */
class DukascopyToR2Importer {
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

    // Convert Dukascopy format to our Tick format
    return data.map(tick => ({
      timestamp: tick.timestamp / 1000, // Dukascopy uses milliseconds, we use seconds
      bid: tick.bidPrice,
      ask: tick.askPrice
    }));
  }

  /**
   * Import tick data for a date range from Dukascopy to R2
   *
   * IMPORTANT: All times are UTC! Forex markets:
   * - Open: Sunday 22:00 UTC (Sydney open)
   * - Close: Friday 22:00 UTC (New York close)
   * - We skip: Saturday 00:00 UTC to Sunday 22:00 UTC
   */
  async import(
    symbol: string,
    startDate: Date,
    endDate: Date,
    chunkHours: number = 24,
    delaySeconds: number = 10
  ): Promise<void> {
    // Validate symbol
    const validatedSymbol = this.validateSymbol(symbol);

    // Normalize dates to start of day IN UTC
    const start = new Date(startDate);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setUTCHours(23, 59, 59, 999);

    // Validate weekend single-day imports (Saturday only - Sunday evening has trading)
    if (start.toISOString().split('T')[0] === end.toISOString().split('T')[0]) {
      const dayOfWeek = start.getUTCDay();
      if (dayOfWeek === 6) { // Saturday only - Sunday has evening trading
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

      // Skip ONLY the closed period: Saturday 00:00 UTC to Sunday 22:00 UTC
      // Forex opens Sunday 22:00 UTC (Sydney), closes Friday 22:00 UTC (New York)
      const isSaturday = dayOfWeek === 6;
      const isSundayBeforeOpen = dayOfWeek === 0 && hour < 22;

      if (isSaturday || isSundayBeforeOpen) {
        const skipLabel = currentDate.toISOString().slice(0, 16);
        console.log(`⏭️  Skipping ${skipLabel} (market closed)`);

        // Advance to Sunday 22:00 UTC (market open)
        if (isSaturday) {
          // Saturday -> Sunday 22:00 = +1 day + set to 22:00
          currentDate.setUTCDate(currentDate.getUTCDate() + 1);
          currentDate.setUTCHours(22, 0, 0, 0);
        } else {
          // Sunday before 22:00 -> Sunday 22:00
          currentDate.setUTCHours(22, 0, 0, 0);
        }
        continue;
      }

      // Use clean day boundaries: current day 00:00:00 to 23:59:59.999
      // This prevents overlap and ensures data is filed under the correct date
      const chunkEnd = new Date(currentDate);
      chunkEnd.setUTCHours(23, 59, 59, 999);

      // Don't exceed the overall end date
      if (chunkEnd > end) {
        chunkEnd.setTime(end.getTime());
      }

      const chunkLabel = `${currentDate.toISOString().slice(0, 16)} to ${chunkEnd.toISOString().slice(0, 16)}`;
      console.log(`\n📦 Chunk ${processedChunks + 1}: ${chunkLabel}`);

      try {
        // Fetch from Dukascopy
        console.log(`   🔍 Fetching from Dukascopy...`);
        const ticks = await this.fetchFromDukascopy(validatedSymbol, currentDate, chunkEnd);

        if (ticks.length === 0) {
          console.log(`   ⚠️  No data found for this chunk`);
          // Break if we're at the end boundary to avoid infinite loop
          if (chunkEnd.getTime() >= end.getTime()) {
            console.log(`   ℹ️  Reached end of date range`);
            break;
          }
          // Advance to next day's midnight
          currentDate.setUTCDate(currentDate.getUTCDate() + 1);
          currentDate.setUTCHours(0, 0, 0, 0);
          continue;
        }

        console.log(`   ✅ Fetched ${ticks.length.toLocaleString()} ticks`);

        // Upload ticks to R2
        const chunkDate = new Date(currentDate);
        const key = await this.r2Client!.uploadTicks(validatedSymbol, chunkDate, ticks);
        console.log(`   📤 Uploaded to R2: ${key}`);

        totalTicks += ticks.length;
        processedChunks++;

      } catch (error: any) {
        const isDNSError = error.message?.includes('ENOTFOUND') ||
                          error.message?.includes('getaddrinfo') ||
                          error.message?.includes('EAI_AGAIN');

        const isNetworkError = isDNSError ||
                              error.message?.includes('ETIMEDOUT') ||
                              error.message?.includes('ECONNREFUSED') ||
                              error.message?.includes('network') ||
                              error.message?.includes('socket hang up');

        if (isNetworkError) {
          console.error(`   ⚠️  Network error (will retry):`, error.message);
          console.log(`   ⏸️  Waiting 30 seconds before retry...`);

          // Wait 30 seconds for DNS/network recovery
          await new Promise(resolve => setTimeout(resolve, 30000));

          // Retry the same chunk
          console.log(`   🔄 Retrying chunk ${processedChunks + 1}...`);
          try {
            const ticks = await this.fetchFromDukascopy(validatedSymbol, currentDate, chunkEnd);

            if (ticks.length === 0) {
              console.log(`   ⚠️  No data found for this chunk after retry`);
              // Break if we're at the end boundary to avoid infinite loop
              if (chunkEnd.getTime() >= end.getTime()) {
                console.log(`   ℹ️  Reached end of date range`);
                break;
              }
              // Advance to next day's midnight
              currentDate.setUTCDate(currentDate.getUTCDate() + 1);
              currentDate.setUTCHours(0, 0, 0, 0);
              continue;
            }

            console.log(`   ✅ Retry successful: ${ticks.length.toLocaleString()} ticks`);

            // Upload ticks to R2
            const chunkDate = new Date(currentDate);
            const key = await this.r2Client!.uploadTicks(validatedSymbol, chunkDate, ticks);
            console.log(`   📤 Uploaded to R2: ${key}`);

            totalTicks += ticks.length;
            processedChunks++;

          } catch (retryError: any) {
            console.error(`   ❌ Retry failed:`, retryError.message);
            console.log(`   ⏭️  Skipping chunk after retry failure`);
            // Break if we're at the end boundary to avoid infinite loop
            if (chunkEnd.getTime() >= end.getTime()) {
              console.log(`   ℹ️  Reached end of date range`);
              break;
            }
            // Advance to next day's midnight
            currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            currentDate.setUTCHours(0, 0, 0, 0);
            continue;
          }
        } else if (error.message?.includes('BufferFetcher') || error.stack?.includes('BufferFetcher')) {
          // Data not available for this date (e.g., future dates, or Dukascopy issues)
          console.log(`   ℹ️  No data available for this date (Dukascopy BufferFetcher error)`);
        } else {
          // R2 upload errors should throw
          console.error(`   ❌ Upload error details:`);
          console.error(`   Error message:`, error.message);
          console.error(`   Error name:`, error.name);
          console.error(`   Error code:`, error.code);
          console.error(`   Error stack:`, error.stack);
          console.error(`   Full error object:`, JSON.stringify(error, null, 2));
          throw error;
        }
      }

      // Advance to next day's midnight (00:00:00.000 UTC)
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      currentDate.setUTCHours(0, 0, 0, 0);

      // Delay between chunks (skip on last iteration)
      if (currentDate <= end && delaySeconds > 0) {
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
      }
    }

    console.log(`\n🎉 Import complete!`);
    console.log(`   Chunks processed: ${processedChunks}`);
    console.log(`   Total ticks uploaded: ${totalTicks.toLocaleString()}`);
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error('Usage: npx tsx src/scripts/import-to-r2.ts <SYMBOL> <START_DATE> <END_DATE> [CHUNK_HOURS] [DELAY_SECONDS]');
    console.error('');
    console.error('Arguments:');
    console.error('  SYMBOL         - Forex pair (e.g., EURUSD, GBPUSD)');
    console.error('  START_DATE     - Start date in YYYY-MM-DD format');
    console.error('  END_DATE       - End date in YYYY-MM-DD format');
    console.error('  CHUNK_HOURS    - Optional: Hours per chunk (default: 24)');
    console.error('  DELAY_SECONDS  - Optional: Delay between chunks in seconds (default: 10)');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx src/scripts/import-to-r2.ts EURUSD 2024-02-01 2024-02-29');
    console.error('  npx tsx src/scripts/import-to-r2.ts EURUSD 2024-01-01 2024-12-31 24 5');
    process.exit(1);
  }

  const symbol = args[0].toUpperCase();
  // Parse dates as UTC to ensure consistent behavior regardless of local timezone
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
    console.error('Full error object:', JSON.stringify(error, null, 2));
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { DukascopyToR2Importer };
