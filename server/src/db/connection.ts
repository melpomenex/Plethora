import pg from 'pg';
const { Pool } = pg;

import { getConfig, type AppConfig } from '../config/env.js';

let pool: pg.Pool | null = null;

export interface DatabaseInitOptions {
  poolMax?: number;
}

function resolveSsl(config: AppConfig, connectionString: string): pg.PoolConfig['ssl'] {
  const sslEnabled =
    config.databaseSsl ||
    connectionString.includes('sslmode=require') ||
    connectionString.includes('sslmode=verify-full');
  return sslEnabled ? { rejectUnauthorized: true } : undefined;
}

async function createPool(
  connectionString: string,
  config: AppConfig,
  options: DatabaseInitOptions = {},
): Promise<pg.Pool> {
  const nextPool = new Pool({
    connectionString,
    max: options.poolMax ?? config.pgPoolMax,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: resolveSsl(config, connectionString),
  });

  const client = await nextPool.connect();
  try {
    await client.query('SELECT NOW()');
  } finally {
    client.release();
  }

  return nextPool;
}

export function getPool(): pg.Pool {
  if (!pool) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return pool;
}

export async function initDatabase(options: DatabaseInitOptions = {}): Promise<void> {
  const config = getConfig();
  const connectionString = config.databaseUrl;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  pool = await createPool(connectionString, config, options);
}

/** Initialize a pool for one-shot migrations (direct/unpooled connection preferred). */
export async function initMigrationDatabase(): Promise<void> {
  const config = getConfig();
  const connectionString = config.databaseDirectUrl || config.databaseUrl;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL_UNPOOLED or DATABASE_URL is required for migrations',
    );
  }

  pool = await createPool(connectionString, config, { poolMax: 1 });
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const p = getPool();
    await p.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
