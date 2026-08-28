import { describe, expect, it } from 'vitest';
import { loadConfig, resetConfigCache } from '../config/env.js';
import { isAllowedCorsOrigin } from '../config/cors.js';

describe('CORS origin allowlist', () => {
  it('allows configured origins and built-in native clients', () => {
    process.env.CORS_ORIGINS = 'https://useplethora.com';
    resetConfigCache();
    const config = loadConfig();

    expect(isAllowedCorsOrigin('https://useplethora.com', config)).toBe(true);
    expect(isAllowedCorsOrigin('https://tauri.localhost', config)).toBe(true);
    expect(isAllowedCorsOrigin('https://appassets.androidplatform.net', config)).toBe(true);
    expect(isAllowedCorsOrigin('null', config)).toBe(true);
    expect(isAllowedCorsOrigin('https://evil.example', config)).toBe(false);
  });
});
