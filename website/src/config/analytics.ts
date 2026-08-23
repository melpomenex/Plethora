import type { BillingInterval } from './plans.ts';
import type { DemoContentKind, DemoStage } from './demo-contract.ts';
import type { DownloadAvailability } from './downloads.ts';
import type { PlatformId } from './platforms.ts';
import { loadLaunchFlags } from './launch.ts';

export type WebsiteAnalyticsEvent =
  | { name: 'cta_get_plethora'; platform?: PlatformId; surface: string }
  | { name: 'cta_all_downloads' }
  | { name: 'download_platform_select'; platform: PlatformId }
  | { name: 'download_click'; platform: PlatformId; availability: DownloadAvailability['status'] }
  | { name: 'pricing_interval_select'; interval: BillingInterval }
  | { name: 'pricing_plan_cta'; plan: 'free' | 'pro'; enabled: boolean }
  | { name: 'demo_start'; kind: DemoContentKind }
  | { name: 'demo_stage'; stage: DemoStage; kind: DemoContentKind }
  | { name: 'demo_complete'; kind: DemoContentKind }
  | { name: 'demo_restart' }
  | { name: 'docs_view'; path: string }
  | { name: 'checkout_start'; plan: 'pro'; interval: BillingInterval }
  | { name: 'checkout_complete'; plan: 'pro' };

/** Local `astro dev` stays off unless PUBLIC_ANALYTICS_ENABLED=true. */
export function trackWebsiteEvent(_event: WebsiteAnalyticsEvent): void {
  const flags = loadLaunchFlags();
  if (!flags.analyticsEnabled) return;
}
