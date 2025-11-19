#!/usr/bin/env tsx
import { getHistoricalRates } from 'dukascopy-node';
import dotenv from 'dotenv';
import { getR2Client, Tick } from '../services/r2Client.js';

// Load environment variables
dotenv.config();

/**
 * Import ticks directly from Dukascopy to R2 (skip Postgres entirely)
 *
 * This is the PURE data lake approach:
 * 1. Fetch from Dukascopy
 * 2. Store in R2 (cheap storage)
 * 3. Materialize to candles on-demand
 */
class DukascopyToR2Importer {
  private r2Client = getR2Client();

  constructor() {
    if (!this.r2Client) {
      throw new Error('R2 client not configured. Set R2 credentials in environment.');
    }
  }

  /**
   * Import ticks for a date range from Dukascopy directly to R2
   */
  async import(
    symbol: string,
    startDate: Date,
    endDate: Date,
    chunkHours: number = 24
  ): Promise<void> {
    console.log(`\n📦 Importing ${symbol} from Dukascopy → R2`);
    console.log(`   From: ${startDate.toISOString().split('T')[0]}`);
    console.log(`   To: ${endDate.toISOString().split('T')[0]}`);
    console.log(`   Chunk size: ${chunkHours} hour(s)\n`);

    let currentDate = new Date(startDate);
    let processedChunks = 0;
    let totalTicks = 0;

    while (currentDate < endDate) {
      const chunkEnd = new Date(currentDate);
      chunkEnd.setHours(chunkEnd.getHours() + chunkHours);

      if (chunkEnd > endDate) {
        chunkEnd.setTime(endDate.getTime());
      }

      // Skip weekends
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        console.log(`⏭️  Skipping ${currentDate.toISOString().split('T')[0]} (weekend)`);
        currentDate = new Date(chunkEnd);
        continue;
      }

      const chunkLabel = `${currentDate.toISOString().slice(0, 16)} to ${chunkEnd.toISOString().slice(0, 16)}`;
      console.log(`\n📦 Chunk ${processedChunks + 1}: ${chunkLabel}`);

      try {
        // Fetch from Dukascopy
        console.log(`   🔍 Fetching from Dukascopy...`);
        const data = await getHistoricalRates({
          instrument: symbol.toLowerCase() as any,
          dates: {
            from: new Date(currentDate),
            to: new Date(chunkEnd)
          },
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
          console.log(`   ⚠️  No data found for this chunk`);
          currentDate = new Date(chunkEnd);
          continue;
        }

        console.log(`   ✅ Fetched ${data.length.toLocaleString()} ticks`);

        // Convert Dukascopy format to our Tick format
        const ticks: Tick[] = data.map(tick => ({
          timestamp: tick.timestamp / 1000, // Dukascopy uses milliseconds, we use seconds
          bid: tick.bidPrice,
          ask: tick.askPrice
        }));

        // Upload to R2 (use the chunk start date for partitioning)
        const chunkDate = new Date(currentDate);
        const key = await this.r2Client!.uploadTicks(symbol, chunkDate, ticks);
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
            const data = await getHistoricalRates({
              instrument: symbol.toLowerCase() as any,
              dates: {
                from: new Date(currentDate),
                to: new Date(chunkEnd)
              },
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
              console.log(`   ⚠️  No data found for this chunk after retry`);
              currentDate = new Date(chunkEnd);
              continue;
            }

            console.log(`   ✅ Retry successful: ${data.length.toLocaleString()} ticks`);

            const ticks: Tick[] = data.map(tick => ({
              timestamp: tick.timestamp / 1000,
              bid: tick.bidPrice,
              ask: tick.askPrice
            }));

            const chunkDate = new Date(currentDate);
            const key = await this.r2Client!.uploadTicks(symbol, chunkDate, ticks);
            console.log(`   📤 Uploaded to R2: ${key}`);

            totalTicks += ticks.length;
            processedChunks++;

          } catch (retryError: any) {
            console.error(`   ❌ Retry failed:`, retryError.message);
            console.log(`   ⏭️  Skipping chunk after retry failure`);
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

      // Move to next chunk
      currentDate = new Date(chunkEnd);

      // Delay between chunks (10 seconds for DNS recovery)
      await new Promise(resolve => setTimeout(resolve, 10000));
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
    console.error('Usage: npx tsx src/scripts/import-to-r2.ts <SYMBOL> <START_DATE> <END_DATE> [CHUNK_HOURS]');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx src/scripts/import-to-r2.ts EURUSD 2024-02-01 2024-02-29');
    console.error('  npx tsx src/scripts/import-to-r2.ts EURUSD 2024-01-01 2024-12-31 24');
    process.exit(1);
  }

  const symbol = args[0].toUpperCase();
  const startDate = new Date(args[1]);
  const endDate = new Date(args[2]);
  const chunkHours = args[3] ? parseInt(args[3]) : 24;

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    console.error('❌ Invalid date format. Use YYYY-MM-DD');
    process.exit(1);
  }

  const importer = new DukascopyToR2Importer();

  try {
    await importer.import(symbol, startDate, endDate, chunkHours);
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
