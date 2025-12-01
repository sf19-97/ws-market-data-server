#!/usr/bin/env tsx
/**
 * Backfill command - Backfills missing Fridays for a symbol
 *
 * Fridays are often missing due to DST-related BufferFetcher errors.
 * This script finds all Fridays in a date range, checks which have data in R2,
 * and imports the missing ones using adaptive chunking.
 *
 * Usage:
 *   npx tsx src/cli/commands/backfill.ts <SYMBOL> <START_DATE> <END_DATE> [--dry-run]
 *
 * Examples:
 *   npx tsx src/cli/commands/backfill.ts EURUSD 2024-01-01 2024-12-31
 *   npx tsx src/cli/commands/backfill.ts EURUSD 2024-01-01 2024-12-31 --dry-run
 */
import dotenv from 'dotenv';
import { getR2Client } from '../../services/r2Client.js';
import { DukascopyToR2Importer } from './import.js';

dotenv.config();

interface FridayStatus {
  date: string;
  hasData: boolean;
  fileCount?: number;
}

/**
 * Get all Fridays in a date range
 */
function getFridaysInRange(start: Date, end: Date): Date[] {
  const fridays: Date[] = [];
  const current = new Date(start);

  while (current.getUTCDay() !== 5) {
    current.setUTCDate(current.getUTCDate() + 1);
  }

  while (current <= end) {
    fridays.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 7);
  }

  return fridays;
}

/**
 * Check which Fridays have data in R2
 */
async function checkFridayStatus(
  r2Client: NonNullable<ReturnType<typeof getR2Client>>,
  symbol: string,
  fridays: Date[]
): Promise<FridayStatus[]> {
  const statuses: FridayStatus[] = [];

  for (const friday of fridays) {
    const files = await r2Client.listTickFiles(symbol, friday);
    statuses.push({
      date: friday.toISOString().split('T')[0],
      hasData: files.length > 0,
      fileCount: files.length
    });
  }

  return statuses;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error('Usage: npx tsx src/cli/commands/backfill.ts <SYMBOL> <START_DATE> <END_DATE> [--dry-run]');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx src/cli/commands/backfill.ts EURUSD 2024-01-01 2024-12-31');
    console.error('  npx tsx src/cli/commands/backfill.ts EURUSD 2024-01-01 2024-12-31 --dry-run');
    process.exit(1);
  }

  const symbol = args[0].toUpperCase();
  const startDate = new Date(args[1] + 'T00:00:00Z');
  const endDate = new Date(args[2] + 'T23:59:59Z');
  const dryRun = args.includes('--dry-run');

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    console.error('Invalid date format. Use YYYY-MM-DD');
    process.exit(1);
  }

  const r2Client = getR2Client();
  if (!r2Client) {
    console.error('R2 not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME');
    process.exit(1);
  }

  console.log(`\n📅 Backfilling missing Fridays for ${symbol}`);
  console.log(`   From: ${startDate.toISOString().split('T')[0]}`);
  console.log(`   To: ${endDate.toISOString().split('T')[0]}`);
  console.log(`   Dry run: ${dryRun}\n`);

  const fridays = getFridaysInRange(startDate, endDate);
  console.log(`Found ${fridays.length} Fridays in range\n`);

  console.log('Checking R2 for existing data...');
  const statuses = await checkFridayStatus(r2Client, symbol, fridays);

  const missing = statuses.filter(s => !s.hasData);
  const existing = statuses.filter(s => s.hasData);

  console.log(`\n📊 Status:`);
  console.log(`   ✅ ${existing.length} Fridays have data`);
  console.log(`   ❌ ${missing.length} Fridays missing\n`);

  if (missing.length === 0) {
    console.log('🎉 All Fridays have data!');
    return;
  }

  console.log('Missing Fridays:');
  for (const m of missing) {
    console.log(`   - ${m.date}`);
  }
  console.log('');

  if (dryRun) {
    console.log('🔍 DRY RUN - No data will be imported');
    console.log('   Remove --dry-run to import missing Fridays');
    return;
  }

  const importer = new DukascopyToR2Importer();
  let successCount = 0;
  let failCount = 0;

  for (const m of missing) {
    const fridayDate = new Date(m.date + 'T00:00:00Z');
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📦 Importing ${m.date} (${successCount + failCount + 1}/${missing.length})`);
    console.log('='.repeat(60));

    try {
      await importer.import(symbol, fridayDate, fridayDate, 24, 0);
      successCount++;
    } catch (error: any) {
      console.error(`❌ Failed to import ${m.date}:`, error.message);
      failCount++;
    }

    if (successCount + failCount < missing.length) {
      console.log('\n⏸️  Waiting 5 seconds before next import...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('🎉 Backfill complete!');
  console.log(`   ✅ Successful: ${successCount}`);
  console.log(`   ❌ Failed: ${failCount}`);
  console.log('='.repeat(60));
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
