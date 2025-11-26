import 'dotenv/config';
import { R2Client } from './src/services/r2Client.js';
import { getPool } from './src/utils/database.js';

async function test() {
  const r2Client = new R2Client();
  const pool = getPool();

  console.log('🔍 Testing R2 → PostgreSQL flow...\n');

  // Use a date we KNOW has R2 data (March 2024)
  const testDate = new Date('2024-03-15');
  const symbol = 'EURUSD';

  // 1. Check R2
  console.log(`1. R2 Check for ${symbol} on 2024-03-15:`);
  const r2Files = await r2Client.listCandleFiles(symbol, testDate);
  console.log(`   ✅ Found ${r2Files.length} candle files in R2`);
  if (r2Files.length > 0) {
    console.log(`   📁 Sample file: ${r2Files[0]}`);
  }

  // 2. Check PostgreSQL
  console.log(`\n2. PostgreSQL Check:`);
  const pgResult = await pool.query(
    `SELECT COUNT(*) as count FROM candles_5m
     WHERE symbol = $1 AND DATE(time) = $2`,
    [symbol, '2024-03-15']
  );
  const candles = parseInt(pgResult.rows[0].count);
  console.log(`   ${candles > 0 ? '✅' : '❌'} Found ${candles} candles in PostgreSQL`);

  // 3. Now test the API endpoint - does it trigger auto-materialization?
  console.log(`\n3. Testing API endpoint (should trigger auto-materialization):`);
  const from = Math.floor(testDate.getTime() / 1000);
  const to = from + (24 * 60 * 60); // 1 day

  const url = `http://localhost:8080/api/candles?symbol=${symbol}&timeframe=5m&from=${from}&to=${to}`;
  console.log(`   Calling: ${url}`);

  try {
    const start = Date.now();
    const response = await fetch(url);
    const elapsed = Date.now() - start;
    const data = await response.json();

    console.log(`\n   Response time: ${elapsed}ms`);
    console.log(`   Status: ${response.status}`);
    console.log(`   Candles returned: ${Array.isArray(data) ? data.length : 0}`);

    if (elapsed < 500) {
      console.log(`   ⚡ FAST response suggests data was ALREADY in PostgreSQL`);
    } else {
      console.log(`   🐌 SLOW response suggests auto-materialization might have occurred`);
    }
  } catch (err: any) {
    console.log(`   ❌ Error calling API: ${err.message}`);
  }

  // 4. Check PostgreSQL again
  console.log(`\n4. Re-checking PostgreSQL after API call:`);
  const pgResult2 = await pool.query(
    `SELECT COUNT(*) as count FROM candles_5m
     WHERE symbol = $1 AND DATE(time) = $2`,
    [symbol, '2024-03-15']
  );
  const candlesAfter = parseInt(pgResult2.rows[0].count);
  console.log(`   Found ${candlesAfter} candles now`);

  if (candlesAfter > candles) {
    console.log(`   ✅ AUTO-MATERIALIZATION WORKED! Added ${candlesAfter - candles} candles`);
  } else if (candlesAfter === candles && candles > 0) {
    console.log(`   ⚠️ No new candles - data was already there`);
  } else {
    console.log(`   ❌ No auto-materialization occurred`);
  }

  process.exit(0);
}

test().catch(console.error);