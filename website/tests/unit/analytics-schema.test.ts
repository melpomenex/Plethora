import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { WebsiteAnalyticsEvent } from '../../src/config/analytics.ts';

export const CONTRACT_EVENT_NAMES = [
  'cta_get_plethora',
  'cta_all_downloads',
  'download_platform_select',
  'download_click',
  'pricing_interval_select',
  'pricing_plan_cta',
  'showcase_impression',
  'showcase_chapter',
  'showcase_takeover',
  'showcase_action',
  'showcase_layout_switch',
  'showcase_complete',
  'showcase_restart',
  'showcase_exit',
  'showcase_asset_failure',
  'docs_view',
  'checkout_start',
  'checkout_complete',
] as const;

const FORBIDDEN_PAYLOAD_KEYS = new Set(['text', 'html', 'body', 'innerHTML', 'document', 'email']);

export function assertSafeAnalyticsPayload(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    assert.equal(
      FORBIDDEN_PAYLOAD_KEYS.has(key),
      false,
      `analytics payload must not include field "${key}"`,
    );
  }
}

describe('analytics event contract', () => {
  it('lists the shared-contract event names', () => {
    const sample: WebsiteAnalyticsEvent[] = [
      { name: 'cta_all_downloads' },
      { name: 'cta_get_plethora', surface: 'header' },
      { name: 'download_platform_select', platform: 'macos' },
      { name: 'download_click', platform: 'windows', availability: 'disabled' },
      { name: 'pricing_interval_select', interval: 'month' },
      { name: 'pricing_plan_cta', plan: 'pro', enabled: false },
      { name: 'showcase_impression', sceneId: 'library.ready', layout: 'desktop', surface: 'homepage' },
      { name: 'showcase_chapter', chapterId: 'Read', sceneId: 'reader.open', layout: 'desktop' },
      { name: 'showcase_takeover', sceneId: 'review.question', layout: 'desktop' },
      { name: 'showcase_action', sceneId: 'review.question', actionId: 'reveal-answer', layout: 'desktop' },
      { name: 'showcase_layout_switch', sceneId: 'review.answer', fromLayout: 'desktop', toLayout: 'mobile' },
      { name: 'showcase_complete', sceneId: 'connections.context', layout: 'mobile' },
      { name: 'showcase_restart', layout: 'mobile' },
      { name: 'showcase_exit', sceneId: 'review.answer', layout: 'mobile' },
      { name: 'showcase_asset_failure', sceneId: 'reader.open', layout: 'desktop' },
      { name: 'docs_view', path: '/docs' },
      { name: 'checkout_start', plan: 'pro', interval: 'year' },
      { name: 'checkout_complete', plan: 'pro' },
    ];
    const names = new Set(sample.map((event) => event.name));
    for (const name of CONTRACT_EVENT_NAMES) {
      assert.equal(names.has(name), true, name);
    }
  });

  it('forbids text and html payload fields', () => {
    assertSafeAnalyticsPayload({ name: 'showcase_action', sceneId: 'reader.open', actionId: 'select-passage' });
    assert.throws(() => assertSafeAnalyticsPayload({ name: 'showcase_action', text: 'passage' }));
    assert.throws(() => assertSafeAnalyticsPayload({ name: 'showcase_action', html: '<p>' }));
  });
});
