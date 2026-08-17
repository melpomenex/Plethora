import type { PlanId } from '../types/entitlements';

/**
 * Product configuration & environment constants for Plethora.
 */

export const PRODUCT_NAME = 'Plethora';
export const PRODUCT_TAGLINE = 'Read anything. Learn everything.';
export const PRODUCT_PROVISIONAL_DOMAIN = 'plethora.app';

/**
 * Primary commercial API base URL.
 * Checks VITE_PLETHORA_API_URL, then legacy VITE_API_URL, defaulting to placeholder https://api.plethora.app.
 */
export const PLETHORA_API_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PLETHORA_API_URL) ||
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ||
  'https://api.plethora.app';

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
