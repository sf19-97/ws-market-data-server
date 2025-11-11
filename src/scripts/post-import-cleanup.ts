#!/usr/bin/env tsx
/**
 * Post-import cleanup: Remove duplicates and rebuild UNIQUE index
 */

import { getPool } from '../utils/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function cleanup() {
  const pool = getPool();

  console.log('\n📊 Step 1: Checking for duplicates...');

  const dupeCheck = await pool.query(`
    SELECT symbol, time, COUNT(*) as count
    FROM market_ticks
    GROUP BY symbol, time
    HAVING COUNT(*) > 1
    LIMIT 10;
  `);

  if (dupeCheck.rows.length > 0) {
    console.log(`⚠️  Found duplicates. Sample:`);
    console.log(dupeCheck.rows);

    console.log('\n🧹 Step 2: Removing duplicates (keeping oldest ctid)...');

    const dedupeResult = await pool.query(`
      DELETE FROM market_ticks a USING (
        SELECT MIN(ctid) as ctid, time, symbol
        FROM market_ticks
        GROUP BY time, symbol
        HAVING COUNT(*) > 1
      ) b
      WHERE a.time = b.time
        AND a.symbol = b.symbol
        AND a.ctid <> b.ctid;
    `);

    console.log(`✅ Removed ${dedupeResult.rowCount} duplicate rows`);
  } else {
    console.log('✅ No duplicates found');
  }

  console.log('\n🔨 Step 3: Rebuilding UNIQUE index...');

  await pool.query(`
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS forex_ticks_symbol_time_uq
    ON market_ticks (symbol, time);
  `);

  console.log('✅ UNIQUE index rebuilt');

  console.log('\n📈 Step 4: Final stats...');

  const stats = await pool.query(`
    SELECT
      symbol,
      COUNT(*) as total_ticks,
      DATE(MIN(time)) as first_date,
      DATE(MAX(time)) as last_date
    FROM market_ticks
    WHERE symbol = 'EURUSD'
    GROUP BY symbol;
  `);

  console.log(stats.rows[0]);

  console.log('\n✅ Cleanup complete!');
  process.exit(0);
}

cleanup().catch((error) => {
  console.error('❌ Cleanup failed:', error);
  process.exit(1);
});
