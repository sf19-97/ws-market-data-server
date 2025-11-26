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

    // Normalize dates to start of day
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // Validate weekend single-day imports
    if (start.toDateString() === end.toDateString()) {
      const dayOfWeek = start.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        console.log(`⚠️  Cannot import single weekend day: ${start.toISOString().split('T')[0]}`);
        console.log(`   Forex markets are closed on weekends.`);
        return;
      }
    }

    console.log(`\n📦 Importing ${validatedSymbol} from Dukascopy → R2`);
    console.log(`   From: ${start.toISOString().split('T')[0]}`);
    console.log(`   To: ${end.toISOString().split('T')[0]}`);
    console.log(`   Chunk size: ${chunkHours} hour(s)\n`);

    let currentDate = new Date(start);
    let processedChunks = 0;
    let totalTicks = 0;

    while (currentDate <= end) {
      // Skip weekends - advance to Monday 00:00
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        console.log(`⏭️  Skipping ${currentDate.toISOString().split('T')[0]} (weekend)`);
        // Advance to next Monday at 00:00
        const daysToMonday = dayOfWeek === 0 ? 1 : 2; // Sunday -> Monday (1 day), Saturday -> Monday (2 days)
        currentDate.setDate(currentDate.getDate() + daysToMonday);
        currentDate.setHours(0, 0, 0, 0);
        continue;
      }

      const chunkEnd = new Date(currentDate);
      chunkEnd.setHours(chunkEnd.getHours() + chunkHours);

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
          currentDate = new Date(chunkEnd);  // FIXED: Advance by chunk, not by day
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
              currentDate = new Date(chunkEnd);  // FIXED: Advance by chunk, not by day
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
            currentDate = new Date(chunkEnd);  // Ensure we advance even on retry failure
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

      // Move to next chunk (advance by chunk end, not by day)
      currentDate = new Date(chunkEnd);

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
  const startDate = new Date(args[1]);
  const endDate = new Date(args[2]);
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
