#!/usr/bin/env tsx
import { getPool } from '../utils/database.js';
import dotenv from 'dotenv';

dotenv.config();

const pool = getPool();
const result = await pool.query(`
  SELECT COUNT(*), MIN(time), MAX(time)
  FROM market_ticks
  WHERE symbol='EURUSD'
`);
console.log('EURUSD Data:', result.rows[0]);
process.exit(0);
