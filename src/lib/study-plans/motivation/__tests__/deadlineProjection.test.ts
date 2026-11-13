import { describe, expect, it } from 'vitest';
import { projectDeadline } from '../deadlineProjection';
import type { StudyPlanDetail } from '../../../../types/learningPaths';

function detail(nodes = 6): StudyPlanDetail {
  return {
    plan: { id: 'sp_1', title: 'P', goal: 'G', depth: 'foundational', status: 'active', currentVersionId: null, currentVersion: 0, draftVersionId: 'spv_1', revision: 1, createdAt: '', updatedAt: '' },
    version: {
      id: 'spv_1', planId: 'sp_1', version: 1, state: 'draft', baseVersionId: null,
      sourceScope: undefined,
      knowledgeAuthority: { kind: 'manual' },
      nodes: Array.from({ length: nodes }, (_, i) => ({
        nodeId: `n${i}`, title: `T${i}`, summary: 's', learningObjectives: ['obj'],
        conceptId: null, conceptLabel: `T${i}`, position: i, included: true, locked: false,
        userAdded: false, userModified: false, materialSupport: 'not-validated',
        whyHere: null, sourceRefIds: [],
      })),
      prerequisites: [], changeSummary: null, createdBy: 'user', createdAt: '', publishedAt: null,
    },
    activityByNodeId: {},
    sourceRefs: {},
  };
}

describe('projectDeadline (motivation 1.2)', () => {
  it('distributes remaining lessons across study days in plan order and skips rest days', () => {
    // 2026-11-13 = Friday, 14 = Saturday (rest day), 15 = Sunday, 16 = Monday.
    const projection = projectDeadline(
      detail(5),
      { deadline: '2026-11-16', restDays: [6] },
      { today: '2026-11-13' }
    );
    expect(projection.studyLoad.map((l) => l.date)).toEqual([
      '2026-11-13',
      '2026-11-15',
      '2026-11-16', // the Saturday rest day is skipped
    ]);
    const assigned = projection.studyLoad.reduce((sum, l) => sum + l.newLessons, 0);
    expect(assigned).toBe(5);
    expect(projection.overflow).toBe(false);
    expect(projection.passed).toBe(false);
  });

  it('keeps projected due reviews separate and visible on rest days', () => {
    const forecast = [
      { date: '2026-11-14', newLessons: 0 },
      { date: '2026-11-15', newLessons: 3 }, // weekend still has reviews
    ];
    const projection = projectDeadline(
      detail(3),
      { deadline: '2026-11-16', restDays: [6] },
      { today: '2026-11-13', forecast }
    );
    expect(projection.projectedDueReviews).toEqual(forecast);
    // Rest day (Saturday 14) never receives new-lesson load…
    expect(projection.studyLoad.some((l) => l.date === '2026-11-14')).toBe(false);
    // …while its reviews remain visible.
    expect(projection.forecastAvailable).toBe(true);
  });

  it('reports overflow when capacity is exceeded and passed when in the past', () => {
    // 30 lessons over two study days with an 8/day cap → overflow.
    const soon = projectDeadline(
      detail(30),
      { deadline: '2026-11-14', restDays: [] },
      { today: '2026-11-13', dailyCap: 8 }
    );
    expect(soon.overflow).toBe(true);

    const passed = projectDeadline(detail(3), { deadline: '2026-11-01', restDays: [] }, { today: '2026-11-13' });
    expect(passed.passed).toBe(true);
    expect(passed.overflow).toBe(true);
    expect(passed.studyLoad).toEqual([]);
  });

  it('handles missing forecast and no deadline without fabricating data', () => {
    const none = projectDeadline(detail(2), {}, { today: '2026-11-13' });
    expect(none.forecastAvailable).toBe(false);
    expect(none.projectedDueReviews).toEqual([]);
    expect(none.studyLoad).toEqual([]);
    expect(none.remainingLessons).toBe(2);
  });
});
