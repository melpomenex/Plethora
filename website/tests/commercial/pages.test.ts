import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LAUNCH_FLAGS } from '../../src/config/launch.ts';
import { LEGAL } from '../../src/config/legal.ts';
import { PLAN_TRIAL, PLANS, planCtaState } from '../../src/config/plans.ts';
import { DOWNLOADS, allDownloadControls } from '../../src/config/downloads.ts';
import { softwareApplicationJsonLd } from '../../src/lib/software-application-jsonld.ts';
import { legalDraftMessage, unpublishedContactMessage } from '../../src/lib/legal-copy.ts';
import { parseChangelog } from '../../src/lib/changelog.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function readPage(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

describe('pricing CTAs', () => {
  it('renders a disabled checkout control when flags are off', () => {
    const pro = PLANS.find((plan) => plan.id === 'pro')!;
    const cta = planCtaState(pro, DEFAULT_LAUNCH_FLAGS);
    assert.equal(cta.enabled, false);
    assert.equal(cta.href, undefined);
    assert.equal(cta.label, 'Available at launch');
    const source = readPage('src/pages/pricing.astro');
    assert.match(source, /data-checkout-disabled="true"/);
    assert.equal(pro.cta.label, 'Available at launch');
    assert.equal(PLAN_TRIAL.enabled, false);
    assert.doesNotMatch(source, /\$9\.99/);
    assert.doesNotMatch(source, /\$79\.99/);
  });
});

describe('downloads coming soon', () => {
  it('keeps every platform visible without live or store hrefs', () => {
    const controls = allDownloadControls();
    assert.equal(controls.length, 5);
    for (const control of controls) {
      assert.equal(control.liveHref, null);
      assert.ok(
        control.availability.status === 'coming-soon' || control.availability.status === 'disabled',
      );
    }
    const source = readPage('src/pages/downloads.astro');
    assert.match(source, /data-download-disabled/);
    assert.match(source, /coming-soon/);
    assert.doesNotMatch(source, /apps\.apple\.com/);
    assert.doesNotMatch(source, /play\.google\.com/);
  });

  it('does not advertise App Store or Play as live in download messages', () => {
    assert.match(DOWNLOADS.platforms.ios.message, /not listed/i);
    assert.match(DOWNLOADS.platforms.android.message, /not published/i);
  });
});

describe('Anki page honesty', () => {
  it('does not contain AnkiConnect', () => {
    const source = readPage('src/pages/anki.astro') + readPage('src/content/pages/anki.md');
    assert.doesNotMatch(source, /AnkiConnect/);
    assert.match(source, /\.apkg/);
    assert.match(source, /does not claim live two-way Anki protocol/);
  });
});

describe('draft legal banners', () => {
  it('shows draft copy when placeholders are null', () => {
    assert.equal(LEGAL.legalEntityName, null);
    assert.equal(LEGAL.supportEmail, null);
    const banner = legalDraftMessage();
    assert.match(banner, /draft/);
    assert.match(banner, /not offered as a contract/);
    for (const page of ['privacy', 'security', 'terms', 'refunds']) {
      const source = readPage(`src/pages/${page}.astro`);
      assert.match(source, /DraftBanner/);
    }
    assert.equal(unpublishedContactMessage(), 'Contact is not published yet.');
    assert.match(readPage('src/pages/support.astro'), /unpublishedContactMessage/);
    assert.match(readPage('src/pages/contact.astro'), /unpublishedContactMessage/);
  });
});

describe('JSON-LD', () => {
  it('uses PreOrder when checkout is disabled and only public desktop OS names', () => {
    const jsonLd = softwareApplicationJsonLd(DEFAULT_LAUNCH_FLAGS);
    assert.equal(jsonLd['@type'], 'SoftwareApplication');
    assert.equal(jsonLd.name, 'Plethora');
    assert.equal(jsonLd.operatingSystem, 'Windows, macOS, Linux');
    const offers = jsonLd.offers as { availability: string; price: string };
    assert.equal(offers.price, '5.99');
    assert.equal(offers.availability, 'https://schema.org/PreOrder');
    assert.ok(!String(jsonLd.operatingSystem).includes('iOS'));
  });
});

describe('changelog parser', () => {
  it('reads recent versions from CHANGELOG.md', () => {
    const markdown = readFileSync(join(root, '..', 'CHANGELOG.md'), 'utf8');
    const entries = parseChangelog(markdown, { minVersion: '2.5.0', limit: 3 });
    assert.ok(entries.length >= 1);
    assert.equal(entries[0].version, '2.7.0');
  });
});
