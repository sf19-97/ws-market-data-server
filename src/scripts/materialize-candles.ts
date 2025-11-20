#!/usr/bin/env tsx
import dotenv from 'dotenv';
import { getPool, closePool } from '../utils/database.js';
import { getR2Client } from '../services/r2Client.js';
import { MaterializationService } from '../services/materializationService.js';
import { createLogger } from '../utils/logger.js';

// Load environment variables
dotenv.config();

const logger = createLogger();

/**
 * Materializer CLI - Converts R2 tick data into PostgreSQL 5-minute candles
 *
 * This script is now a thin wrapper around MaterializationService.
 * Use for manual/CLI materialization. For programmatic use, import MaterializationService directly.
 *
 * Usage:
 *   npx tsx src/scripts/materialize-candles.ts EURUSD 2025-11-13
 *   npx tsx src/scripts/materialize-candles.ts EURUSD 2025-11-01:2025-11-13
 *   npx tsx src/scripts/materialize-candles.ts EURUSD 2025-11-13 --dry-run
 */

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: npx tsx src/scripts/materialize-candles.ts <SYMBOL> <DATE|DATE_RANGE> [--dry-run]');
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

  // Initialize services
  const pool = getPool();
  const r2Client = getR2Client();

  if (!r2Client) {
    console.error('❌ R2 not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME');
    process.exit(1);
  }

  const materializationService = new MaterializationService(pool, r2Client);

  try {
    let startDate: Date;
    let endDate: Date;

    // Parse date or date range
    if (dateArg.includes(':')) {
      const [startStr, endStr] = dateArg.split(':');
      startDate = new Date(startStr);
      endDate = new Date(endStr);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error('Invalid date range format. Use YYYY-MM-DD:YYYY-MM-DD');
      }
    } else {
      startDate = new Date(dateArg);
      endDate = new Date(dateArg);

      if (isNaN(startDate.getTime())) {
        throw new Error('Invalid date format. Use YYYY-MM-DD');
      }
    }

    console.log(`\n🔄 Materializing ${symbol} from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    console.log(`Dry run: ${dryRun}\n`);

    if (dryRun) {
      console.log('🔍 DRY RUN MODE - Checking what would be materialized...\n');

      // Check coverage
      const coverage = await materializationService.getCandleCoverage(symbol, startDate, endDate);

      console.log(`📊 Coverage Analysis:`);
      console.log(`   Total days: ${coverage.totalDays}`);
      console.log(`   Already covered: ${coverage.coveredDays}`);
      console.log(`   Missing: ${coverage.totalDays - coverage.coveredDays}`);

      if (coverage.missingRanges.length > 0) {
        console.log(`\n📅 Missing date ranges:`);
        for (const range of coverage.missingRanges) {
          console.log(`   ${range.start.toISOString().split('T')[0]} to ${range.end.toISOString().split('T')[0]}`);
        }
      } else {
        console.log(`\n✅ All dates already materialized!`);
      }

      // Check R2 coverage
      console.log(`\n🔍 Checking R2 data availability...`);
      const hasR2Data = await materializationService.checkR2Coverage(symbol, startDate, endDate);

      if (hasR2Data) {
        console.log(`✅ R2 tick data is available`);
      } else {
        console.log(`⚠️  No R2 tick data found for this date range`);
      }

      console.log(`\n🔍 DRY RUN COMPLETE - No data was modified`);

    } else {
      // Actual materialization
      const candleCount = await materializationService.materialize5mCandles(symbol, startDate, endDate);

      console.log(`\n🎉 Materialization complete!`);
      console.log(`   Total 5m candles materialized: ${candleCount}`);

      // Refresh materialized views
      console.log(`\n🔄 Refreshing materialized views for higher timeframes...`);
      await materializationService.refreshMaterializedViews();
      console.log(`✅ Materialized views refreshed`);
    }

  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    logger.error({ error }, 'Materialization failed');
    process.exit(1);
  } finally {
    await closePool();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };
