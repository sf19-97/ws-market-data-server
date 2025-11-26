import { getR2Client } from './src/services/r2Client.js';
import { getPool } from './src/utils/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkNovData() {
  console.log('Checking Nov 2024 data...\n');

  // Check R2
  const r2 = getR2Client();
  if (r2) {
    console.log('R2 Data:');
    for (let day = 1; day <= 8; day++) {
      const date = new Date(2024, 10, day); // Nov is month 10 (0-indexed)
      const hasCandles = await r2.hasCandlesForDateRange('EURUSD', date, date);
      console.log(`  Nov ${day}, 2024: ${hasCandles ? 'EXISTS' : 'NOT FOUND'}`);
    }
  }

  // Check PostgreSQL
  const pool = getPool();
  try {
    console.log('\nPostgreSQL candles_5m:');
    const result = await pool.query(`
      SELECT DATE(time) as day, COUNT(*) as candles
      FROM candles_5m
      WHERE symbol='EURUSD'
        AND time >= '2024-11-01'
        AND time < '2024-11-09'
      GROUP BY day
      ORDER BY day
    `);

    if (result.rows.length === 0) {
      console.log('  No data found for Nov 2024');
    } else {
      for (const row of result.rows) {
        console.log(`  ${row.day.toISOString().split('T')[0]}: ${row.candles} candles`);
      }
    }
  } catch (error: any) {
    console.error('  Error querying PostgreSQL:', error.message);
  }

  await pool.end();
}

checkNovData().catch(console.error);