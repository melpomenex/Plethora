import type { PlanId } from '../types/entitlements';

/**
 * Product configuration & environment constants for Plethora.
 */

export const PRODUCT_NAME = 'Plethora';
export const PRODUCT_TAGLINE = 'Read anything. Learn everything.';
export const PRODUCT_PROVISIONAL_DOMAIN = 'plethora.app';

import { resolvePlethoraApiUrl } from './apiUrl';

/**
 * Primary commercial API base URL.
 * Set VITE_PLETHORA_API_URL=off to disable cloud API calls (local-first mode).
 * Defaults to https://api.useplethora.com when unset.
 */
const _apiResolution = resolvePlethoraApiUrl({
  VITE_PLETHORA_API_URL:
    typeof import.meta !== 'undefined' ? import.meta.env?.VITE_PLETHORA_API_URL : undefined,
  VITE_API_URL: typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_URL : undefined,
});

export const PLETHORA_API_URL: string =
  _apiResolution.url === 'off' ? 'off' : _apiResolution.url;

/** True when the app should call Plethora Cloud HTTP APIs. */
export const isCloudApiEnabled = (): boolean => PLETHORA_API_URL !== 'off';

/**
 * Master product switch controlling whether Plethora Cloud (hosted accounts,
 * paid tier, subscription/billing UX, cloud sync) is publicly exposed.
 *
 * COMMERCIAL BOUNDARY PRINCIPLES:
 * 1. Plethora Core: Free, local-first, and open source. No account is required
 *    to use the application. Local reading, learning, FSRS-7 review, on-device AI,
 *    BYO AI API keys, local TTS, local transcription, local knowledge graph,
 *    and local integrations are completely free and never locked behind an entitlement.
 * 2. Plethora Cloud: Planned optional hosted service primarily for encrypted
 *    synchronization across computers and mobile phones.
 * 3. Local execution != subscription feature. Only Plethora-operated remote
 *    infrastructure requires a Plethora account or subscription.
 *
 * For public open-source releases, `PLETHORA_CLOUD_PUBLICLY_AVAILABLE` is set to `false`.
 * Future activation requires setting this switch to `true` (or setting the environment
 * variable VITE_PLETHORA_CLOUD_AVAILABLE=true for test builds).
 */
export const PLETHORA_CLOUD_PUBLICLY_AVAILABLE: boolean =
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_PLETHORA_CLOUD_AVAILABLE === 'true'
    ? true
    : false;

export const isPlethoraCloudAvailable = (): boolean => PLETHORA_CLOUD_PUBLICLY_AVAILABLE;

/**
 * Custom URI scheme for native deep links (OAuth callbacks, purchase returns).
 */
export const PLETHORA_DEEP_LINK_SCHEME = 'plethora';
export const PLETHORA_AUTH_CALLBACK_URI = 'plethora://auth/callback';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  badgeLabel: string;
  description: string;
  isPro: boolean;
}

export const PLANS: Record<'free' | 'pro', PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Plethora Free',
    badgeLabel: 'Free',
    description: 'Local-first reader with full offline capabilities, BYO-key AI, and on-device models.',
    isPro: false,
  },
  pro: {
    id: 'pro',
    name: 'Plethora Pro',
    badgeLabel: 'Pro',
    description: 'Cloud sync, multi-device backups, hosted intelligence, premium TTS, and cloud transcription.',
    isPro: true,
  },
};
