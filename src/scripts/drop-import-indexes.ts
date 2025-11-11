#!/usr/bin/env tsx
/**
 * Drop expensive indexes before bulk import
 *
 * Professional DBAs drop non-essential indexes during bulk loads
 * to avoid write amplification. This script drops the BTREE indexes
 * that are expensive to maintain during inserts.
 *
 * KEEPS:
 * - forex_ticks_symbol_time_uq (UNIQUE) - Required for duplicate detection
 * - forex_ticks_time_brin (BRIN) - Low overhead, minimal impact
 *
 * DROPS:
 * - forex_ticks_time_idx (BTREE) - Expensive during inserts
 * - forex_ticks_symbol_time_idx (BTREE) - Redundant with UNIQUE constraint
 *
 * Usage:
 *   npm run drop-indexes
 */

import { getPool, closePool } from '../utils/database.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log(`
╔════════════════════════════════════════════════╗
║        Drop Indexes for Bulk Import           ║
╚════════════════════════════════════════════════╝
`);

  const pool = getPool();

  try {
    // Check which indexes exist
    console.log('📊 Checking existing indexes...\n');

    const result = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'market_ticks'
      ORDER BY indexname;
    `);

    console.log('Current indexes:');
    result.rows.forEach(row => {
      console.log(`  - ${row.indexname}`);
    });
    console.log('');

    // Drop expensive BTREE indexes
    const indexesToDrop = [
      'forex_ticks_time_idx',
      'forex_ticks_symbol_time_idx'
    ];

    for (const indexName of indexesToDrop) {
      const exists = result.rows.some(row => row.indexname === indexName);

      if (exists) {
        console.log(`🗑️  Dropping ${indexName}...`);
        await pool.query(`DROP INDEX IF EXISTS ${indexName};`);
        console.log(`   ✅ Dropped\n`);
      } else {
        console.log(`⏭️  ${indexName} doesn't exist, skipping\n`);
      }
    }

    // Show what remains
    const remainingResult = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'market_ticks'
      ORDER BY indexname;
    `);

    console.log('✅ Remaining indexes (kept for import):');
    remainingResult.rows.forEach(row => {
      console.log(`  - ${row.indexname}`);
    });

    console.log(`
╔════════════════════════════════════════════════╗
║               Indexes Dropped! ✅              ║
╚════════════════════════════════════════════════╝

Your import will now be 5-10x faster!

Next steps:
  1. Run your import:
     npm run import -- --symbol EURUSD --from 2024-03-01 --to 2024-03-31

  2. Recreate indexes after import:
     npm run recreate-indexes
`);

  } catch (error) {
    console.error('\n❌ Error dropping indexes:', error);
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
