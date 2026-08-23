import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIMS } from '../../src/config/claims.ts';
import { LEGAL, legalIsDraft } from '../../src/config/legal.ts';
import { LAUNCH_BLOCKERS, hasBlockingLaunchIssues } from '../../src/config/launch.ts';
import { MARKETING_ASSETS } from '../../src/config/assets.ts';

export function canIndexProduction(options: {
  indexing: 'index' | 'noindex';
  privacyFinal: boolean;
  termsFinal: boolean;
  legalEntityName: string | null;
  placeholderAssets: boolean;
  hasBlockBlockers: boolean;
}): boolean {
  if (options.indexing !== 'index') return true;
  if (!options.privacyFinal || !options.termsFinal || options.legalEntityName === null) return false;
  if (options.placeholderAssets) return false;
  if (options.hasBlockBlockers) return false;
  return true;
}

describe('indexed production launch gate', () => {
  it('fails when indexing is on and privacy is not final', () => {
    assert.equal(
      canIndexProduction({
        indexing: 'index',
        privacyFinal: false,
        termsFinal: true,
        legalEntityName: 'Example',
        placeholderAssets: false,
        hasBlockBlockers: false,
      }),
      false,
    );
  });

  it('does not fail placeholder screenshots while indexing is noindex', () => {
    assert.equal(
      canIndexProduction({
        indexing: 'noindex',
        privacyFinal: false,
        termsFinal: false,
        legalEntityName: null,
        placeholderAssets: true,
        hasBlockBlockers: true,
      }),
      true,
    );
  });

  it('current committed config is not indexable', () => {
    assert.equal(legalIsDraft(LEGAL), true);
    assert.equal(hasBlockingLaunchIssues(), true);
    assert.equal(
      canIndexProduction({
        indexing: 'index',
        privacyFinal: LEGAL.privacyFinal,
        termsFinal: LEGAL.termsFinal,
        legalEntityName: LEGAL.legalEntityName,
        placeholderAssets: MARKETING_ASSETS.assets.some((asset) => asset.placeholder),
        hasBlockBlockers: LAUNCH_BLOCKERS.some((blocker) => blocker.severity === 'block'),
      }),
      false,
    );
  });

  it('private claims stay non-public', () => {
    const secret = CLAIMS.filter((claim) => !claim.public);
    assert.ok(secret.some((claim) => claim.id === 'cross-device-e2ee-sync'));
    assert.ok(secret.some((claim) => claim.id === 'ankiconnect-live-sync'));
  });
});
