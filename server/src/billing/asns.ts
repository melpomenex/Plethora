/**
 * App Store Server Notifications v2 (ASNS v2) handling (openspec change
 * implement-native-ios-storekit2-billing §6.5).
 *
 * Apple POSTs a body of `{ signedPayload: <compact JWS> }`. The payload is a
 * responseBodyV2DecodedPayload:
 *   { notificationType, subtype, notificationUUID, data: {
 *       bundleId, environment, signedTransactionInfo, ... }, ... }
 *
 * Handling rules:
 *   - the signedPayload envelope is verified with the same Apple-chain JWS
 *     verifier as transactions (signature-mismatch → reject, never process);
 *   - the embedded signedTransactionInfo is verified as its own JWS;
 *   - idempotency: the notificationUUID (falling back to a SHA-256 of the raw
 *     payload) identifies a notification; replays are dropped;
 *   - only known notification types are acted on; unknown types are reported
 *     as unhandled so the route can record + acknowledge them (Apple stops
 *     retrying on 2xx).
 *
 * Pure module: parsing/decision only — persistence lives in the route.
 */

import { createHash } from 'node:crypto';
import {
  verifyEnvelope,
  verifyAppleJws,
  type VerifiedAppStoreTransaction,
  type VerifyAppleJwsOptions,
} from './jws.js';

/** Notification types this server acts on (design decision 3). */
export const HANDLED_NOTIFICATION_TYPES = new Set([
  'SUBSCRIPTION_RENEWED',
  'EXPIRED',
  'REFUND',
  'REVOKE',
  'GRACE_PERIOD',
  'BILLING_RECOVERY',
  'DID_CHANGE_RENEWAL_STATUS',
]);

export type NotificationSubtype =
  | null
  | 'INITIAL_BUY'
  | 'RESUBSCRIBE'
  | 'DOWNGRADE'
  | 'UPGRADE'
  | 'AUTO_RENEW_ENABLED'
  | 'AUTO_RENEW_DISABLED'
  | 'VOLUNTARY'
  | 'BILLING_RETRY'
  | 'BILLING_RECOVERY'
  | 'PRODUCT_NOT_FOR_SALE';

export interface ParsedNotification {
  notificationType: string;
  subtype: NotificationSubtype;
  notificationUUID: string;
  bundleId: string;
  environment: string;
  /** Verified transaction embedded in data.signedTransactionInfo. */
  transaction: VerifiedAppStoreTransaction;
}

export interface ParseNotificationResult {
  ok: boolean;
  /** Rejection reason (JWS-level or structural) — must never be processed. */
  reason?: string;
  /** True when verified but the type is outside our handling set. */
  unhandledType?: boolean;
  notification?: ParsedNotification;
}

/**
 * Verify + decode an ASNS v2 signedPayload. The embedded
 * signedTransactionInfo is verified with the same options.
 */
export function parseNotification(
  signedPayload: string,
  options: VerifyAppleJwsOptions = {}
): ParseNotificationResult {
  const envelope = verifyEnvelope(signedPayload, {
    trustedRoots: options.trustedRoots,
    now: options.now,
  });
  if (!envelope.ok || !envelope.payload) {
    return { ok: false, reason: envelope.reason ?? 'verification_failed' };
  }
  const decoded = envelope.payload;

  const notificationUUID =
    typeof decoded.notificationUUID === 'string' ? decoded.notificationUUID : '';
  if (!notificationUUID) {
    return { ok: false, reason: 'missing-notification-uuid' };
  }

  const notificationType =
    typeof decoded.notificationType === 'string' ? decoded.notificationType : '';
  if (!HANDLED_NOTIFICATION_TYPES.has(notificationType)) {
    return { ok: true, unhandledType: true };
  }

  const data = (decoded.data ?? {}) as Record<string, unknown>;
  const signedTransactionInfo = data.signedTransactionInfo;
  if (typeof signedTransactionInfo !== 'string') {
    return { ok: false, reason: 'missing-signed-transaction-info' };
  }
  const tx = verifyAppleJws(signedTransactionInfo, options);
  if (!tx.ok || !tx.payload) {
    return { ok: false, reason: `embedded-transaction-${tx.reason}` };
  }

  return {
    ok: true,
    notification: {
      notificationType,
      subtype: (typeof decoded.subtype === 'string' ? decoded.subtype : null) as NotificationSubtype,
      notificationUUID,
      bundleId: typeof data.bundleId === 'string' ? data.bundleId : '',
      environment:
        typeof data.environment === 'string' ? data.environment : tx.payload.environment,
      transaction: tx.payload,
    },
  };
}

/** Idempotency key for a notification (stable across replays). */
export function notificationIdempotencyKey(
  rawSignedPayload: string,
  notificationUUID?: string
): string {
  if (notificationUUID) return `asns:${notificationUUID}`;
  return `asns:sha256:${createHash('sha256').update(rawSignedPayload).digest('hex')}`;
}

/**
 * Map a verified notification to a store_transactions status + tier action.
 * Pure decision table over the §6.5 handling set.
 */
export function notificationAction(notification: ParsedNotification): {
  status: 'active' | 'grace' | 'expired' | 'revoked';
  tierAction: 'upgrade' | 'downgrade' | 'none';
} {
  switch (notification.notificationType) {
    case 'SUBSCRIPTION_RENEWED':
    case 'BILLING_RECOVERY':
      return { status: 'active', tierAction: 'upgrade' };
    case 'GRACE_PERIOD':
      // Visible billing-issue state keeps Pro while in grace (design §5).
      return { status: 'grace', tierAction: 'upgrade' };
    case 'EXPIRED':
      return { status: 'expired', tierAction: 'none' };
    case 'REFUND':
    case 'REVOKE':
      return { status: 'revoked', tierAction: 'downgrade' };
    case 'DID_CHANGE_RENEWAL_STATUS':
      // Renewal-intent changes don't move entitlement by themselves.
      return { status: 'active', tierAction: 'none' };
    default:
      return { status: 'active', tierAction: 'none' };
  }
}
