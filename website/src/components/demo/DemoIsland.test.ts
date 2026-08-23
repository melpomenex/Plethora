import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import active from '../../config/showcase-v2-active.json' with { type: 'json' };
import catalog from '../../config/showcase-scenes-v2.json' with { type: 'json' };
import manifest from '../../../public/images/showcase/v2/2.0.0-2.7.0+9a6e7dc075b2/asset-manifest-v2.json' with { type: 'json' };
import { analyticsForShowcaseTransition } from './analytics.ts';
import { createShowcaseState, transitionShowcase } from './machine.ts';
import { SHOWCASE, parseShowcaseData } from './showcase.ts';

describe('approved showcase contract', () => {
  it('contains both layouts for every guided scene', () => {
    assert.equal(SHOWCASE.guidedPath.length, 8);
    assert.equal(SHOWCASE.assets.length, 16);
    for (const sceneId of SHOWCASE.guidedPath) {
      assert.ok(SHOWCASE.assets.some((asset) => asset.sceneId === sceneId && asset.layout === 'desktop'));
      assert.ok(SHOWCASE.assets.some((asset) => asset.sceneId === sceneId && asset.layout === 'mobile'));
    }
  });

  it('keeps every hotspot normalized and tied to a real catalog action', () => {
    for (const asset of SHOWCASE.assets) {
      const scene = SHOWCASE.scenes.find((candidate) => candidate.id === asset.sceneId)!;
      for (const hotspot of asset.hotspots) {
        assert.ok(hotspot.rect.x + hotspot.rect.width <= 1.001);
        assert.ok(hotspot.rect.y + hotspot.rect.height <= 1.001);
        const action = scene.actions.find((candidate) => candidate.id === hotspot.id);
        assert.equal(action?.label, hotspot.actionLabel);
        assert.equal(action?.nextSceneId, hotspot.nextSceneId);
      }
    }
  });

  it('rejects an unapproved active policy', () => {
    const unapproved = { ...active, approved: false };
    assert.throws(
      () => parseShowcaseData(catalog, manifest, unapproved),
      /not approved for production use/,
    );
  });

  it('emits content-free stable analytics identifiers', () => {
    const previous = createShowcaseState({ mode: 'guided' });
    const next = transitionShowcase(previous, { type: 'action', actionId: 'open-featured' });
    assert.deepEqual(
      analyticsForShowcaseTransition(previous, next, {
        type: 'action',
        actionId: 'open-featured',
      }),
      [
        {
          name: 'showcase_action',
          sceneId: 'library.ready',
          actionId: 'open-featured',
          layout: 'desktop',
        },
      ],
    );
  });
});
