import { ENTITLEMENT_IDS } from './entitlementIds.ts';
import type { CtaMode } from './launch.ts';
import type { LaunchFlags } from './launch.ts';

export type BillingInterval = 'month' | 'year';

export interface DisplayPrice {
  amount: string;
  currency: 'USD';
  /** When true, show “localized in stores” footnote instead of claiming this is the store price. */
  storefrontLocalized: boolean;
}

export type PlanFeatureId = string;

export interface PlanDefinition {
  id: 'free' | 'pro';
  name: string;
  intervalPrices?: Partial<Record<BillingInterval, DisplayPrice>>;
  cta: {
    mode: CtaMode;
    href?: string;
    label: string;
  };
  features: PlanFeatureId[];
}

/** Local-floor features everyone has today. Ids MUST exist in the claim matrix. */
export const FREE_PLAN_FEATURE_IDS: PlanFeatureId[] = [
  'local-first-library',
  'local-reading-formats',
  'saved-position',
  'incremental-reading',
  'local-extracts',
  'local-flashcards',
  'srs-fsrs',
  'image-occlusion',
  'eink',
  'local-tts',
  'dictionary-peek',
  'byo-ai',
  'local-backups-export',
  'anki-apkg',
  'desktop-win-mac-linux',
];

/** Hidden unless a founder enables a trial in this file. */
export const PLAN_TRIAL = {
  enabled: false,
  days: 0,
};

export const PLAN_PACKAGING_NOTE =
  'Plethora Pro is intended packaging for hosted intelligence, cloud compute, and sync. Those capabilities are not sold yet, and the current app is not described as paywalled.';

export const PLANS: PlanDefinition[] = [
  {
    id: 'free',
    name: 'Free',
    cta: {
      mode: 'disabled',
      label: 'Coming soon',
    },
    features: [...FREE_PLAN_FEATURE_IDS],
  },
  {
    id: 'pro',
    name: 'Plethora Pro',
    intervalPrices: {
      month: { amount: '5.99', currency: 'USD', storefrontLocalized: true },
      year: { amount: '49.99', currency: 'USD', storefrontLocalized: true },
    },
    cta: {
      mode: 'disabled',
      label: 'Available at launch',
    },
    features: [...FREE_PLAN_FEATURE_IDS, ...ENTITLEMENT_IDS],
  },
];

export interface PlanCtaState {
  planId: 'free' | 'pro';
  label: string;
  enabled: boolean;
  href?: string;
}

export function planCtaState(
  plan: PlanDefinition,
  flags: Pick<LaunchFlags, 'checkoutEnabled'>,
): PlanCtaState {
  const checkoutOn = flags.checkoutEnabled && plan.cta.mode === 'enabled' && Boolean(plan.cta.href);
  if (!checkoutOn) {
    return {
      planId: plan.id,
      label: plan.cta.label,
      enabled: false,
    };
  }
  return {
    planId: plan.id,
    label: plan.cta.label,
    enabled: true,
    href: plan.cta.href,
  };
}
