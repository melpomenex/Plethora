import type { AppConfig } from './env.js';

/** Native Tauri/Android WebView origins — always allowed alongside CORS_ORIGINS. */
export const BUILTIN_CLIENT_ORIGINS = new Set([
  'https://tauri.localhost',
  'http://tauri.localhost',
  'tauri://localhost',
  'https://appassets.androidplatform.net',
  // Opaque origins from custom schemes / sandboxed WebViews send Origin: null.
  'null',
]);

export function isAllowedCorsOrigin(origin: string, config: AppConfig): boolean {
  if (BUILTIN_CLIENT_ORIGINS.has(origin)) {
    return true;
  }
  return config.corsOrigins.includes(origin);
}

/** Dynamic origin callback for the `cors` package (credentials: true). */
export function createCorsOrigin(config: AppConfig) {
  return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // curl, native HTTP clients, and same-origin requests omit Origin.
    if (!origin) {
      callback(null, true);
      return;
    }
    if (isAllowedCorsOrigin(origin, config)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Not allowed by CORS: ${origin}`));
  };
}
