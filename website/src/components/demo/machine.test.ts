import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SHOWCASE,
  getShowcaseAsset,
  getShowcaseScene,
} from './showcase.ts';
import {
  canonicalShowcaseSearch,
  clampShowcaseState,
  createShowcaseState,
  guidedProgress,
  parseShowcaseSearch,
  resolveSceneForLayout,
  transitionShowcase,
} from './machine.ts';

describe('showcase machine', () => {
  it('completes every declared guided transition', () => {
    let state = createShowcaseState({ mode: 'guided' });
    for (let index = 0; index < SHOWCASE.guidedPath.length - 1; index += 1) {
      const from = SHOWCASE.guidedPath[index]!;
      const to = SHOWCASE.guidedPath[index + 1]!;
      assert.equal(state.sceneId, from);
      const action = getShowcaseScene(from)?.actions.find((candidate) => candidate.recommended);
      assert.ok(action);
      state = transitionShowcase(state, { type: 'action', actionId: action.id });
      assert.equal(state.sceneId, to);
    }
    assert.equal(state.completion, true);
    assert.deepEqual(guidedProgress(state), { current: 8, total: 8 });
  });

  it('keeps unmapped and illegal actions inert', () => {
    const state = createShowcaseState({ mode: 'guided' });
    assert.deepEqual(transitionShowcase(state, { type: 'action', actionId: 'unknown' }), state);
    const narrative = createShowcaseState({ mode: 'narrative' });
    assert.deepEqual(
      transitionShowcase(narrative, { type: 'action', actionId: 'open-featured' }),
      narrative,
    );
  });

  it('explains the intentionally omitted explanation destination', () => {
    const selected = createShowcaseState({
      search: '?scene=reader.selected&layout=desktop',
      mode: 'explore',
    });
    const next = transitionShowcase(selected, { type: 'action', actionId: 'explain-selection' });
    assert.equal(next.sceneId, 'reader.selected');
    assert.match(next.notice ?? '', /live provider/);
  });

  it('uses actual history for Back and preserves layout on Restart', () => {
    let state = createShowcaseState({ mode: 'guided', defaultLayout: 'mobile' });
    state = transitionShowcase(state, { type: 'action', actionId: 'open-featured' });
    state = transitionShowcase(state, { type: 'action', actionId: 'select-passage' });
    assert.deepEqual(state.pathHistory, ['library.ready', 'reader.open']);
    state = transitionShowcase(state, { type: 'back' });
    assert.equal(state.sceneId, 'reader.open');
    state = transitionShowcase(state, { type: 'restart' });
    assert.equal(state.sceneId, 'library.ready');
    assert.equal(state.layout, 'mobile');
    assert.deepEqual(state.pathHistory, []);
  });

  it('preserves the logical scene across layouts', () => {
    const state = createShowcaseState({
      search: '?scene=review.question&layout=desktop',
      mode: 'guided',
    });
    const next = transitionShowcase(state, { type: 'set-layout', layout: 'mobile' });
    assert.equal(next.sceneId, 'review.question');
    assert.equal(next.layout, 'mobile');
    assert.ok(getShowcaseAsset(next.sceneId, next.layout));
  });

  it('clamps deep links and never exposes arbitrary asset paths', () => {
    assert.deepEqual(parseShowcaseSearch('?scene=review.answer&layout=mobile&asset=/etc/passwd'), {
      scene: 'review.answer',
      layout: 'mobile',
    });
    const valid = createShowcaseState({
      search: '?scene=review.answer&layout=mobile',
      mode: 'guided',
    });
    assert.equal(valid.sceneId, 'review.answer');
    assert.equal(valid.layout, 'mobile');

    const invalid = createShowcaseState({
      search: '?scene=../../secret&layout=watch',
      mode: 'guided',
    });
    assert.equal(invalid.sceneId, 'library.ready');
    assert.equal(invalid.layout, 'desktop');
    assert.equal(canonicalShowcaseSearch(invalid), '?scene=library.ready&layout=desktop');
  });

  it('uses the catalog fallback for non-captured scenes and filters invalid history', () => {
    assert.equal(resolveSceneForLayout('explain.grounded', 'mobile'), 'reader.selected');
    const clamped = clampShowcaseState({
      mode: 'guided',
      sceneId: 'review.answer',
      layout: 'desktop',
      pathHistory: ['library.ready', 'missing', 'reader.open'],
    });
    assert.deepEqual(clamped.pathHistory, ['library.ready', 'reader.open']);
  });
});
