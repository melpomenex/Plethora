/**
 * Environment configuration and production validation.
 */

const DEV_JWT_SECRET = 'plethora-default-dev-secret-change-in-prod';

export type PlethoraEnv = 'development' | 'staging' | 'production' | 'test';

export interface AppConfig {
  plethoraEnv: PlethoraEnv;
  nodeEnv: string;
  port: number;
  jwtSecret: string;
  corsOrigins: string[];
  databaseUrl: string;
  /** Direct (non-pooled) Postgres URL for migrations; Neon writes DATABASE_URL_UNPOOLED */
  databaseDirectUrl?: string;
  databaseSsl: boolean;
  pgPoolMax: number;
  metricsToken?: string;
  enableLegacyRoutes: boolean;
  s3?: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
}

function parsePlethoraEnv(): PlethoraEnv {
  const raw = process.env.PLETHORA_ENV || process.env.NODE_ENV || 'development';
  if (raw === 'production' || raw === 'staging' || raw === 'test' || raw === 'development') {
    return raw;
  }
  return 'development';
}

function isProductionLike(env: PlethoraEnv): boolean {
  return env === 'production' || env === 'staging';
}

/** Tauri desktop builds use these origins in production; dev Vite localhost is not allowed. */
const PRODUCTION_CORS_ALLOWLIST = new Set(['https://tauri.localhost', 'tauri://localhost']);

function isDisallowedProductionCorsOrigin(origin: string): boolean {
  if (PRODUCTION_CORS_ALLOWLIST.has(origin)) {
    return false;
  }
  return /localhost|127\.0\.0\.1/i.test(origin);
}

export function getJwtSecret(): string {
  return process.env.JWT_SECRET || DEV_JWT_SECRET;
}

export function loadConfig(): AppConfig {
  const plethoraEnv = parsePlethoraEnv();
  const nodeEnv = process.env.NODE_ENV || 'development';
  const port = parseInt(process.env.PORT || '3000', 10);
  const jwtSecret = getJwtSecret();
  const corsOrigins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) || [
    'http://localhost:5173',
    'http://localhost:15173',
    'http://localhost:8765',
  ];
  const databaseUrl = process.env.DATABASE_URL || '';
  const databaseDirectUrl =
    process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_DIRECT_URL || undefined;
  const databaseSsl =
    process.env.DATABASE_SSL === 'true' ||
    process.env.DATABASE_SSL === '1' ||
    (databaseUrl.includes('sslmode=require') ?? false);
  const pgPoolMax = parseInt(process.env.PG_POOL_MAX || (isProductionLike(plethoraEnv) ? '8' : '20'), 10);
  const metricsToken = process.env.METRICS_TOKEN;
  const enableLegacyRoutes =
    process.env.ENABLE_LEGACY_ROUTES === 'true' ||
    (!isProductionLike(plethoraEnv) && process.env.ENABLE_LEGACY_ROUTES !== 'false');

  const s3Endpoint = process.env.S3_ENDPOINT;
  const s3Bucket = process.env.S3_BUCKET;
  const s3AccessKey = process.env.S3_ACCESS_KEY_ID;
  const s3SecretKey = process.env.S3_SECRET_ACCESS_KEY;

  let s3: AppConfig['s3'];
  if (s3Endpoint && s3Bucket && s3AccessKey && s3SecretKey) {
    s3 = {
      endpoint: s3Endpoint,
      region: process.env.S3_REGION || 'auto',
      bucket: s3Bucket,
      accessKeyId: s3AccessKey,
      secretAccessKey: s3SecretKey,
    };
  }

  return {
    plethoraEnv,
    nodeEnv,
    port,
    jwtSecret,
    corsOrigins,
    databaseUrl,
    databaseDirectUrl,
    databaseSsl,
    pgPoolMax,
    metricsToken,
    enableLegacyRoutes,
    s3,
  };
}

export interface ConfigValidationError {
  field: string;
  message: string;
}

export function validateProductionConfig(config: AppConfig): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];

  if (!isProductionLike(config.plethoraEnv)) {
    return errors;
  }

  if (!config.databaseUrl) {
    errors.push({ field: 'DATABASE_URL', message: 'DATABASE_URL is required in production' });
  }

  if (!config.jwtSecret || config.jwtSecret === DEV_JWT_SECRET || config.jwtSecret.length < 32) {
    errors.push({
      field: 'JWT_SECRET',
      message: 'JWT_SECRET must be set to a random string of at least 32 characters (not the dev default)',
    });
  }

  if (!config.s3) {
    errors.push({
      field: 'S3_*',
      message:
        'S3-compatible object storage is required in production (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)',
    });
  }

  if (!config.metricsToken) {
    errors.push({
      field: 'METRICS_TOKEN',
      message: 'METRICS_TOKEN is required in production to protect /metrics',
    });
  }

  if (config.corsOrigins.some(isDisallowedProductionCorsOrigin)) {
    errors.push({
      field: 'CORS_ORIGINS',
      message:
        'CORS_ORIGINS should not include dev localhost in production (Tauri origins https://tauri.localhost and tauri://localhost are allowed)',
    });
  }

  return errors;
}

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}

/** Connection string for schema migrations — prefers direct/unpooled Neon endpoint. */
export function getMigrationDatabaseUrl(config?: AppConfig): string {
  const cfg = config ?? getConfig();
  return cfg.databaseDirectUrl || cfg.databaseUrl;
}
