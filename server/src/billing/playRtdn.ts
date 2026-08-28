/**
 * RTDN (Real-Time Developer Notifications) Pub/Sub push verification and parsing.
 */

import { OAuth2Client } from 'google-auth-library';
import { AppError } from '../middleware/error.js';

export interface PlayRtdnMessage {
  version?: string;
  packageName?: string;
  eventTimeMillis?: string;
  subscriptionNotification?: {
    version?: string;
    notificationType?: number;
    purchaseToken?: string;
    subscriptionId?: string;
  };
  oneTimeProductNotification?: {
    purchaseToken?: string;
    sku?: string;
    notificationType?: number;
  };
}

export interface PubSubPushBody {
  message?: {
    data?: string;
    messageId?: string;
    publishTime?: string;
  };
  subscription?: string;
}

const oauthClient = new OAuth2Client();

export async function verifyPubSubPushAuth(
  authHeader: string | undefined,
  audience: string
): Promise<void> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AppError(401, 'unauthorized', 'Missing Pub/Sub push authorization');
  }
  const token = authHeader.slice(7);
  try {
    await oauthClient.verifyIdToken({
      idToken: token,
      audience,
    });
  } catch {
    throw new AppError(401, 'unauthorized', 'Invalid Pub/Sub push token');
  }
}

export function parsePubSubPushBody(body: PubSubPushBody): PlayRtdnMessage {
  const data = body.message?.data;
  if (!data) {
    throw new AppError(400, 'invalid_pubsub', 'Pub/Sub message missing data');
  }
  const decoded = Buffer.from(data, 'base64').toString('utf8');
  return JSON.parse(decoded) as PlayRtdnMessage;
}

export function rtdnIdempotencyKey(body: PubSubPushBody, parsed: PlayRtdnMessage): string {
  const messageId = body.message?.messageId;
  if (messageId) return `play:${messageId}`;
  const token =
    parsed.subscriptionNotification?.purchaseToken ||
    parsed.oneTimeProductNotification?.purchaseToken ||
    'unknown';
  const type = parsed.subscriptionNotification?.notificationType ?? 0;
  return `play:${token}:${type}:${parsed.eventTimeMillis ?? Date.now()}`;
}
