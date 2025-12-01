import { Pool, PoolConfig } from 'pg';
import { DB_POOL_DEFAULTS } from '../utils/constants.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger();

let pool: Pool | null = null;

/**
 * Database pool configuration from environment
 */
function getPoolConfig(): PoolConfig {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const isProduction = process.env.NODE_ENV === 'production';

  let sslConfig: PoolConfig['ssl'];

  if (isProduction) {
    sslConfig = {
      rejectUnauthorized: true,
      ...(process.env.DB_CA_CERT && { ca: process.env.DB_CA_CERT })
    };
  } else {
    if (process.env.DB_SSL === 'false') {
      sslConfig = false;
    } else {
      sslConfig = { rejectUnauthorized: false };
    }
  }

  return {
    connectionString: process.env.DATABASE_URL,
    max: parseInt(process.env.DB_POOL_MAX || String(DB_POOL_DEFAULTS.max)),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || String(DB_POOL_DEFAULTS.idleTimeoutMillis)),
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT || String(DB_POOL_DEFAULTS.connectionTimeoutMillis)),
    ssl: sslConfig
  };
}

/**
 * Get or create database connection pool
 */
export function getPool(): Pool {
  if (!pool) {
    const config = getPoolConfig();
    pool = new Pool(config);

    pool.on('connect', () => {
      logger.debug('Database client connected to pool');
    });

    pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected error on idle client');
    });

    logger.info({
      max: config.max,
      idleTimeoutMillis: config.idleTimeoutMillis,
      connectionTimeoutMillis: config.connectionTimeoutMillis,
      ssl: config.ssl ? 'enabled' : 'disabled'
    }, 'Database pool created');
  }

  return pool;
}

/**
 * Close database connection pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database pool closed');
  }
}

/**
 * Test database connection
 */
export async function testConnection(): Promise<void> {
  const client = getPool();
  const result = await client.query('SELECT NOW()');
  logger.info({ time: result.rows[0] }, 'Database connection successful');
}
