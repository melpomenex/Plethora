import { describe, it, expect } from 'vitest';
import {
  previewLegacyKnowledgeGapsImport,
  convertLegacyGapsToViews,
  executeLegacyKnowledgeGapsImport,
  legacyGapImportKey,
} from '../legacyKnowledgeGapsImport';
import { LEGACY_GAPS_STORAGE_KEY, LEGACY_GAPS_BACKUP_KEY } from '../../../../types/knowledgeGaps';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe('legacyKnowledgeGapsImport (C6-T05)', () => {
  it('previews counts and preserves legacy mastery only as provenance', () => {
    const store = memoryStorage({
      [LEGACY_GAPS_STORAGE_KEY]: JSON.stringify({
        gaps: [
          {
            id: 'g1',
            kind: 'weak_prerequisite',
            conceptId: 'c1',
            conceptName: 'TLB',
            masteryEstimate: 0.25,
            variance: 0.15,
            evidence: [{ recordId: 'r1', kind: 'assessment', description: 'low score' }],
            status: 'active',
            detectedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    });
    const preview = previewLegacyKnowledgeGapsImport(store);
    expect(preview.total).toBe(1);
    expect(preview.active).toBe(1);

    const views = convertLegacyGapsToViews([
      {
        id: 'g1',
        kind: 'weak_prerequisite',
        conceptId: 'c1',
        conceptName: 'TLB',
        masteryEstimate: 0.25,
        variance: 0.15,
        evidence: [{ recordId: 'r1', kind: 'assessment', description: 'low score' }],
        status: 'active',
        detectedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    expect(views[0].ruleId).toBe('legacy-localstorage-v1');
    expect(views[0].demonstrated).toBeNull();
    expect(views[0].evidence[0].payload.legacyMasteryEstimate).toBe(0.25);
  });

  it('is retry-safe and renames key only after accepted commit', async () => {
    const raw = JSON.stringify({
      gaps: [
        {
          id: 'g1',
          kind: 'missing_concept',
          conceptName: 'X',
          evidence: [],
          status: 'active',
          detectedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const store = memoryStorage({ [LEGACY_GAPS_STORAGE_KEY]: raw });
    const key1 = legacyGapImportKey({
      id: 'g1',
      kind: 'missing_concept',
      conceptName: 'X',
      evidence: [],
      status: 'active',
      detectedAt: '2026-01-01T00:00:00.000Z',
    });
    const key2 = legacyGapImportKey({
      id: 'g1',
      kind: 'missing_concept',
      conceptName: 'X',
      evidence: [],
      status: 'active',
      detectedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(key1).toBe(key2);

    const committed: unknown[] = [];
    const res = await executeLegacyKnowledgeGapsImport(store, async (views) => {
      committed.push(views);
    });
    expect(res.imported).toBe(1);
    expect(store.getItem(LEGACY_GAPS_STORAGE_KEY)).toBeNull();
    expect(store.getItem(LEGACY_GAPS_BACKUP_KEY)).toBe(raw);
  });

  it('failed commit never deletes original data', async () => {
    const raw = JSON.stringify({
      gaps: [
        {
          id: 'g1',
          kind: 'missing_concept',
          conceptName: 'X',
          evidence: [],
          status: 'active',
          detectedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const store = memoryStorage({ [LEGACY_GAPS_STORAGE_KEY]: raw });
    await expect(
      executeLegacyKnowledgeGapsImport(store, async () => {
        throw new Error('commit failed');
      }),
    ).rejects.toThrow('commit failed');
    expect(store.getItem(LEGACY_GAPS_STORAGE_KEY)).toBe(raw);
    expect(store.getItem(LEGACY_GAPS_BACKUP_KEY)).toBeNull();
  });
});
