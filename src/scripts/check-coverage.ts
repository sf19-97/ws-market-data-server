#!/usr/bin/env tsx
import { getPool } from '../utils/database.js';
import dotenv from 'dotenv';

dotenv.config();

const pool = getPool();

// Check total count and date range
const summary = await pool.query(`
  SELECT
    COUNT(*) as total_ticks,
    DATE(MIN(time)) as first_date,
    DATE(MAX(time)) as last_date,
    COUNT(DISTINCT DATE(time)) as days_with_data
  FROM market_ticks
  WHERE symbol='EURUSD'
`);

console.log('\n📊 EURUSD Data Summary:');
console.log(summary.rows[0]);

// Check monthly breakdown
const monthly = await pool.query(`
  SELECT
    TO_CHAR(time, 'YYYY-MM') as month,
    COUNT(*) as ticks
  FROM market_ticks
  WHERE symbol='EURUSD'
  GROUP BY TO_CHAR(time, 'YYYY-MM')
  ORDER BY month
`);

console.log('\n📅 Monthly Breakdown:');
monthly.rows.forEach(row => {
  console.log(`  ${row.month}: ${parseInt(row.ticks).toLocaleString()} ticks`);
});

process.exit(0);
