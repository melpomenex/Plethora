import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEMO_CONTENT_KINDS,
  DEMO_HAPPY_PATH,
  INITIAL_DEMO_STATE,
  clampDemoState,
  parseDemoSearch,
  restartDemo,
  transition,
  type DemoEvent,
} from './machine.ts';

describe('demo machine', () => {
  it('advances every happy-path stage', () => {
    let state = { ...INITIAL_DEMO_STATE };
    for (let i = 0; i < DEMO_HAPPY_PATH.length - 1; i += 1) {
      const from = DEMO_HAPPY_PATH[i]!;
      const to = DEMO_HAPPY_PATH[i + 1]!;
      assert.equal(state.stage, from);
      const event: DemoEvent =
        from === 'review-rate' ? { type: 'rate', rating: 3 } : { type: 'advance' };
      state = transition(state, event);
      assert.equal(state.stage, to);
    }
    assert.equal(state.stage, 'complete');
    assert.equal(transition(state, { type: 'advance' }).stage, 'complete');
  });

  it('opens each library kind onto item', () => {
    for (const kind of DEMO_CONTENT_KINDS) {
      const next = transition(INITIAL_DEMO_STATE, { type: 'select-kind', kind });
      assert.equal(next.stage, 'item');
      assert.equal(next.contentKind, kind);
    }
  });

  it('uses labeled events on passage, remember, and reveal', () => {
    let state = transition(INITIAL_DEMO_STATE, { type: 'advance' }); // item
    state = transition(state, { type: 'advance' }); // reader
    state = transition(state, { type: 'advance' }); // passage
    state = transition(state, { type: 'select-passage' });
    assert.equal(state.stage, 'explain');
    state = transition(state, { type: 'advance' }); // remember-confirm
    state = transition(state, { type: 'remember' });
    assert.equal(state.stage, 'card');
    state = transition(state, { type: 'advance' }); // review-prompt
    state = transition(state, { type: 'reveal' });
    assert.equal(state.stage, 'review-reveal');
  });

  it('restarts to library and keeps the current kind', () => {
    const mid = transition(INITIAL_DEMO_STATE, { type: 'select-kind', kind: 'podcast' });
    const done = restartDemo(mid);
    assert.equal(done.stage, 'library');
    assert.equal(done.contentKind, 'podcast');
    assert.equal(done.rating, undefined);
  });

  it('clamps invalid hydrations onto library', () => {
    assert.equal(clampDemoState({ contentKind: 'novel', stage: 'reader' }).stage, 'library');
    assert.equal(clampDemoState({ contentKind: 'article', stage: 'connect' }).stage, 'library');
    assert.equal(
      clampDemoState({ contentKind: 'article', stage: 'reader', passageId: 'missing' }).stage,
      'library',
    );
    const valid = clampDemoState({ contentKind: 'book', stage: 'reader' });
    assert.equal(valid.stage, 'reader');
    assert.equal(valid.contentKind, 'book');
  });

  it('clamps illegal events onto library', () => {
    assert.equal(transition(INITIAL_DEMO_STATE, { type: 'remember' }).stage, 'library');
    assert.equal(transition(INITIAL_DEMO_STATE, { type: 'reveal' }).stage, 'library');
    assert.equal(transition(INITIAL_DEMO_STATE, { type: 'rate', rating: 3 }).stage, 'library');
    assert.equal(transition(INITIAL_DEMO_STATE, { type: 'select-passage' }).stage, 'library');
    const reader = transition(transition(INITIAL_DEMO_STATE, { type: 'advance' }), { type: 'advance' });
    assert.equal(reader.stage, 'reader');
    const clamped = transition(reader, { type: 'select-kind', kind: 'pdf' });
    assert.equal(clamped.stage, 'library');
    assert.equal(clamped.contentKind, 'pdf');
  });

  it('parses search params through hydrate', () => {
    const parsed = parseDemoSearch('?kind=video&stage=reader');
    const state = transition(INITIAL_DEMO_STATE, { type: 'hydrate', ...parsed });
    assert.equal(state.contentKind, 'video');
    assert.equal(state.stage, 'reader');
    const bad = transition(INITIAL_DEMO_STATE, {
      type: 'hydrate',
      ...parseDemoSearch('?kind=article&stage=nope'),
    });
    assert.equal(bad.stage, 'library');
  });
});
