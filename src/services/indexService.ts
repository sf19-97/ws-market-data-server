import { Pool } from 'pg';
import { IMPORT_INDEXES_TO_DROP, DATABASE_INDEXES } from '../utils/constants.js';

export interface IndexInfo {
  name: string;
  definition: string;
}

/**
 * Service for managing database indexes during bulk imports
 */
export class IndexService {
  constructor(private pool: Pool) {}

  /**
   * Drop indexes that slow down bulk imports
   * These are the expensive BTREE indexes
   */
  async dropImportIndexes(): Promise<string[]> {
    const droppedIndexes: string[] = [];

    for (const indexName of IMPORT_INDEXES_TO_DROP) {
      try {
        await this.pool.query(`DROP INDEX IF EXISTS ${indexName};`);
        droppedIndexes.push(indexName);
      } catch (error: any) {
        console.warn(`Could not drop ${indexName}:`, error.message);
      }
    }

    return droppedIndexes;
  }

  /**
   * Recreate indexes after bulk import
   * Uses CONCURRENTLY to avoid locking the table
   */
  async recreateIndexes(): Promise<{ success: string[]; failed: string[] }> {
    const indexes = [
      {
        name: DATABASE_INDEXES.TIME_BTREE,
        sql: 'CREATE INDEX CONCURRENTLY forex_ticks_time_idx ON market_ticks USING btree (time DESC);'
      },
      {
        name: DATABASE_INDEXES.SYMBOL_TIME_BTREE,
        sql: 'CREATE INDEX CONCURRENTLY forex_ticks_symbol_time_idx ON market_ticks USING btree (symbol, time DESC);'
      }
    ];

    const success: string[] = [];
    const failed: string[] = [];

    for (const index of indexes) {
      try {
        await this.pool.query(index.sql);
        success.push(index.name);
      } catch (error: any) {
        console.error(`Could not create ${index.name}:`, error.message);
        failed.push(index.name);
      }
    }

    return { success, failed };
  }

  /**
   * Run ANALYZE on market_ticks table to update statistics
   */
  async analyzeTable(): Promise<void> {
    await this.pool.query('ANALYZE market_ticks;');
  }

  /**
   * Check if an index exists
   */
  async indexExists(indexName: string): Promise<boolean> {
    const result = await this.pool.query(`
      SELECT 1
      FROM pg_indexes
      WHERE indexname = $1
      LIMIT 1
    `, [indexName]);

    return result.rows.length > 0;
  }

  /**
   * Get all indexes on market_ticks table
   */
  async getTableIndexes(): Promise<IndexInfo[]> {
    const result = await this.pool.query(`
      SELECT
        indexname as name,
        indexdef as definition
      FROM pg_indexes
      WHERE tablename = 'market_ticks'
      ORDER BY indexname
    `);

    return result.rows;
  }

  /**
   * Get index size in bytes
   */
  async getIndexSize(indexName: string): Promise<number> {
    const result = await this.pool.query(`
      SELECT pg_relation_size($1::regclass) as size
    `, [indexName]);

    return parseInt(result.rows[0]?.size || '0');
  }

  /**
   * Refresh all materialized views concurrently
   */
  async refreshMaterializedViews(): Promise<void> {
    const views = [
      'forex_candles_5m',
      'forex_candles_15m',
      'forex_candles_1h',
      'forex_candles_4h',
      'forex_candles_12h'
    ];

    // Note: In PostgreSQL, you can't run multiple REFRESH MATERIALIZED VIEW CONCURRENTLY
    // in parallel, so we do them sequentially
    for (const view of views) {
      try {
        await this.pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view};`);
      } catch (error: any) {
        console.error(`Failed to refresh ${view}:`, error.message);
        // Continue with other views even if one fails
      }
    }
  }
}
