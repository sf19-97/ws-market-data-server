#!/usr/bin/env tsx
/**
 * Materialize command - Materializes R2 candle data to PostgreSQL
 *
 * Usage:
 *   npx tsx src/cli/commands/materialize.ts <SYMBOL> <START_DATE> [END_DATE] [--dry-run]
 *
 * Examples:
 *   npx tsx src/cli/commands/materialize.ts EURUSD 2025-11-13
 *   npx tsx src/cli/commands/materialize.ts EURUSD 2025-11-01 2025-11-13
 *   npx tsx src/cli/commands/materialize.ts EURUSD 2025-11-13 --dry-run
 */
import dotenv from 'dotenv';
import { getPool, closePool } from '../../services/database.js';
import { getR2Client } from '../../services/r2Client.js';
import { MaterializationService } from '../../services/materializationService.js';
import { createLogger } from '../../utils/logger.js';

dotenv.config();

const logger = createLogger();

async function main() {
  const args = process.argv.slice(2);
  const nonFlagArgs = args.filter(a => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');

  if (nonFlagArgs.length < 2) {
    console.error('Usage: npx tsx src/cli/commands/materialize.ts <SYMBOL> <START_DATE> [END_DATE] [--dry-run]');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx src/cli/commands/materialize.ts EURUSD 2025-11-13');
    console.error('  npx tsx src/cli/commands/materialize.ts EURUSD 2025-11-01 2025-11-13');
    console.error('  npx tsx src/cli/commands/materialize.ts EURUSD 2025-11-01 2025-11-13 --dry-run');
    process.exit(1);
  }

  const symbol = nonFlagArgs[0].toUpperCase();
  const startDateArg = nonFlagArgs[1];
  const endDateArg = nonFlagArgs[2] || startDateArg;

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

    if (startDateArg.includes(':')) {
      const [startStr, endStr] = startDateArg.split(':');
      startDate = new Date(startStr + 'T00:00:00Z');
      endDate = new Date(endStr + 'T00:00:00Z');
    } else {
      startDate = new Date(startDateArg + 'T00:00:00Z');
      endDate = new Date(endDateArg + 'T00:00:00Z');
    }

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('Invalid date format. Use YYYY-MM-DD');
    }

    console.log(`\n🔄 Materializing ${symbol} from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    console.log(`Dry run: ${dryRun}\n`);

    if (dryRun) {
      console.log('🔍 DRY RUN MODE - Checking what would be materialized...\n');

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

      console.log(`\n🔍 Checking R2 data availability...`);
      const hasR2Data = await materializationService.checkR2Coverage(symbol, startDate, endDate);

      if (hasR2Data) {
        console.log(`✅ R2 candle data is available`);
      } else {
        console.log(`⚠️  No R2 candle data found for this date range`);
      }

      console.log(`\n🔍 DRY RUN COMPLETE - No data was modified`);

    } else {
      const candleCount = await materializationService.materialize5mCandles(symbol, startDate, endDate);

      console.log(`\n🎉 Materialization complete!`);
      console.log(`   Total 5m candles materialized: ${candleCount}`);

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

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main };
