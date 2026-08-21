/**
 * Apple App Store transaction JWS verification (openspec change
 * implement-native-ios-storekit2-billing §6.2).
 *
 * StoreKit 2 transactions arrive as compact JWS serializations whose header
 * carries an `x5c` certificate chain: [leaf, intermediate, Apple Root CA].
 * Verification requires ALL of:
 *   1. well-formed three-part JWS with alg=ES256 and a ≥3-entry x5c chain,
 *   2. the chain cryptographically links (leaf ← intermediate ← root),
 *   3. the root's SHA-256 fingerprint matches a trusted Apple root,
 *   4. every certificate is inside its validity window,
 *   5. the ES256 signature over header.payload verifies with the leaf key,
 *   6. the decoded payload's bundleId matches the configured app bundle.
 *
 * Anything failing ANY step is rejected: unverifiable data is never granted
 * (design §Failure Behavior). This module is pure crypto/parsing — no DB, no
 * network — so the fixture tests cover valid / expired / revoked /
 * wrong-bundle / tampered payloads deterministically.
 */

import {
  createHash,
  sign as cryptoSign,
  verify as cryptoVerify,
  X509Certificate,
} from 'node:crypto';

/** Default bundle id (matches src-tauri/tauri.conf.json identifier). */
export const DEFAULT_BUNDLE_ID = 'com.plethora.app';

/**
 * Trusted root fingerprints (lowercase hex, colon-less SHA-256). Defaults to
 * Apple Root CA - G3 as published by Apple's certificate authority program;
 * override/extend via APP_STORE_TRUSTED_ROOT_SHA256 (comma-separated).
 *
 * NOTE: confirm this constant against https://www.apple.com/certificate-authority/
 * before production sign-off; tests inject their own fixture fingerprint.
 */
export const APPLE_ROOT_CA_G3_SHA256 =
  'b0b1216acc2599705ed2b8e4f7fc416cc16695eacc4e32d8261f5673ec946695';

export function trustedRootFingerprints(envRoots?: string): string[] {
  if (envRoots && envRoots.trim().length > 0) {
    return envRoots
      .split(',')
      .map((s) => s.trim().toLowerCase().replace(/:/g, ''))
      .filter((s) => s.length > 0);
  }
  return [APPLE_ROOT_CA_G3_SHA256];
}

/** Decoded JWSTransactionDecodedPayload fields we rely on. */
export interface VerifiedAppStoreTransaction {
  /** Original (durable) transaction id — the entitlement key. */
  originalTransactionId: string;
  transactionId: string;
  bundleId: string;
  productId: string;
  /** Epoch ms */
  purchaseDate: number;
  /** Epoch ms; absent for non-expiring purchases */
  expiresDate?: number;
  /** Epoch ms; present iff refunded/revoked by Apple support */
  revocationDate?: number;
  revocationReason?: number;
  /** "Production" | "Sandbox" | "Xcode" */
  environment: string;
  /** UUID string binding the purchase to a Plethora account */
  appAccountToken?: string;
  /** e.g. "Auto-Renewable Subscription" */
  type?: string;
  /** Epoch ms of signing (replay ordering aid) */
  signedDate?: number;
}

export type JwsRejectionReason =
  | 'malformed'
  | 'unsupported-alg'
  | 'bad-chain'
  | 'untrusted-root'
  | 'cert-expired'
  | 'signature-mismatch'
  | 'wrong-bundle'
  | 'invalid-environment'
  | 'invalid-payload';

export interface JwsVerificationResult {
  ok: boolean;
  reason?: JwsRejectionReason;
  detail?: string;
  payload?: VerifiedAppStoreTransaction;
}

function base64UrlDecodeToBuffer(input: string): Buffer {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

function base64UrlDecodeJson<T>(input: string): T {
  return JSON.parse(base64UrlDecodeToBuffer(input).toString('utf-8')) as T;
}

function certFingerprint(cert: X509Certificate): string {
  return createHash('sha256').update(cert.raw).digest('hex');
}

function derToPem(derBase64: string): string {
  const lines = derBase64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

function withinValidityWindow(cert: X509Certificate, now: number): boolean {
  // validFromDate/validToDate are Dates on current Node types (strings in
  // older typings) — normalize through `new Date`.
  const from = new Date(cert.validFromDate as unknown as string | Date).getTime();
  const to = new Date(cert.validToDate as unknown as string | Date).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return false;
  return now >= from && now <= to;
}

/**
 * Verify an ES256 JWS signature against a public key. Apple produces raw
 * r||s signatures (RFC 7518 ieee-p1363); our own fixtures may produce DER.
 * Both are accepted here.
 */
export function verifyEs256Signature(
  signingInput: string,
  publicKey: X509Certificate['publicKey'],
  signatureB64Url: string
): boolean {
  const signature = base64UrlDecodeToBuffer(signatureB64Url);
  for (const dsaEncoding of ['ieee-p1363', 'der'] as const) {
    try {
      const ok = cryptoVerify('sha256', Buffer.from(signingInput, 'utf-8'), {
        key: publicKey,
        dsaEncoding,
      }, signature);
      if (ok) return true;
    } catch {
      // Wrong encoding for this key — try the next.
    }
  }
  return false;
}

export interface VerifyAppleJwsOptions {
  /** Expected bundle id (default com.plethora.app). */
  bundleId?: string;
  /** Trusted root fingerprints (hex). Defaults to Apple Root CA - G3. */
  trustedRoots?: string[];
  /** Clock override for tests (epoch ms). */
  now?: number;
  /**
   * Allowed environments (default Production + Sandbox). The "Xcode"
   * environment comes from local Xcode builds and is not accepted.
   */
  allowedEnvironments?: string[];
}

export interface EnvelopeVerification {
  ok: boolean;
  reason?: JwsRejectionReason;
  detail?: string;
  /** Decoded payload object (untyped) — present when ok. */
  payload?: Record<string, unknown>;
  /** Verified leaf certificate (exposed for callers needing chain details). */
  leaf?: X509Certificate;
}

/**
 * Verify ONLY the JWS cryptographic envelope (structure, alg, x5c chain,
 * trust anchor, cert validity, ES256 signature). Payload semantics (bundle
 * id, environment, transaction fields) are applied by callers.
 */
export function verifyEnvelope(
  jws: string,
  options: Pick<VerifyAppleJwsOptions, 'trustedRoots'> & { now?: number } = {}
): EnvelopeVerification {
  const now = options.now ?? Date.now();

  const parts = jws.split('.');
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    return { ok: false, reason: 'malformed', detail: 'expected compact JWS with 3 parts' };
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; x5c?: string[] };
  let decoded: Record<string, unknown>;
  try {
    header = base64UrlDecodeJson(headerB64);
    decoded = base64UrlDecodeJson(payloadB64);
  } catch (err) {
    return { ok: false, reason: 'malformed', detail: `undecodable JSON: ${String(err)}` };
  }

  if (header.alg !== 'ES256') {
    return { ok: false, reason: 'unsupported-alg', detail: `alg=${header.alg}` };
  }

  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length < 3) {
    return { ok: false, reason: 'bad-chain', detail: 'x5c must contain leaf + intermediate + root' };
  }

  let certs: X509Certificate[];
  try {
    certs = x5c.map((der) => new X509Certificate(derToPem(der)));
  } catch (err) {
    return { ok: false, reason: 'bad-chain', detail: `unparseable certificate: ${String(err)}` };
  }

  const [leaf, intermediate, root] = certs;

  // Cryptographic chain linkage.
  try {
    if (!leaf.verify(intermediate.publicKey) || !intermediate.verify(root.publicKey)) {
      return { ok: false, reason: 'bad-chain', detail: 'certificate signature check failed' };
    }
  } catch (err) {
    return { ok: false, reason: 'bad-chain', detail: String(err) };
  }

  // Trust anchor.
  const roots = options.trustedRoots ?? trustedRootFingerprints();
  if (!roots.includes(certFingerprint(root))) {
    return { ok: false, reason: 'untrusted-root', detail: 'root is not a trusted Apple CA' };
  }

  // Certificate validity windows.
  for (const cert of certs) {
    if (!withinValidityWindow(cert, now)) {
      return { ok: false, reason: 'cert-expired', detail: `${cert.subject} outside validity window` };
    }
  }

  // JWS signature.
  if (!verifyEs256Signature(`${headerB64}.${payloadB64}`, leaf.publicKey, signatureB64)) {
    return { ok: false, reason: 'signature-mismatch', detail: 'ES256 signature did not verify' };
  }

  return { ok: true, payload: decoded, leaf };
}

/**
 * Verify an App Store signed transaction (compact JWS) end-to-end.
 * Returns `{ ok: true, payload }` only when EVERY check passes.
 */
export function verifyAppleJws(
  jws: string,
  options: VerifyAppleJwsOptions = {}
): JwsVerificationResult {
  const envelope = verifyEnvelope(jws, options);
  if (!envelope.ok || !envelope.payload) {
    return { ok: false, reason: envelope.reason, detail: envelope.detail };
  }
  const decoded = envelope.payload;

  // Payload sanity + bundle id binding.
  const originalTransactionId = typeof decoded.originalTransactionId === 'string' ? decoded.originalTransactionId : undefined;
  const transactionId = typeof decoded.transactionId === 'string' ? decoded.transactionId : undefined;
  const bundleId = typeof decoded.bundleId === 'string' ? decoded.bundleId : undefined;
  const productId = typeof decoded.productId === 'string' ? decoded.productId : undefined;
  if (!originalTransactionId || !transactionId || !bundleId || !productId) {
    return { ok: false, reason: 'invalid-payload', detail: 'missing required transaction fields' };
  }

  const expectedBundle = options.bundleId ?? DEFAULT_BUNDLE_ID;
  if (bundleId !== expectedBundle) {
    return { ok: false, reason: 'wrong-bundle', detail: `bundleId ${bundleId} != ${expectedBundle}` };
  }

  const environment = typeof decoded.environment === 'string' ? decoded.environment : '';
  const allowed = options.allowedEnvironments ?? ['Production', 'Sandbox'];
  if (!allowed.includes(environment)) {
    return { ok: false, reason: 'invalid-environment', detail: `environment ${environment}` };
  }

  const num = (v: unknown): number | undefined =>
    typeof v === 'number' ? v : undefined;
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' ? v : undefined;

  const payload: VerifiedAppStoreTransaction = {
    originalTransactionId,
    transactionId,
    bundleId,
    productId,
    purchaseDate: num(decoded.purchaseDate) ?? 0,
    expiresDate: num(decoded.expiresDate),
    revocationDate: num(decoded.revocationDate),
    revocationReason: num(decoded.revocationReason),
    environment,
    appAccountToken: str(decoded.appAccountToken),
    type: str(decoded.type),
    signedDate: num(decoded.signedDate),
  };

  return { ok: true, payload };
}
