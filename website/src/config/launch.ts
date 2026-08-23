import type { PlatformId } from './platforms.ts';

export type IndexingMode = 'index' | 'noindex';
export type CtaMode = 'enabled' | 'disabled' | 'waitlist' | 'notify';

export interface LaunchFlags {
  indexing: IndexingMode;
  downloadsEnabled: boolean;
  checkoutEnabled: boolean;
  analyticsEnabled: boolean;
  demoEnabled: boolean;
  /** When true, public pages still render but store/download buttons are inert with an explanation. */
  commercialStorefrontReady: boolean;
}

export const DEFAULT_LAUNCH_FLAGS: LaunchFlags = {
  indexing: 'noindex',
  downloadsEnabled: false,
  checkoutEnabled: false,
  analyticsEnabled: false,
  demoEnabled: true,
  commercialStorefrontReady: false,
};

export function parseIndexing(value: string | undefined): IndexingMode {
  return value === 'index' ? 'index' : 'noindex';
}

export function parseBoolFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
}

export type LaunchEnv = Partial<Record<string, string | boolean | undefined>>;

export function launchFlagsFromEnv(env: LaunchEnv = {}): LaunchFlags {
  const safe = env ?? {};
  const read = (key: string): string | undefined => {
    const value = safe[key];
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'string') return value;
    return undefined;
  };

  return {
    indexing: parseIndexing(read('PUBLIC_INDEXING')),
    downloadsEnabled: parseBoolFlag(read('PUBLIC_DOWNLOADS_ENABLED'), false),
    checkoutEnabled: parseBoolFlag(read('PUBLIC_CHECKOUT_ENABLED'), false),
    analyticsEnabled: parseBoolFlag(read('PUBLIC_ANALYTICS_ENABLED'), false),
    demoEnabled: parseBoolFlag(read('PUBLIC_DEMO_ENABLED'), true),
    commercialStorefrontReady: parseBoolFlag(read('PUBLIC_COMMERCIAL_STOREFRONT_READY'), false),
  };
}

export function loadLaunchFlags(): LaunchFlags {
  const env = (import.meta.env ?? {}) as LaunchEnv;
  return launchFlagsFromEnv(env);
}

export const CANONICAL_ORIGIN = 'https://useplethora.com';

export function siteOrigin(env: LaunchEnv = import.meta.env as LaunchEnv): string {
  const fromEnv = env.PUBLIC_SITE_ORIGIN;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return fromEnv.replace(/\/$/, '');
  }
  return CANONICAL_ORIGIN;
}

export function canonicalUrl(pathname: string, env: LaunchEnv = import.meta.env as LaunchEnv): string {
  const withSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const normalized = withSlash === '/' ? '/' : withSlash.replace(/\/$/, '');
  return `${siteOrigin(env)}${normalized}`;
}

export type LaunchBlockerSeverity = 'block' | 'warn';

export interface LaunchBlocker {
  id: string;
  summary: string;
  severity: LaunchBlockerSeverity;
}

/** Known website launch blockers. F fails CI if production indexing is on while any `block` remains. */
export const LAUNCH_BLOCKERS: LaunchBlocker[] = [
  {
    id: 'legal-entity',
    summary: 'Legal entity name, jurisdiction, terms, privacy, and refunds are unset.',
    severity: 'block',
  },
  {
    id: 'duns-apple-enrollment',
    summary: 'D-U-N-S / Apple org enrollment blocks iOS download links (never display D-U-N-S).',
    severity: 'block',
  },
  {
    id: 'store-products',
    summary: 'Store products and localized prices are not live.',
    severity: 'block',
  },
  {
    id: 'binaries-and-store-urls',
    summary: 'Desktop/mobile binaries and store URLs are not published.',
    severity: 'block',
  },
  {
    id: 'canonical-screenshots',
    summary: 'Canonical screenshot set from an RC build is not ready (theme decision F-31).',
    severity: 'block',
  },
  {
    id: 'verified-privacy-copy',
    summary: 'Encryption and privacy copy is not counsel-verified.',
    severity: 'block',
  },
  {
    id: 'ankiconnect-claim',
    summary: 'AnkiConnect live sync is not a public claim until re-verified against implementation status.',
    severity: 'block',
  },
  {
    id: 'support-contact',
    summary: 'Support email / contact path is unset.',
    severity: 'block',
  },
  {
    id: 'vercel-website-project',
    summary: 'Vercel project must be linked to the website directory, not the PWA root vercel.json.',
    severity: 'block',
  },
  {
    id: 'public-tagline',
    summary: 'Confirm public headline vs in-app PRODUCT_TAGLINE.',
    severity: 'warn',
  },
];

export function hasBlockingLaunchIssues(): boolean {
  return LAUNCH_BLOCKERS.some((blocker) => blocker.severity === 'block');
}

export type { PlatformId };
