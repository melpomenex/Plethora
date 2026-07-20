import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../database', () => ({
  getLearningItem: vi.fn(),
  getSyncState: vi.fn(),
  commitBrowserSm20Review: vi.fn(),
  commitBrowserArenaReview: vi.fn(),
  undoBrowserArenaReview: vi.fn(),
}));

vi.mock('../../stores/llmProvidersStore', () => ({
  useLLMProvidersStore: { getState: () => ({ providers: [] }) },
}));

import { browserInvoke } from '../browser-backend';
import * as db from '../database';
import { currentDayFromCe, freshSm20CollectionState } from '../sm20';
import parityFixture from '../../shared/sm20ArenaParityFixture.json';

describe('browser SM-20 collection parity', () => {
  const now = new Date('2026-07-20T12:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function browserItem() {
    const today = currentDayFromCe(now);
    const state = structuredClone(parityFixture.state);
    state.m1_state.last_review_day = today - parityFixture.elapsed_days;
    state.m2_state.last_review_day = today - parityFixture.elapsed_days;
    state.m3_state.last_review_day = today - parityFixture.elapsed_days;
    return {
      id: 'sm20-card',
      item_type: 'flashcard',
      question: 'Q',
      answer: 'A',
      due_date: now.toISOString(),
      interval: 30,
      ease_factor: 2.5,
      last_review_date: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
      review_count: 3,
      lapses: 0,
      state: 'review',
      memory_state: { stability: 30, difficulty: 0.4 },
      difficulty: 4,
      algorithm_type: 'sm20',
      algorithm_state: JSON.stringify(state),
      date_added: now.toISOString(),
      date_modified: now.toISOString(),
      sync_version: 0,
    } as any;
  }

  it('uses persisted M2/M3/Arena state and commits the item and learner together', async () => {
    const item = browserItem();
    const storedCollection = freshSm20CollectionState();
    vi.mocked(db.getLearningItem).mockResolvedValue(item);
    vi.mocked(db.getSyncState).mockImplementation(async (key) =>
      key === 'sm20_collection_state' ? storedCollection : undefined);
    vi.mocked(db.commitBrowserSm20Review).mockResolvedValue(undefined);

    await browserInvoke('submit_review', {
      itemId: item.id,
      rating: 3,
      grade: parityFixture.committed_grade,
      algorithm: 'sm20',
    });

    expect(db.commitBrowserSm20Review).toHaveBeenCalledOnce();
    const [committedItem, committedCollection] = vi.mocked(db.commitBrowserSm20Review).mock.calls[0];
    const nextState = JSON.parse(committedItem.algorithm_state!);
    expect(nextState.m2_state).toMatchObject({
      repetitions: 4,
      lapses: 0,
      a_factor: parityFixture.committed_state.m2_state.a_factor,
      u_factor: parityFixture.committed_state.m2_state.u_factor,
    });
    expect(nextState.m3_state).toMatchObject({
      repetitions: 4,
      lapses: 0,
      stability: parityFixture.committed_state.m3_state.stability,
      difficulty: parityFixture.committed_state.m3_state.difficulty,
    });
    expect((committedCollection as typeof storedCollection).m2_optimizer.cell_cases.flat()
      .reduce((sum, value) => sum + value, 0)).toBe(1);
    expect((committedCollection as typeof storedCollection).m3_matrices.outcome_count
      .reduce((sum, value) => sum + value, 0)).toBe(1);
  });

  it('atomically commits and snapshots the full collection for an Arena choice', async () => {
    const item = browserItem();
    const storedCollection = freshSm20CollectionState();
    vi.mocked(db.getLearningItem).mockResolvedValue(item);
    vi.mocked(db.getSyncState).mockImplementation(async (key) =>
      key === 'sm20_collection_state' ? storedCollection : undefined);
    vi.mocked(db.commitBrowserArenaReview).mockResolvedValue(true);

    const preview = await browserInvoke<any>('preview_review_intervals', {
      itemId: item.id,
      algorithm: 'sm20',
    });
    const grade = parityFixture.committed_grade;
    expect(preview.arena.grades[grade].candidates.map((candidate: any) => candidate.interval_days))
      .toEqual(parityFixture.grades[grade].candidates);

    await browserInvoke('submit_review', {
      itemId: item.id,
      rating: 3,
      grade,
      algorithm: 'sm20',
      arenaSelection: {
        source: 'model',
        model_id: 'sm19',
        commit_id: 'browser-parity-commit',
        preview_id: preview.arena.preview_id,
        item_revision: preview.arena.item_revision,
        arena_revision: preview.arena.arena_revision,
        decision_time_ms: 200,
      },
    });

    expect(db.commitBrowserArenaReview).toHaveBeenCalledOnce();
    const [committedItem, , provenance, committedCollection, previousCollection] =
      vi.mocked(db.commitBrowserArenaReview).mock.calls[0];
    expect(committedItem.interval).toBe(parityFixture.grades[grade].candidates[2]);
    expect(provenance.schedule_model_id).toBe('sm19');
    expect((committedCollection as typeof storedCollection).m2_optimizer.cell_cases.flat()
      .reduce((sum, value) => sum + value, 0)).toBe(1);
    expect((previousCollection as typeof storedCollection).m2_optimizer.cell_cases.flat()
      .reduce((sum, value) => sum + value, 0)).toBe(0);
  });
});
