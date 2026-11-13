import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useLearningPathsStore } from '../learningPathsStore';
import * as api from '../../api/study-plans';
import type { StudyPlanDetail, StudyPlanSummary } from '../../types/learningPaths';

vi.mock('../../api/study-plans', () => ({
  listStudyPlans: vi.fn(),
  getStudyPlan: vi.fn(),
  createStudyPlan: vi.fn(),
  saveStudyPlanDraft: vi.fn(),
  publishStudyPlanVersion: vi.fn(),
  discardStudyPlanDraft: vi.fn(),
  setStudyPlanNodeActivity: vi.fn(),
  archiveStudyPlan: vi.fn(),
  deleteStudyPlan: vi.fn(),
}));

describe('LearningPathsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLearningPathsStore.getState().clearPaths();
    window.localStorage.clear();
  });

  describe('Legacy compatibility (non-persisted in-memory)', () => {
    it('creates goals and adaptive learning paths in memory without localStorage writes', () => {
      const store = useLearningPathsStore.getState();
      const goalId = store.createGoal({
        title: 'Master Modern Cryptography',
        description: 'Zero-knowledge proofs and symmetric ciphers',
      });

      const pathId = store.createPath({
        goalId,
        title: 'ZKP and AES Foundation Path',
        nodes: [
          {
            id: 'n1',
            pathId: 'p1',
            title: 'Discrete Logarithms',
            sourceDocIds: ['doc-crypto-1'],
            prerequisiteNodeIds: [],
            estimatedMasteryStart: 0.2,
            targetMastery: 0.9,
            isUserModified: false,
            status: 'pending',
          },
        ],
      });

      const active = useLearningPathsStore.getState().getActivePath();
      expect(active).not.toBeNull();
      expect(active?.id).toBe(pathId);
      expect(active?.nodes).toHaveLength(1);

      // Verify no writes to old localStorage authority
      expect(window.localStorage.getItem('plethora-learning-paths')).toBeNull();
    });

    it('updates node status and preserves manual node re-orderings', () => {
      const store = useLearningPathsStore.getState();
      const goalId = store.createGoal({ title: 'Distributed Systems' });
      const pathId = store.createPath({
        goalId,
        title: 'Raft & Paxos Consensus',
        nodes: [
          {
            id: 'n1',
            pathId: 'temp',
            title: 'State Machine Replication',
            sourceDocIds: [],
            prerequisiteNodeIds: [],
            estimatedMasteryStart: 0.4,
            targetMastery: 0.9,
            isUserModified: false,
            status: 'pending',
          },
          {
            id: 'n2',
            pathId: 'temp',
            title: 'Leader Election',
            sourceDocIds: [],
            prerequisiteNodeIds: ['n1'],
            estimatedMasteryStart: 0.2,
            targetMastery: 0.85,
            isUserModified: false,
            status: 'pending',
          },
        ],
      });

      store.updateNodeStatus(pathId, 'n1', 'completed');
      expect(useLearningPathsStore.getState().getActivePath()?.nodes[0].status).toBe('completed');

      store.reorderNodes(pathId, ['n2', 'n1']);
      const reordered = useLearningPathsStore.getState().getActivePath()?.nodes;
      expect(reordered?.[0].id).toBe('n2');
      expect(reordered?.[0].isUserModified).toBe(true);
    });
  });

  describe('API-backed Study Plans store operations', () => {
    it('loadPlans populates plans and handles stale run tokens', async () => {
      const mockSummaries1: StudyPlanSummary[] = [
        {
          id: 'sp_slow',
          title: 'Slow Plan',
          goal: 'Slow Goal',
          depth: 'survey',
          status: 'active',
          currentVersion: 1,
          revision: 1,
          nodeCount: 1,
          completedNodeCount: 0,
          sourceDocumentCount: 0,
          hasDraft: false,
          updatedAt: '2026-11-10T00:00:00Z',
        },
      ];
      const mockSummaries2: StudyPlanSummary[] = [
        {
          id: 'sp_fast',
          title: 'Fast Plan',
          goal: 'Fast Goal',
          depth: 'foundational',
          status: 'active',
          currentVersion: 1,
          revision: 1,
          nodeCount: 2,
          completedNodeCount: 1,
          sourceDocumentCount: 1,
          hasDraft: false,
          updatedAt: '2026-11-10T00:00:00Z',
        },
      ];

      let resolveSlow!: (val: StudyPlanSummary[]) => void;
      const slowPromise = new Promise<StudyPlanSummary[]>((resolve) => {
        resolveSlow = resolve;
      });

      vi.mocked(api.listStudyPlans)
        .mockReturnValueOnce(slowPromise)
        .mockResolvedValueOnce(mockSummaries2);

      // Trigger slow load
      const p1 = useLearningPathsStore.getState().loadPlans();
      // Trigger fast load immediately after
      const p2 = useLearningPathsStore.getState().loadPlans();

      await p2;
      expect(useLearningPathsStore.getState().plans[0].id).toBe('sp_fast');

      // Now slow resolves
      resolveSlow(mockSummaries1);
      await p1;

      // Ensure slow response was ignored due to stale run token
      expect(useLearningPathsStore.getState().plans[0].id).toBe('sp_fast');
    });

    it('selectPlan fetches detail and updates activePlanDetail', async () => {
      const mockDetail: Partial<StudyPlanDetail> = {
        plan: {
          id: 'sp_1',
          title: 'Plan 1',
          goal: 'Goal 1',
          depth: 'deep',
          status: 'active',
          currentVersionId: 'spv_1',
          currentVersion: 1,
          draftVersionId: null,
          revision: 1,
          createdAt: '2026-11-10T00:00:00Z',
          updatedAt: '2026-11-10T00:00:00Z',
        },
        version: {
          id: 'spv_1',
          planId: 'sp_1',
          version: 1,
          state: 'published',
          baseVersionId: null,
          sourceScope: null,
          knowledgeAuthority: { kind: 'manual' },
          nodes: [],
          prerequisites: [],
          changeSummary: null,
          createdBy: 'user',
          createdAt: '2026-11-10T00:00:00Z',
          publishedAt: '2026-11-10T00:00:00Z',
        },
        activityByNodeId: {},
        sourceRefs: {},
      };

      vi.mocked(api.getStudyPlan).mockResolvedValueOnce(mockDetail as StudyPlanDetail);

      const detail = await useLearningPathsStore.getState().selectPlan('sp_1');
      expect(api.getStudyPlan).toHaveBeenCalledWith('sp_1', undefined);
      expect(detail).toEqual(mockDetail);
      expect(useLearningPathsStore.getState().activePlanId).toBe('sp_1');
      expect(useLearningPathsStore.getState().activePlanDetail).toEqual(mockDetail);
    });

    it('clearPaths resets memory cache without calling deletePlan on backend', () => {
      useLearningPathsStore.setState({
        plans: [
          {
            id: 'sp_1',
            title: 'Plan',
            goal: 'Goal',
            depth: 'survey',
            status: 'active',
            currentVersion: 1,
            revision: 1,
            nodeCount: 1,
            completedNodeCount: 0,
            sourceDocumentCount: 0,
            hasDraft: false,
            updatedAt: '2026-11-10T00:00:00Z',
          },
        ],
        activePlanId: 'sp_1',
      });

      useLearningPathsStore.getState().clearPaths();

      expect(useLearningPathsStore.getState().plans).toHaveLength(0);
      expect(useLearningPathsStore.getState().activePlanId).toBeNull();
      expect(api.deleteStudyPlan).not.toHaveBeenCalled();
    });
  });
});
