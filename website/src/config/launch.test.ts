import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_LAUNCH_FLAGS, launchFlagsFromEnv } from './launch.ts';
import { LEGAL } from './legal.ts';
import { PLANS } from './plans.ts';
import { DOWNLOADS } from './downloads.ts';

describe('launch defaults', () => {
  it('keeps checkout, downloads, analytics, and storefront off with noindex', () => {
    assert.equal(DEFAULT_LAUNCH_FLAGS.indexing, 'noindex');
    assert.equal(DEFAULT_LAUNCH_FLAGS.downloadsEnabled, false);
    assert.equal(DEFAULT_LAUNCH_FLAGS.checkoutEnabled, false);
    assert.equal(DEFAULT_LAUNCH_FLAGS.analyticsEnabled, false);
    assert.equal(DEFAULT_LAUNCH_FLAGS.showcaseV2Enabled, true);
    assert.equal(DEFAULT_LAUNCH_FLAGS.commercialStorefrontReady, false);
  });

  it('treats a missing env object as commercially safe defaults', () => {
    const flags = launchFlagsFromEnv({});
    assert.equal(flags.indexing, 'noindex');
    assert.equal(flags.downloadsEnabled, false);
    assert.equal(flags.checkoutEnabled, false);
    assert.equal(flags.analyticsEnabled, false);
    assert.equal(flags.showcaseV2Enabled, true);
    assert.equal(flags.commercialStorefrontReady, false);
  });

  it('keeps showcase v2 on with an explicit rollback flag', () => {
    assert.equal(launchFlagsFromEnv({ PUBLIC_SHOWCASE_V2_ENABLED: 'true' }).showcaseV2Enabled, true);
    assert.equal(launchFlagsFromEnv({ PUBLIC_SHOWCASE_V2_ENABLED: 'false' }).showcaseV2Enabled, false);
    assert.equal(launchFlagsFromEnv({ PUBLIC_SHOWCASE_V2_ENABLED: '0' }).showcaseV2Enabled, false);
  });

  it('does not enable indexing unless PUBLIC_INDEXING is exactly index', () => {
    assert.equal(launchFlagsFromEnv({ PUBLIC_INDEXING: 'INDEX' }).indexing, 'noindex');
    assert.equal(launchFlagsFromEnv({ PUBLIC_INDEXING: 'index' }).indexing, 'index');
  });
});

describe('commercial seed data', () => {
  it('keeps legal placeholders unset', () => {
    assert.equal(LEGAL.legalEntityName, null);
    assert.equal(LEGAL.dunsNumber, null);
    assert.equal(LEGAL.termsFinal, false);
    assert.equal(LEGAL.privacyFinal, false);
    assert.equal(LEGAL.refundPolicyFinal, false);
  });

  it('seeds founder display prices without live checkout hrefs', () => {
    const pro = PLANS.find((plan) => plan.id === 'pro');
    assert.ok(pro);
    assert.equal(pro.cta.mode, 'disabled');
    assert.equal(pro.cta.href, undefined);
    assert.equal(pro.intervalPrices?.month?.amount, '5.99');
    assert.equal(pro.intervalPrices?.year?.amount, '49.99');
    assert.equal(pro.intervalPrices?.month?.storefrontLocalized, true);
    assert.notEqual(pro.intervalPrices?.month?.amount, '9.99');
    assert.notEqual(pro.intervalPrices?.year?.amount, '79.99');
  });

  it('does not publish live or store download URLs', () => {
    for (const availability of Object.values(DOWNLOADS.platforms)) {
      assert.notEqual(availability.status, 'live');
      assert.notEqual(availability.status, 'store');
    }
  });
});
