#!/usr/bin/env tsx
/**
 * Recreate indexes after bulk import
 *
 * Professional DBAs recreate indexes with CONCURRENTLY to allow
 * reads during index creation. This script recreates the BTREE
 * indexes that were dropped before import.
 *
 * Uses CONCURRENTLY to avoid blocking queries during rebuild.
 *
 * Usage:
 *   npm run recreate-indexes
 */

import { getPool, closePool } from '../utils/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log(`
╔════════════════════════════════════════════════╗
║          Recreate Indexes After Import        ║
╚════════════════════════════════════════════════╝
`);

  const pool = getPool();

  try {
    // Check current indexes
    console.log('📊 Checking current indexes...\n');

    const result = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'market_ticks'
      ORDER BY indexname;
    `);

    console.log('Current indexes:');
    result.rows.forEach(row => {
      console.log(`  - ${row.indexname}`);
    });
    console.log('');

    // Define indexes to recreate
    const indexes = [
      {
        name: 'forex_ticks_time_idx',
        sql: 'CREATE INDEX CONCURRENTLY forex_ticks_time_idx ON market_ticks USING btree (time DESC);',
        description: 'BTREE index on time (for time-based queries)'
      },
      {
        name: 'forex_ticks_symbol_time_idx',
        sql: 'CREATE INDEX CONCURRENTLY forex_ticks_symbol_time_idx ON market_ticks USING btree (symbol, time DESC);',
        description: 'BTREE index on (symbol, time) for queries'
      }
    ];

    // Recreate indexes
    for (const index of indexes) {
      const exists = result.rows.some(row => row.indexname === index.name);

      if (exists) {
        console.log(`⏭️  ${index.name} already exists, skipping\n`);
        continue;
      }

      console.log(`🔨 Creating ${index.name}...`);
      console.log(`   ${index.description}`);

      const startTime = Date.now();

      // Note: CONCURRENTLY allows reads during index creation
      // but requires a separate transaction (can't be in a transaction block)
      await pool.query(index.sql);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`   ✅ Created in ${duration}s\n`);
    }

    // Run ANALYZE to update statistics
    console.log('📊 Running ANALYZE to update query planner statistics...');
    await pool.query('ANALYZE market_ticks;');
    console.log('   ✅ Statistics updated\n');

    // Show final state
    const finalResult = await pool.query(`
      SELECT indexname, pg_size_pretty(pg_relation_size(indexname::regclass)) as size
      FROM pg_indexes
      WHERE tablename = 'market_ticks'
      ORDER BY indexname;
    `);

    console.log('✅ Final indexes:');
    finalResult.rows.forEach(row => {
      console.log(`  - ${row.indexname} (${row.size})`);
    });

    console.log(`
╔════════════════════════════════════════════════╗
║             Indexes Recreated! ✅              ║
╚════════════════════════════════════════════════╝

Your database is now optimized for queries!

Optional: Refresh materialized views if needed:
  npm run refresh-mvs
`);

  } catch (error) {
    console.error('\n❌ Error recreating indexes:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
