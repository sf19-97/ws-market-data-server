#!/usr/bin/env tsx
import dotenv from 'dotenv';
import { getPool, closePool } from '../utils/database.js';
import { getR2Client, Tick } from '../services/r2Client.js';
import { createLogger } from '../utils/logger.js';

// Load environment variables
dotenv.config();

const logger = createLogger();

/**
 * Backfill R2 with historical ticks from market_ticks table
 *
 * Exports ticks from Postgres and uploads to R2 in daily batches
 * following the structure: ticks/{SYMBOL}/{YYYY}/{MM}/{DD}/part-{timestamp}.json
 */
class R2Backfiller {
  private pool = getPool();
  private r2Client = getR2Client();

  constructor() {
    if (!this.r2Client) {
      throw new Error('R2 client not configured. Set R2 credentials in environment.');
    }
  }

  /**
   * Backfill ticks for a symbol and date range
   */
  async backfill(
    symbol: string,
    startDate: Date,
    endDate: Date
  ): Promise<void> {
    console.log(`\n📦 Starting R2 backfill for ${symbol}`);
    console.log(`   From: ${startDate.toISOString().split('T')[0]}`);
    console.log(`   To: ${endDate.toISOString().split('T')[0]}\n`);

    let currentDate = new Date(startDate);
    let processedDays = 0;
    let totalTicks = 0;

    while (currentDate <= endDate) {
      const dayStart = new Date(currentDate);
      dayStart.setHours(0, 0, 0, 0);

      const dayEnd = new Date(currentDate);
      dayEnd.setHours(23, 59, 59, 999);

      // Skip weekends (forex market closed)
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        console.log(`⏭️  Skipping ${dayStart.toISOString().split('T')[0]} (weekend)`);
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }

      console.log(`\n📅 Processing ${dayStart.toISOString().split('T')[0]}`);

      // Query ticks for this day
      const ticks = await this.fetchTicksForDay(symbol, dayStart, dayEnd);

      if (ticks.length === 0) {
        console.log(`   ⚠️  No ticks found for this day`);
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }

      console.log(`   ✅ Fetched ${ticks.length.toLocaleString()} ticks from database`);

      // Upload to R2
      try {
        const key = await this.r2Client!.uploadTicks(symbol, dayStart, ticks);
        console.log(`   📤 Uploaded to R2: ${key}`);
        totalTicks += ticks.length;
        processedDays++;
      } catch (error: any) {
        console.error(`   ❌ Upload failed:`, error.message);
        throw error;
      }

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);

      // Small delay to avoid overwhelming R2
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`\n🎉 Backfill complete!`);
    console.log(`   Days processed: ${processedDays}`);
    console.log(`   Total ticks uploaded: ${totalTicks.toLocaleString()}`);
  }

  /**
   * Fetch ticks for a specific day from market_ticks table
   */
  private async fetchTicksForDay(
    symbol: string,
    dayStart: Date,
    dayEnd: Date
  ): Promise<Tick[]> {
    const query = `
      SELECT
        EXTRACT(EPOCH FROM time)::bigint AS timestamp,
        bid,
        ask
      FROM market_ticks
      WHERE symbol = $1
        AND time >= $2
        AND time <= $3
      ORDER BY time ASC
    `;

    const result = await this.pool.query(query, [symbol, dayStart, dayEnd]);

    return result.rows.map(row => ({
      timestamp: row.timestamp,
      bid: parseFloat(row.bid),
      ask: parseFloat(row.ask)
    }));
  }

  /**
   * Get date range for a symbol from market_ticks
   */
  async getDateRange(symbol: string): Promise<{ earliest: Date; latest: Date }> {
    const query = `
      SELECT
        MIN(time) AS earliest,
        MAX(time) AS latest
      FROM market_ticks
      WHERE symbol = $1
    `;

    const result = await this.pool.query(query, [symbol]);
    const row = result.rows[0];

    return {
      earliest: new Date(row.earliest),
      latest: new Date(row.latest)
    };
  }

  async close(): Promise<void> {
    await closePool();
  }
}

// ============================================================================
// CLI Interface
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: npx tsx src/scripts/backfill-r2.ts <SYMBOL> [START_DATE] [END_DATE]');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx src/scripts/backfill-r2.ts EURUSD');
    console.error('  npx tsx src/scripts/backfill-r2.ts EURUSD 2024-03-01 2024-03-31');
    process.exit(1);
  }

  const symbol = args[0].toUpperCase();
  const backfiller = new R2Backfiller();

  try {
    let startDate: Date;
    let endDate: Date;

    if (args.length >= 3) {
      // User provided date range
      startDate = new Date(args[1]);
      endDate = new Date(args[2]);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Invalid date format. Use YYYY-MM-DD');
      }
    } else {
      // Auto-detect date range from database
      console.log(`🔍 Auto-detecting date range for ${symbol}...`);
      const range = await backfiller.getDateRange(symbol);
      startDate = range.earliest;
      endDate = range.latest;
      console.log(`   Found: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}\n`);
    }

    await backfiller.backfill(symbol, startDate, endDate);

  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  } finally {
    await backfiller.close();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { R2Backfiller };
