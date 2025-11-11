import { getHistoricalRates } from 'dukascopy-node';
import { getPool, closePool } from '../utils/database.js';

interface Tick {
  timestamp: number;
  askPrice: number;
  bidPrice: number;
  askVolume?: number;
  bidVolume?: number;
}

interface ImportConfig {
  symbol: string;
  fromDate: Date;
  toDate: Date;
  batchSize?: number;
}

/**
 * Import historical tick data from Dukascopy into the database
 * Uses PostgreSQL COPY for extremely fast bulk inserts
 */
export class HistoricalDataImporter {
  private pool = null as any; // Lazy-loaded to avoid holding connections during fetches

  constructor() {
    // Pool will be created on-demand
  }

  private getPoolInstance() {
    if (!this.pool) {
      this.pool = getPool();
    }
    return this.pool;
  }

  /**
   * Import ticks for a specific symbol and date range
   */
  async importTicks(config: ImportConfig): Promise<void> {
    const { symbol, fromDate, toDate } = config;

    console.log(`📥 Starting import for ${symbol} from ${fromDate.toISOString()} to ${toDate.toISOString()}`);

    try {
      // Fetch data from Dukascopy with performance optimizations
      console.log(`🔍 Fetching data from Dukascopy...`);
      console.log(`   Range: ${fromDate.toISOString()} to ${toDate.toISOString()}`);
      console.log(`   Instrument: ${symbol.toLowerCase()}`);

      const data = await getHistoricalRates({
        instrument: symbol.toLowerCase() as any, // dukascopy-node has specific instrument types
        dates: {
          from: fromDate,
          to: toDate
        },
        timeframe: 'tick',
        format: 'json',
        // Performance optimizations
        batchSize: 3, // Very conservative batching to avoid rate limits
        pauseBetweenBatchesMs: 5000, // 5 second pause between batches
        useCache: true, // Enable file-system cache
        retryOnEmpty: true, // Retry empty responses
        retryCount: 10, // Retry up to 10 times
        pauseBetweenRetriesMs: 10000, // 10 seconds between retries
        failAfterRetryCount: false // Don't throw error, return empty array instead
      });

      if (!data || data.length === 0) {
        console.log(`⚠️  No data found for ${symbol} in this range`);
        return;
      }

      console.log(`✅ Fetched ${data.length} ticks`);

      // Import in batches using COPY
      try {
        await this.bulkInsertTicks(symbol, data as any as Tick[]);
        console.log(`🎉 Successfully processed ${data.length} ticks for ${symbol}`);
      } catch (dbError: any) {
        console.error(`❌ Database error for ${symbol}:`, dbError.message);
        throw dbError; // Re-throw database errors as they're likely not transient
      }

    } catch (error: any) {
      // Distinguish between fetch errors and database errors
      const isFetchError = error.message?.includes('BufferFetcher') ||
                          error.message?.includes('getHistoricalRates') ||
                          error.message?.includes('Unknown error');

      if (isFetchError) {
        console.error(`❌ Dukascopy fetch error for ${symbol}:`, error.message);
        console.error(`   This is likely due to rate limiting, network timeout, or data unavailability`);
        console.log(`⏭️  Skipping this chunk - will continue with next chunk`);
        return; // Skip this chunk
      } else {
        // Database or other critical error - log details and re-throw
        console.error(`❌ Critical error importing ${symbol}:`, error);
        console.error(`   Error type: ${error.constructor.name}`);
        console.error(`   Error message: ${error.message}`);
        throw error; // Re-throw to stop import
      }
    }
  }

  /**
   * Bulk insert ticks using PostgreSQL COPY (extremely fast)
   */
  private async bulkInsertTicks(symbol: string, ticks: Tick[]): Promise<void> {
    console.log(`💾 Bulk inserting ${ticks.length} ticks...`);

    // Get fresh connection right before insert (avoids timeouts during fetch)
    const client = await this.getPoolInstance().connect();

    try {
      // Use batch INSERT with ON CONFLICT DO NOTHING
      // This is slightly slower than COPY but handles duplicates gracefully
      const batchSize = 1000;
      let insertedCount = 0;
      let duplicateCount = 0;

      for (let i = 0; i < ticks.length; i += batchSize) {
        const batch = ticks.slice(i, i + batchSize);

        // Build VALUES clause for batch insert
        const values: any[] = [];
        const placeholders: string[] = [];

        batch.forEach((tick, idx) => {
          const baseIdx = idx * 6;
          placeholders.push(
            `($${baseIdx + 1}, $${baseIdx + 2}, $${baseIdx + 3}, $${baseIdx + 4}, $${baseIdx + 5}, $${baseIdx + 6})`
          );
          values.push(
            new Date(tick.timestamp),
            symbol,
            tick.bidPrice,
            tick.askPrice,
            Math.round(tick.bidVolume || 0),
            Math.round(tick.askVolume || 0)
          );
        });

        const query = `
          INSERT INTO market_ticks (time, symbol, bid, ask, bid_size, ask_size)
          VALUES ${placeholders.join(', ')}
          ON CONFLICT (symbol, time) DO NOTHING
        `;

        const result = await client.query(query, values);
        const inserted = result.rowCount || 0;
        insertedCount += inserted;
        duplicateCount += batch.length - inserted;
      }

      if (duplicateCount > 0) {
        console.log(`✅ Inserted ${insertedCount} new ticks, skipped ${duplicateCount} duplicates`);
      } else {
        console.log(`✅ Inserted ${insertedCount} new ticks`);
      }

    } catch (error) {
      console.error('Insert error:', error);
      throw error;
    } finally {
      client.release();
    }
  }


  /**
   * Import multiple date ranges for a symbol (chunked by hours)
   */
  async importDateRange(
    symbol: string,
    startDate: Date,
    endDate: Date,
    chunkHours: number = 1
  ): Promise<void> {
    console.log(`\n📅 Importing ${symbol} from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    console.log(`Chunk size: ${chunkHours} hour(s)\n`);

    let currentDate = new Date(startDate);
    let importedChunks = 0;

    while (currentDate < endDate) {
      const chunkEnd = new Date(currentDate);
      chunkEnd.setHours(chunkEnd.getHours() + chunkHours);

      // Don't go past endDate
      if (chunkEnd > endDate) {
        chunkEnd.setTime(endDate.getTime());
      }

      const chunkLabel = `${currentDate.toISOString().slice(0, 16)} to ${chunkEnd.toISOString().slice(0, 16)}`;

      // Skip weekends (forex market closed)
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) { // 0 = Sunday, 6 = Saturday
        console.log(`\n⏭️  Skipping ${chunkLabel} (weekend - market closed)`);
        currentDate = new Date(chunkEnd);
        continue;
      }

      console.log(`\n📦 Chunk ${importedChunks + 1}: ${chunkLabel}`);

      await this.importTicks({
        symbol,
        fromDate: new Date(currentDate),
        toDate: new Date(chunkEnd)
      });

      importedChunks++;

      // Close pool to avoid idle connection timeouts during slow Dukascopy fetches
      if (this.pool) {
        await closePool();
        this.pool = null;
      }

      // Delay to avoid hammering Dukascopy
      await new Promise(resolve => setTimeout(resolve, 10000));

      currentDate = new Date(chunkEnd);
    }

    console.log(`\n✅ Completed import: ${importedChunks} chunks imported`);
  }

  /**
   * Check if data exists for a symbol in a date range
   */
  async checkDataExists(symbol: string, fromDate: Date, toDate: Date): Promise<boolean> {
    const result = await this.getPoolInstance().query(
      `SELECT COUNT(*) as count
       FROM market_ticks
       WHERE symbol = $1
         AND time >= $2
         AND time <= $3`,
      [symbol, fromDate, toDate]
    );

    const count = parseInt(result.rows[0].count);
    console.log(`📊 Found ${count} existing ticks for ${symbol} in this range`);

    return count > 0;
  }
}

// Export the class for use in other scripts
export default HistoricalDataImporter;
