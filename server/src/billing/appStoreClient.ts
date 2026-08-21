/**
 * App Store Server API client (openspec change
 * implement-native-ios-storekit2-billing §6.1).
 *
 * Requests are authenticated with a JWT signed ES256 using the In-App
 * Purchase key downloaded from App Store Connect. Configuration comes from
 * the environment (secrets protocol):
 *
 *   APP_STORE_KEY_ID        — the key's ID from ASC (Users and Access → Keys)
 *   APP_STORE_ISSUER_ID     — the ASC API issuer id
 *   APP_STORE_PRIVATE_KEY   — the .p8 PEM body; literal \n escapes allowed so
 *                             it can ride single-line env vars / secret stores
 *   APP_STORE_BUNDLE_ID     — expected bundle id (default com.plethora.app)
 *   APP_STORE_ENV           — "production" (default) | "sandbox"
 *   APP_STORE_TRUSTED_ROOT_SHA256 — optional comma-separated trusted root
 *                                   fingerprints overriding the built-in set
 *
 * Secrets live ONLY in server env — never in the app bundle, never in code.
 *
 * Degraded mode: when credentials are absent the client reports
 * `configured: false`. Transaction verification still works for
 * client-supplied JWS payloads (they are self-contained and verified against
 * the Apple certificate chain), but server-initiated lookups (transaction
 * re-query, subscription status) return 503 asc_not_configured. Degraded mode
 * is acceptable ONLY in sandbox/development — never production.
 */

import { createPrivateKey } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AppError } from '../middleware/error.js';

export const PRODUCTION_BASE_URL = 'https://api.storekit.itunes.apple.com';
export const SANDBOX_BASE_URL = 'https://api.storekit-sandbox.itunes.apple.com';

export interface AppStoreConfig {
  keyId: string;
  issuerId: string;
  privateKeyPem: string;
  bundleId: string;
  environment: 'production' | 'sandbox';
  baseUrl: string;
}

export interface LoadedAppStoreConfig extends AppStoreConfig {
  /** Key object cached for JWT signing. */
  signingKey: ReturnType<typeof createPrivateKey>;
}

/** Read + validate env config. Returns null when unconfigured (degraded mode). */
export function loadAppStoreConfig(env: NodeJS.ProcessEnv = process.env): LoadedAppStoreConfig | null {
  const keyId = env.APP_STORE_KEY_ID?.trim();
  const issuerId = env.APP_STORE_ISSUER_ID?.trim();
  let privateKeyPem = env.APP_STORE_PRIVATE_KEY ?? '';
  if (!keyId || !issuerId || !privateKeyPem.trim()) {
    return null;
  }
  // Allow single-line storage with escaped newlines.
  if (!privateKeyPem.includes('\n')) {
    privateKeyPem = privateKeyPem.replace(/\\n/g, '\n');
  }
  let signingKey: ReturnType<typeof createPrivateKey>;
  try {
    signingKey = createPrivateKey(privateKeyPem);
  } catch (err) {
    throw new AppError(
      500,
      'asc_key_invalid',
      `APP_STORE_PRIVATE_KEY is not a parseable PEM private key: ${String(err)}`
    );
  }

  const environment =
    (env.APP_STORE_ENV?.trim().toLowerCase() as 'production' | 'sandbox') ?? 'production';
  if (environment !== 'production' && environment !== 'sandbox') {
    throw new AppError(500, 'asc_env_invalid', 'APP_STORE_ENV must be "production" or "sandbox"');
  }

  return {
    keyId,
    issuerId,
    privateKeyPem,
    bundleId: env.APP_STORE_BUNDLE_ID?.trim() || 'com.plethora.app',
    environment,
    baseUrl:
      environment === 'sandbox' ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL,
    signingKey,
  };
}

/** Whether server-initiated App Store Server API calls are available. */
export function isAppStoreConfigured(): boolean {
  return loadAppStoreConfig() !== null;
}

const TOKEN_TTL_SECONDS = 20 * 60;

/**
 * Create the ASC request token: aud appstoreconnect-v1, ES256-signed,
 * kid in the header per Apple's spec.
 */
export function createAscToken(
  config: LoadedAppStoreConfig,
  nowSeconds = Math.floor(Date.now() / 1000)
): string {
  return jwt.sign(
    {
      iss: config.issuerId,
      iat: nowSeconds,
      exp: nowSeconds + TOKEN_TTL_SECONDS,
      aud: 'appstoreconnect-v1',
    },
    config.privateKeyPem,
    {
      algorithm: 'ES256',
      keyid: config.keyId,
      header: {
        alg: 'ES256',
        kid: config.keyId,
        typ: 'JWT',
      },
    }
  );
}

export interface AscTransactionLookup {
  signedTransactionInfo: string;
  environment?: string;
}

/**
 * GET /inApps/v1/transactions/{transactionId} — authoritative re-query used
 * by reconciliation. Throws typed errors on missing config or HTTP failure.
 */
export async function getSignedTransactionInfo(
  transactionId: string,
  fetchImpl: typeof fetch = fetch
): Promise<AscTransactionLookup> {
  const config = loadAppStoreConfig();
  if (!config) {
    throw new AppError(
      503,
      'asc_not_configured',
      'App Store Server API credentials are not configured (APP_STORE_KEY_ID/APP_STORE_ISSUER_ID/APP_STORE_PRIVATE_KEY)'
    );
  }
  const token = createAscToken(config);
  const res = await fetchImpl(`${config.baseUrl}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new AppError(
      res.status === 404 ? 404 : 502,
      res.status === 404 ? 'transaction_not_found' : 'asc_request_failed',
      `App Store Server API returned ${res.status}`
    );
  }
  const body = (await res.json()) as AscTransactionLookup;
  if (!body.signedTransactionInfo) {
    throw new AppError(502, 'asc_response_invalid', 'Missing signedTransactionInfo');
  }
  return body;
}
