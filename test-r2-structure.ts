import 'dotenv/config';
import { R2Client } from './src/services/r2Client.js';
import { getPool } from './src/utils/database.js';

async function test() {
  const r2Client = new R2Client();
  const pool = getPool();

  console.log('🔍 Understanding R2 storage structure...\n');

  const testDate = new Date('2024-03-15');
  const symbol = 'EURUSD';

  // Check for TICK files (not candle files)
  console.log(`1. Checking for TICK files in R2:`);
  const tickFiles = await r2Client.listTickFiles(symbol, testDate);
  console.log(`   Found ${tickFiles.length} tick files`);
  if (tickFiles.length > 0) {
    console.log(`   📁 Sample: ${tickFiles[0]}`);

    // Download one to see the structure
    const ticks = await r2Client.downloadTickFile(tickFiles[0]);
    console.log(`   📊 First file has ${ticks.length} ticks`);
    if (ticks.length > 0) {
      console.log(`   Sample tick:`, ticks[0]);
    }
  }

  // Now find a date that has R2 data but NO PostgreSQL data
  console.log(`\n2. Finding dates with R2 ticks but no PostgreSQL candles...`);

  // Check February 2024 (early in the year, might not be materialized)
  for (let day = 1; day <= 10; day++) {
    const checkDate = new Date(2024, 1, day); // February (month is 0-indexed)
    const dateStr = checkDate.toISOString().split('T')[0];

    // Skip weekends
    if (checkDate.getDay() === 0 || checkDate.getDay() === 6) continue;

    const r2Files = await r2Client.listTickFiles(symbol, checkDate);
    const pgResult = await pool.query(
      `SELECT COUNT(*) as count FROM candles_5m
       WHERE symbol = $1 AND DATE(time) = $2`,
      [symbol, dateStr]
    );

    const r2Count = r2Files.length;
    const pgCount = parseInt(pgResult.rows[0].count);

    console.log(`   ${dateStr}: R2=${r2Count} files, PostgreSQL=${pgCount} candles`);

    if (r2Count > 0 && pgCount === 0) {
      console.log(`   ✅ Found perfect test case: ${dateStr} has R2 data but no PostgreSQL candles!`);
      break;
    }
  }

  process.exit(0);
}

test().catch(console.error);