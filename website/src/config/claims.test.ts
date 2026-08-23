import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertClaim,
  CLAIMS,
  getClaim,
  isPublicProductionClaim,
  publicClaimsFor,
} from './claims.ts';
import banned from './banned-phrases.json' with { type: 'json' };

describe('claim matrix', () => {
  it('marks design-gated claims as not public', () => {
    const hidden = [
      'cloud-sync-e2ee',
      'pro-gating-current',
      'anki-connect-live',
      'ios-app-store',
      'android-play',
      'web-checkout',
      'store-price-999',
      'zero-knowledge',
      'fake-user-counts',
    ];
    for (const id of hidden) {
      const claim = getClaim(id);
      assert.ok(claim, id);
      assert.equal(claim.public, false);
    }
  });

  it('exposes shipping local-floor claims for public copy', () => {
    const publicIds = CLAIMS.filter(isPublicProductionClaim).map((claim) => claim.id);
    for (const id of [
      'local-reading-formats',
      'incremental-reading',
      'srs-fsrs',
      'image-occlusion',
      'eink',
      'byo-ai',
      'anki-apkg',
      'desktop-win-mac-linux',
    ]) {
      assert.ok(publicIds.includes(id), id);
      assert.doesNotThrow(() => assertClaim(id));
    }
  });

  it('refuses assertClaim for Anki live sync and E2EE', () => {
    assert.throws(() => assertClaim('anki-connect-live'));
    assert.throws(() => assertClaim('cloud-sync-e2ee'));
    assert.throws(() => assertClaim('missing-claim-id'));
  });

  it('filters publicClaimsFor by surface', () => {
    const features = publicClaimsFor('features').map((claim) => claim.id);
    assert.ok(features.includes('anki-apkg'));
    assert.ok(!features.includes('anki-connect-live'));
  });

  it('lists banned phrases for quality-gate grep', () => {
    assert.equal(banned.exemptionAttribute, 'data-historical-quote');
    assert.ok(banned.phrases.includes('AnkiConnect sync'));
    assert.ok(banned.phrases.includes('$9.99'));
    assert.ok(banned.phrases.includes('Incrementum'));
    assert.ok(banned.phrases.includes('readsync.org'));
  });
});
