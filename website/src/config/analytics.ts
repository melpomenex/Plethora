import type { BillingInterval } from './plans.ts';
import type { DownloadAvailability } from './downloads.ts';
import type { PlatformId } from './platforms.ts';
import { loadLaunchFlags } from './launch.ts';

type ShowcaseLayoutId = 'desktop' | 'mobile';
type ShowcaseSurface = 'homepage' | 'demo-page';

export type WebsiteAnalyticsEvent =
  | { name: 'cta_get_plethora'; platform?: PlatformId; surface: string }
  | { name: 'cta_all_downloads' }
  | { name: 'download_platform_select'; platform: PlatformId }
  | { name: 'download_click'; platform: PlatformId; availability: DownloadAvailability['status'] }
  | { name: 'pricing_interval_select'; interval: BillingInterval }
  | { name: 'pricing_plan_cta'; plan: 'free' | 'pro'; enabled: boolean }
  | {
      name: 'showcase_impression';
      sceneId: string;
      layout: ShowcaseLayoutId;
      surface: ShowcaseSurface;
    }
  | {
      name: 'showcase_chapter';
      chapterId: string;
      sceneId: string;
      layout: ShowcaseLayoutId;
    }
  | { name: 'showcase_takeover'; sceneId: string; layout: ShowcaseLayoutId }
  | {
      name: 'showcase_action';
      sceneId: string;
      actionId: string;
      layout: ShowcaseLayoutId;
    }
  | {
      name: 'showcase_layout_switch';
      sceneId: string;
      fromLayout: ShowcaseLayoutId;
      toLayout: ShowcaseLayoutId;
    }
  | { name: 'showcase_complete'; sceneId: string; layout: ShowcaseLayoutId }
  | { name: 'showcase_restart'; layout: ShowcaseLayoutId }
  | { name: 'showcase_exit'; sceneId: string; layout: ShowcaseLayoutId }
  | { name: 'showcase_asset_failure'; sceneId: string; layout: ShowcaseLayoutId }
  | { name: 'docs_view'; path: string }
  | { name: 'checkout_start'; plan: 'pro'; interval: BillingInterval }
  | { name: 'checkout_complete'; plan: 'pro' };

/** Local `astro dev` stays off unless PUBLIC_ANALYTICS_ENABLED=true. */
export function trackWebsiteEvent(_event: WebsiteAnalyticsEvent): void {
  const flags = loadLaunchFlags();
  if (!flags.analyticsEnabled) return;
}
