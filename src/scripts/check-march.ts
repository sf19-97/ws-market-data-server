#!/usr/bin/env tsx
import { getPool } from '../utils/database.js';
import dotenv from 'dotenv';

dotenv.config();

const pool = getPool();

// Check daily breakdown for March 2024
const daily = await pool.query(`
  SELECT
    DATE(time) as day,
    COUNT(*) as ticks
  FROM market_ticks
  WHERE symbol='EURUSD'
    AND time >= '2024-03-01'
    AND time < '2024-04-01'
  GROUP BY DATE(time)
  ORDER BY day
`);

console.log('\n📅 March 2024 Daily Breakdown:');
if (daily.rows.length === 0) {
  console.log('  No data found for March 2024');
} else {
  daily.rows.forEach(row => {
    console.log(`  ${row.day.toISOString().split('T')[0]}: ${parseInt(row.ticks).toLocaleString()} ticks`);
  });

  const total = daily.rows.reduce((sum, row) => sum + parseInt(row.ticks), 0);
  console.log(`\n  Total: ${total.toLocaleString()} ticks across ${daily.rows.length} days`);
}

process.exit(0);
