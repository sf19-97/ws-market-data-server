import { Pool, PoolConfig } from 'pg';
import { DB_POOL_DEFAULTS } from './constants.js';

let pool: Pool | null = null;

/**
 * Get database connection pool configuration
 * Uses environment variables for flexibility
 */
function getPoolConfig(): PoolConfig {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const isProduction = process.env.NODE_ENV === 'production';

  // SSL configuration based on environment
  let sslConfig: PoolConfig['ssl'];

  if (isProduction) {
    // In production, verify SSL certificates
    sslConfig = {
      rejectUnauthorized: true,
      // Optional: provide CA certificate
      ...(process.env.DB_CA_CERT && { ca: process.env.DB_CA_CERT })
    };
  } else {
    // In development, allow self-signed certificates
    // Can be disabled entirely with DB_SSL=false
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

export function getPool(): Pool {
  if (!pool) {
    const config = getPoolConfig();
    pool = new Pool(config);

    // Log pool events for monitoring
    pool.on('connect', () => {
      console.log('Database client connected to pool');
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });

    console.log('Database pool created with config:', {
      max: config.max,
      idleTimeoutMillis: config.idleTimeoutMillis,
      connectionTimeoutMillis: config.connectionTimeoutMillis,
      ssl: config.ssl ? 'enabled' : 'disabled'
    });
  }

  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('Database pool closed');
  }
}

// Test database connection
export async function testConnection(): Promise<void> {
  try {
    const client = getPool();
    const result = await client.query('SELECT NOW()');
    console.log('Database connection successful:', result.rows[0]);
  } catch (error) {
    console.error('Database connection failed:', error);
    throw error;
  }
}