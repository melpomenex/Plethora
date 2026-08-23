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
  'demo_start',
  'demo_stage',
  'demo_complete',
  'demo_restart',
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
      { name: 'demo_start', kind: 'article' },
      { name: 'demo_stage', stage: 'library', kind: 'article' },
      { name: 'demo_complete', kind: 'article' },
      { name: 'demo_restart' },
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
    assertSafeAnalyticsPayload({ name: 'demo_stage', stage: 'reader', kind: 'article' });
    assert.throws(() => assertSafeAnalyticsPayload({ name: 'demo_stage', text: 'passage' }));
    assert.throws(() => assertSafeAnalyticsPayload({ name: 'demo_stage', html: '<p>' }));
  });
});
