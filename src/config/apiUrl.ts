/**
 * Plethora Cloud API URL contract.
 *
 * Production store/mobile releases MUST target https://api.useplethora.com.
 * Development and sideload builds may override via VITE_PLETHORA_API_URL.
 */

export const PLETHORA_PRODUCTION_API_URL = 'https://api.useplethora.com';

/** Obsolete placeholder domain — store builds must never ship with this. */
export const PLETHORA_LEGACY_API_URL = 'https://api.plethora.app';

export type ApiUrlResolution = {
  url: string;
  source: 'env' | 'production-default' | 'off';
};

/**
 * Resolve the API base URL from Vite env at build time.
 * When unset, production default is api.useplethora.com (not the legacy domain).
 */
export function resolvePlethoraApiUrl(env: {
  VITE_PLETHORA_API_URL?: string;
  VITE_API_URL?: string;
}): ApiUrlResolution {
  const raw =
    env.VITE_PLETHORA_API_URL?.trim() ||
    env.VITE_API_URL?.trim() ||
    PLETHORA_PRODUCTION_API_URL;

  if (raw === 'off') {
    return { url: 'off', source: 'off' };
  }

  const source = env.VITE_PLETHORA_API_URL || env.VITE_API_URL ? 'env' : 'production-default';
  return { url: raw, source };
}

/** Returns true when the URL is the obsolete provisional domain. */
export function isLegacyApiUrl(url: string): boolean {
  return url.replace(/\/$/, '') === PLETHORA_LEGACY_API_URL;
}

/** Store-profile builds must use the production API host. */
export function assertStoreProfileApiUrl(url: string, profile: string): void {
  if (profile !== 'store') return;
  if (url === 'off') {
    throw new Error('PLETHORA_BUILD_PROFILE=store: cloud API cannot be disabled (VITE_PLETHORA_API_URL=off)');
  }
  if (isLegacyApiUrl(url)) {
    throw new Error(
      `PLETHORA_BUILD_PROFILE=store: obsolete API URL ${PLETHORA_LEGACY_API_URL}. ` +
        `Set VITE_PLETHORA_API_URL=${PLETHORA_PRODUCTION_API_URL}`
    );
  }
  const normalized = url.replace(/\/$/, '');
  if (normalized !== PLETHORA_PRODUCTION_API_URL) {
    throw new Error(
      `PLETHORA_BUILD_PROFILE=store: expected ${PLETHORA_PRODUCTION_API_URL}, got ${url}`
    );
  }
}
