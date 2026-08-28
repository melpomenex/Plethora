/**
 * Google Play subscription purchase verification via Android Publisher API.
 */

import { GoogleAuth } from 'google-auth-library';
import { AppError } from '../middleware/error.js';

export interface VerifiedPlayPurchase {
  provider: 'playstore';
  packageName: string;
  productId: string;
  purchaseToken: string;
  orderId: string;
  obfuscatedExternalAccountId?: string;
  expiryTimeMillis?: number;
  /** SUBSCRIPTION_STATE_ACTIVE | EXPIRED | CANCELED | etc. */
  subscriptionState: string;
  acknowledgementState?: string;
  environment: 'production' | 'sandbox';
}

const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

function getServiceAccountJson(): Record<string, unknown> | null {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new AppError(500, 'play_config_error', 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is invalid JSON');
  }
}

function getPackageName(): string {
  return process.env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || 'com.plethora.app';
}

async function getAccessToken(): Promise<string> {
  const credentials = getServiceAccountJson();
  if (!credentials) {
    throw new AppError(503, 'play_not_configured', 'Google Play service account is not configured');
  }
  const auth = new GoogleAuth({ credentials, scopes: [PLAY_SCOPE] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) {
    throw new AppError(503, 'play_auth_failed', 'Failed to obtain Google Play API access token');
  }
  return token.token;
}

export async function verifyPlaySubscription(
  purchaseToken: string,
  productId: string,
  packageName?: string
): Promise<VerifiedPlayPurchase> {
  const pkg = packageName?.trim() || getPackageName();
  const token = await getAccessToken();

  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(pkg)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new AppError(
      422,
      'verification_failed',
      `Google Play verification failed (${res.status})`
    );
  }

  const data = (await res.json()) as {
    subscriptionState?: string;
    latestOrderId?: string;
    lineItems?: Array<{
      productId?: string;
      expiryTime?: string;
      offerDetails?: { basePlanId?: string };
    }>;
    externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
    acknowledgementState?: string;
    testPurchase?: Record<string, unknown>;
  };

  const lineItem = data.lineItems?.find((l) => l.productId === productId) ?? data.lineItems?.[0];
  const resolvedProductId = lineItem?.productId ?? productId;
  const expiryTimeMillis = lineItem?.expiryTime ? Date.parse(lineItem.expiryTime) : undefined;
  const orderId = data.latestOrderId || purchaseToken.slice(0, 32);

  return {
    provider: 'playstore',
    packageName: pkg,
    productId: resolvedProductId,
    purchaseToken,
    orderId,
    obfuscatedExternalAccountId: data.externalAccountIdentifiers?.obfuscatedExternalAccountId,
    expiryTimeMillis,
    subscriptionState: data.subscriptionState || 'SUBSCRIPTION_STATE_UNSPECIFIED',
    acknowledgementState: data.acknowledgementState,
    environment: data.testPurchase ? 'sandbox' : 'production',
  };
}

export function isPlayConfigured(): boolean {
  return !!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
}
