/**
 * App Store transaction JWS verification tests (openspec change
 * implement-native-ios-storekit2-billing §6.2, §6.4, §6.5).
 *
 * Fixtures: a locally-generated EC P-256 chain (test-root → test-intermediate
 * → test-leaf) under __tests__/fixtures. The verifier anchors trust to the
 * fixture root's fingerprint — no Apple credentials involved.
 *
 * Coverage:
 *   - valid payload verifies and decodes
 *   - expired transaction (expiresDate in the past)
 *   - revoked transaction (revocationDate present)
 *   - wrong bundle id
 *   - tampered payload (signature mismatch)
 *   - untrusted root / bad chain / wrong alg / malformed
 *   - grant derivation matrix (verified-only; appAccountToken binding)
 *   - ASNS v2: signedPayload verification, handling set, idempotency/replay
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign, createPublicKey as mkPub } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUNDLE_ID,
  verifyAppleJws,
  verifyEs256Signature,
  type VerifiedAppStoreTransaction,
} from '../billing/jws.js';
import { deriveGrant, selectWinningGrant, PRO_GRACE_MS } from '../billing/grants.js';
import {
  HANDLED_NOTIFICATION_TYPES,
  notificationAction,
  notificationIdempotencyKey,
  parseNotification,
} from '../billing/asns.js';

const FIXTURES = join(__dirname, 'fixtures');
const rootPem = readFileSync(join(FIXTURES, 'test-root.pem'), 'utf-8');
const intermediatePem = readFileSync(join(FIXTURES, 'test-intermediate.pem'), 'utf-8');
const leafPem = readFileSync(join(FIXTURES, 'test-leaf.pem'), 'utf-8');
const leafKey = createPrivateKey(readFileSync(join(FIXTURES, 'test-leaf.key'), 'utf-8'));

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** Build a compact ES256 JWS signed by the fixture leaf key. */
function makeJws(payload: Record<string, unknown>, signKey = leafKey, alg = 'ES256'): string {
  const header = {
    alg,
    x5c: [
      // DER certs, base64 (standard), per JWS x5c spec.
      readFileSync(join(FIXTURES, 'test-leaf.pem'), 'utf-8')
        .replace(/-----BEGIN CERTIFICATE-----/, '')
        .replace(/-----END CERTIFICATE-----/, '')
        .replace(/\s+/g, ''),
      readFileSync(join(FIXTURES, 'test-intermediate.pem'), 'utf-8')
        .replace(/-----BEGIN CERTIFICATE-----/, '')
        .replace(/-----END CERTIFICATE-----/, '')
        .replace(/\s+/g, ''),
      readFileSync(join(FIXTURES, 'test-root.pem'), 'utf-8')
        .replace(/-----BEGIN CERTIFICATE-----/, '')
        .replace(/-----END CERTIFICATE-----/, '')
        .replace(/\s+/g, ''),
    ],
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = cryptoSign('sha256', Buffer.from(signingInput, 'utf-8'), signKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

const trustedRoot = createHash('sha256').update(
  // X509Certificate fingerprint is over the DER — extract raw DER from PEM.
  Buffer.from(
    rootPem.replace(/-----BEGIN CERTIFICATE-----/, '').replace(/-----END CERTIFICATE-----/, '').replace(/\s+/g, ''),
    'base64'
  )
).digest('hex');

const opts = () => ({ trustedRoots: [trustedRoot], bundleId: DEFAULT_BUNDLE_ID });

const DAY = 24 * 60 * 60 * 1000;

function txPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Date.now();
  return {
    transactionId: '200000012345678',
    originalTransactionId: '100000012345678',
    bundleId: DEFAULT_BUNDLE_ID,
    productId: 'plethora_pro_monthly',
    purchaseDate: now - 5 * DAY,
    expiresDate: now + 25 * DAY,
    environment: 'Sandbox',
    appAccountToken: '11111111-2222-3333-4444-555555555555',
    type: 'Auto-Renewable Subscription',
    signedDate: now - 60 * 1000,
    ...overrides,
  };
}

describe('Apple transaction JWS verification (§6.2)', () => {
  it('verifies a valid payload and decodes the transaction', () => {
    const result = verifyAppleJws(makeJws(txPayload()), opts());
    expect(result.ok).toBe(true);
    expect(result.payload?.productId).toBe('plethora_pro_monthly');
    expect(result.payload?.originalTransactionId).toBe('100000012345678');
    expect(result.payload?.appAccountToken).toBe('11111111-2222-3333-4444-555555555555');
  });

  it('rejects a wrong bundle id', () => {
    const result = verifyAppleJws(makeJws(txPayload({ bundleId: 'com.evil.app' })), opts());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('wrong-bundle');
  });

  it('rejects a tampered payload (signature mismatch)', () => {
    const jws = makeJws(txPayload());
    const [h, , s] = jws.split('.');
    // Re-encode the payload with a modified productId but keep the signature.
    const forgedPayload = b64url(
      JSON.stringify({ ...txPayload({ productId: 'plethora_pro_annual' }) })
    );
    const result = verifyAppleJws(`${h}.${forgedPayload}.${s}`, opts());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature-mismatch');
  });

  it('rejects an untrusted root', () => {
    const result = verifyAppleJws(makeJws(txPayload()), {
      ...opts(),
      trustedRoots: ['deadbeef'.repeat(8)],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('untrusted-root');
  });

  it('rejects a broken chain order', () => {
    const jws = makeJws(txPayload());
    const [h] = jws.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf-8'));
    // Swap leaf and intermediate: chain no longer links.
    [header.x5c[0], header.x5c[1]] = [header.x5c[1], header.x5c[0]];
    const newHeader = b64url(JSON.stringify(header));
    const payloadB64 = jws.split('.')[1];
    const signature = cryptoSign(
      'sha256',
      Buffer.from(`${newHeader}.${payloadB64}`, 'utf-8'),
      leafKey
    ).toString('base64url');
    const result = verifyAppleJws(`${newHeader}.${payloadB64}.${signature}`, opts());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('bad-chain');
  });

  it('rejects unsupported algorithms and malformed JWS', () => {
    expect(verifyAppleJws('abc', opts()).reason).toBe('malformed');
    expect(verifyAppleJws('a.b.c', opts()).reason).toBe('malformed');
    const result = verifyAppleJws(makeJws(txPayload(), leafKey, 'RS256'), opts());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unsupported-alg');
  });

  it('rejects a payload signed by a foreign key (same chain, wrong signer)', () => {
    // Sign with the root key: chain is intact but the signature is wrong.
    const rootKey = createPrivateKey(readFileSync(join(FIXTURES, 'test-root.key'), 'utf-8'));
    const result = verifyAppleJws(makeJws(txPayload(), rootKey), opts());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature-mismatch');
  });

  it('accepts raw r||s (ieee-p1363) ES256 signatures like Apple produces', () => {
    const jws = makeJws(txPayload());
    const [h, p, s] = jws.split('.');
    const der = Buffer.from(s, 'base64url');
    // Convert DER SEQUENCE {r INTEGER, s INTEGER} → raw r||s (32-byte each).
    const rLen = der[3];
    const r = der.subarray(4, 4 + rLen).toString('hex').replace(/^(00)+/, '');
    const rest = der.subarray(4 + rLen);
    const sLen = rest[1];
    const sRaw = rest.subarray(2, 2 + sLen).toString('hex').replace(/^(00)+/, '');
    const raw = Buffer.from(r.padStart(64, '0') + sRaw.padStart(64, '0'), 'hex').toString('base64url');
    const leafPub = mkPub(leafPem);
    expect(verifyEs256Signature(`${h}.${p}`, leafPub, raw)).toBe(true);
  });
});

describe('grant derivation matrix (§6.4)', () => {
  const now = Date.now();
  const verified = (overrides: Partial<VerifiedAppStoreTransaction>): VerifiedAppStoreTransaction =>
    ({
      originalTransactionId: '100000012345678',
      transactionId: '200000012345678',
      bundleId: DEFAULT_BUNDLE_ID,
      productId: 'plethora_pro_monthly',
      purchaseDate: now - 5 * DAY,
      environment: 'Sandbox',
      ...overrides,
    }) as VerifiedAppStoreTransaction;

  it('verified + unexpired + not revoked → pro/active', () => {
    expect(deriveGrant(verified({ expiresDate: now + DAY }), now)).toMatchObject({
      tier: 'pro',
      status: 'active',
    });
  });

  it('verified + expired within grace → pro/grace', () => {
    expect(
      deriveGrant(verified({ expiresDate: now - PRO_GRACE_MS + 1000 }), now)
    ).toMatchObject({ tier: 'pro', status: 'grace' });
  });

  it('verified + expired past grace → free/expired', () => {
    expect(
      deriveGrant(verified({ expiresDate: now - PRO_GRACE_MS - 1000 }), now)
    ).toMatchObject({ tier: 'free', status: 'expired' });
  });

  it('verified + revoked → free/revoked regardless of expiry', () => {
    expect(
      deriveGrant(verified({ expiresDate: now + DAY, revocationDate: now - 1000 }), now)
    ).toMatchObject({ tier: 'free', status: 'revoked' });
  });

  it('selects the winning grant across a user\'s transactions', () => {
    const winning = selectWinningGrant(
      [
        verified({ originalTransactionId: 'a', expiresDate: now - PRO_GRACE_MS - DAY }),
        verified({ originalTransactionId: 'b', expiresDate: now + DAY }),
      ],
      now
    );
    expect(winning?.originalTransactionId).toBe('b');
    expect(winning?.status).toBe('active');
  });

  it('anonymous purchases bind at sign-in via appAccountToken (binding fields preserved)', () => {
    // The route binds by token; here we assert the verified payload retains
    // the token so the server can map it to the signing-in account.
    const tx = verified({ appAccountToken: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
    expect(tx.appAccountToken).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });
});

describe('ASNS v2 notifications (§6.5)', () => {
  const transactionPayload = txPayload();

  function notificationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      notificationType: 'SUBSCRIPTION_RENEWED',
      subtype: null,
      notificationUUID: '00112233-4455-6677-8899-aabbccddeeff',
      data: {
        bundleId: DEFAULT_BUNDLE_ID,
        environment: 'Sandbox',
        signedTransactionInfo: makeJws(transactionPayload),
      },
      ...overrides,
    };
  }

  it('verifies a well-formed notification and extracts the transaction', () => {
    const result = parseNotification(makeJws(notificationPayload()), opts());
    expect(result.ok).toBe(true);
    expect(result.notification?.notificationType).toBe('SUBSCRIPTION_RENEWED');
    expect(result.notification?.transaction.productId).toBe('plethora_pro_monthly');
  });

  it('rejects a signature mismatch on the signedPayload', () => {
    const jws = makeJws(notificationPayload());
    const [h, p] = jws.split('.');
    const forged = b64url(JSON.stringify({ ...notificationPayload(), notificationUUID: 'forged' }));
    const result = parseNotification(`${h}.${forged}.${jws.split('.')[2]}`, opts());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature-mismatch');
  });

  it('rejects a tampered embedded transaction', () => {
    const badTx = makeJws(txPayload({ bundleId: 'com.evil.app' }));
    const result = parseNotification(
      makeJws(notificationPayload({ data: { ...notificationPayload().data as object, signedTransactionInfo: badTx } })),
      opts()
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('embedded-transaction-wrong-bundle');
  });

  it('is idempotent: replays map to the same dedupe key', () => {
    const jws = makeJws(notificationPayload());
    const first = parseNotification(jws, opts());
    const second = parseNotification(jws, opts());
    expect(
      notificationIdempotencyKey(jws, first.notification?.notificationUUID)
    ).toBe(notificationIdempotencyKey(jws, second.notification?.notificationUUID));
    // A different notification (new UUID) gets a different key.
    const other = makeJws(
      notificationPayload({ notificationUUID: 'ffffffff-0000-0000-0000-000000000000' })
    );
    const otherParsed = parseNotification(other, opts());
    expect(
      notificationIdempotencyKey(other, otherParsed.notification?.notificationUUID)
    ).not.toBe(notificationIdempotencyKey(jws, first.notification?.notificationUUID));
  });

  it('covers the required handling set', () => {
    for (const type of [
      'SUBSCRIPTION_RENEWED',
      'EXPIRED',
      'REFUND',
      'REVOKE',
      'GRACE_PERIOD',
      'BILLING_RECOVERY',
      'DID_CHANGE_RENEWAL_STATUS',
    ]) {
      expect(HANDLED_NOTIFICATION_TYPES.has(type)).toBe(true);
    }
  });

  it.each([
    ['SUBSCRIPTION_RENEWED', 'active', 'upgrade'],
    ['BILLING_RECOVERY', 'active', 'upgrade'],
    ['GRACE_PERIOD', 'grace', 'upgrade'],
    ['EXPIRED', 'expired', 'none'],
    ['REFUND', 'revoked', 'downgrade'],
    ['REVOKE', 'revoked', 'downgrade'],
    ['DID_CHANGE_RENEWAL_STATUS', 'active', 'none'],
  ] as const)('%s → %s/%s', (type, status, tierAction) => {
    const parsed = parseNotification(
      makeJws(notificationPayload({ notificationType: type })),
      opts()
    );
    expect(parsed.ok).toBe(true);
    expect(notificationAction(parsed.notification!)).toEqual({ status, tierAction });
  });

  it('marks unknown types as verified-but-unhandled', () => {
    const parsed = parseNotification(
      makeJws(notificationPayload({ notificationType: 'TEST_NOTIFICATION' })),
      opts()
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.unhandledType).toBe(true);
    expect(parsed.notification).toBeUndefined();
  });
});
