import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadConfig,
  validateProductionConfig,
  resetConfigCache,
  getJwtSecret,
} from '../config/env.js';

describe('production config validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetConfigCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
  });

  it('passes validation in development without S3', () => {
    process.env.PLETHORA_ENV = 'development';
    delete process.env.S3_ENDPOINT;
    const config = loadConfig();
    const errors = validateProductionConfig(config);
    expect(errors).toHaveLength(0);
  });

  it('fails production without DATABASE_URL', () => {
    process.env.PLETHORA_ENV = 'production';
    delete process.env.DATABASE_URL;
    const config = loadConfig();
    const errors = validateProductionConfig(config);
    expect(errors.some((e) => e.field === 'DATABASE_URL')).toBe(true);
  });

  it('fails production with dev JWT secret', () => {
    process.env.PLETHORA_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://u:p@host/db?sslmode=require';
    process.env.JWT_SECRET = 'plethora-default-dev-secret-change-in-prod';
    process.env.S3_ENDPOINT = 'https://example.r2.cloudflarestorage.com';
    process.env.S3_BUCKET = 'bucket';
    process.env.S3_ACCESS_KEY_ID = 'key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
    process.env.METRICS_TOKEN = 'metrics-token';
    process.env.CORS_ORIGINS = 'https://app.example.com';

    const config = loadConfig();
    const errors = validateProductionConfig(config);
    expect(errors.some((e) => e.field === 'JWT_SECRET')).toBe(true);
  });

  it('fails production without S3 configuration', () => {
    process.env.PLETHORA_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://u:p@host/db?sslmode=require';
    process.env.JWT_SECRET = 'a'.repeat(48);
    delete process.env.S3_ENDPOINT;
    process.env.METRICS_TOKEN = 'metrics-token';
    process.env.CORS_ORIGINS = 'https://app.example.com';

    const config = loadConfig();
    const errors = validateProductionConfig(config);
    expect(errors.some((e) => e.field === 'S3_*')).toBe(true);
  });

  it('fails production without METRICS_TOKEN', () => {
    process.env.PLETHORA_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://u:p@host/db?sslmode=require';
    process.env.JWT_SECRET = 'a'.repeat(48);
    process.env.S3_ENDPOINT = 'https://example.r2.cloudflarestorage.com';
    process.env.S3_BUCKET = 'bucket';
    process.env.S3_ACCESS_KEY_ID = 'key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
    delete process.env.METRICS_TOKEN;
    process.env.CORS_ORIGINS = 'https://app.example.com';

    const config = loadConfig();
    const errors = validateProductionConfig(config);
    expect(errors.some((e) => e.field === 'METRICS_TOKEN')).toBe(true);
  });

  it('passes production with all required vars', () => {
    process.env.PLETHORA_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://u:p@host/db?sslmode=require';
    process.env.JWT_SECRET = 'a'.repeat(48);
    process.env.S3_ENDPOINT = 'https://example.r2.cloudflarestorage.com';
    process.env.S3_BUCKET = 'bucket';
    process.env.S3_ACCESS_KEY_ID = 'key';
    process.env.S3_SECRET_ACCESS_KEY = 'secret';
    process.env.METRICS_TOKEN = 'metrics-token';
    process.env.CORS_ORIGINS = 'https://app.example.com';

    const config = loadConfig();
    const errors = validateProductionConfig(config);
    expect(errors).toHaveLength(0);
  });

  it('uses dev JWT secret fallback only in development', () => {
    delete process.env.JWT_SECRET;
    process.env.PLETHORA_ENV = 'development';
    expect(getJwtSecret()).toBe('plethora-default-dev-secret-change-in-prod');
  });

  it('prefers unpooled URL for migrations', async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@ep-xxx-pooler.host/db?sslmode=require';
    process.env.DATABASE_URL_UNPOOLED = 'postgresql://u:p@ep-xxx.host/db?sslmode=require';
    const { getMigrationDatabaseUrl } = await import('../config/env.js');
    resetConfigCache();
    expect(getMigrationDatabaseUrl()).toBe(process.env.DATABASE_URL_UNPOOLED);
  });

  it('falls back to DATABASE_URL for migrations when unpooled unset', async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost/db';
    delete process.env.DATABASE_URL_UNPOOLED;
    delete process.env.DATABASE_DIRECT_URL;
    const { getMigrationDatabaseUrl } = await import('../config/env.js');
    resetConfigCache();
    expect(getMigrationDatabaseUrl()).toBe(process.env.DATABASE_URL);
  });
});
