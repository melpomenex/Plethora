import { describe, expect, it, vi } from 'vitest';
import { computePreferredPositions, applyDiagnosticAdaptation } from '../diagnosticAdaptation';
import type { StudyPlanDetail } from '../../../../types/learningPaths';

function planDetail(): StudyPlanDetail {
  return {
    plan: { id: 'sp_1', title: 'P', goal: 'G', depth: 'foundational', status: 'active', currentVersionId: null, currentVersion: 0, draftVersionId: 'spv_1', revision: 3, createdAt: '', updatedAt: '' },
    version: {
      id: 'spv_1', planId: 'sp_1', version: 1, state: 'draft', baseVersionId: null,
      sourceScope: undefined,
      knowledgeAuthority: { kind: 'library', policy: 'source-only' },
      nodes: [
        { nodeId: 'n0', title: 'A', summary: 's', learningObjectives: ['o'], conceptId: 'cA', conceptLabel: 'A', position: 0, included: true, locked: false, userAdded: false, userModified: false, materialSupport: 'grounded', whyHere: null, sourceRefIds: [] },
        { nodeId: 'n1', title: 'B', summary: 's', learningObjectives: ['o'], conceptId: 'cB', conceptLabel: 'B', position: 1, included: true, locked: false, userAdded: false, userModified: false, materialSupport: 'grounded', whyHere: null, sourceRefIds: [] },
        { nodeId: 'n2', title: 'C', summary: 's', learningObjectives: ['o'], conceptId: null, conceptLabel: 'C', position: 2, included: true, locked: false, userAdded: false, userModified: false, materialSupport: 'grounded', whyHere: null, sourceRefIds: [] },
      ],
      prerequisites: [], changeSummary: null, createdBy: 'user', createdAt: '', publishedAt: null,
    },
    activityByNodeId: {},
    sourceRefs: {},
  };
}

function evidence(concepts: string[]) {
  return {
    diagnosticAttemptId: 'att_d1',
    concepts: concepts.map((conceptId) => ({
      conceptId,
      level: 'needs-attention' as const,
      observedMean: 0.4,
      uncertainty: [],
      evidenceGroupIds: [],
    })),
  };
}

describe('diagnostic adaptation (lesson 2.3)', () => {
  it('computes diagnostic preferences by concept rank', () => {
    const preferred = computePreferredPositions(evidence(['cB', 'cA']), planDetail().version.nodes);
    expect(preferred.get('n1')).toBe(1); // cB first
    expect(preferred.get('n0')).toBe(2); // cA second
    expect(preferred.has('n2')).toBe(false); // no concept → unchanged
  });

  it('applies a valid reorder through the DAG-aware orderer and saves with CAS', async () => {
    const saveDraft = vi.fn().mockImplementation(async (input: { nodes: unknown[] }) => ({
      ...planDetail(),
      version: { ...planDetail().version, nodes: input.nodes },
    }));
    const result = await applyDiagnosticAdaptation('sp_1', 3, evidence(['cB', 'cA']), {
      getPlan: vi.fn().mockResolvedValue(planDetail()) as never,
      saveDraft: saveDraft as never,
    });
    // cB (n1) moves before cA (n0); unknown C (n2) stays after.
    expect(result.reorderedNodeIds[0]).toBe('n1');
    expect(result.reorderedNodeIds[1]).toBe('n0');
    expect(result.reorderedNodeIds[2]).toBe('n2');
    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({ expectedDraftRevision: 3 }));
  });

  it('fails closed when no diagnostic preferences exist', async () => {
    await expect(
      applyDiagnosticAdaptation('sp_1', 3, evidence([]), {
        getPlan: vi.fn().mockResolvedValue(planDetail()) as never,
        saveDraft: vi.fn() as never,
      })
    ).rejects.toThrow('no_reorder_preferences');
    // No draft write happened.
  });
});
