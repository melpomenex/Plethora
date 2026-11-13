/**
 * "Add sources and verify" promotion for Study Plans.
 *
 * Moves a Model-only or source-free Manual draft onto a library-backed source-only
 * authority by saving a NEW draft revision with the resolved source scope. The
 * existing verified exam publication gate remains authoritative: publishing the
 * draft still requires grounded nodes to carry current, exact source references,
 * so bad keys or insufficient sources block publication. Older attempts and
 * published versions are never relabeled.
 */

import { getStudyPlan, saveStudyPlanDraft, StudyApiError } from '../../api/study-plans';
import { resolveStudySourceScope } from '../../api/study-sources';
import type { StudyPlanDetail } from '../../types/learningPaths';
import type { SelectedSourceScope, StudySourceScopeV1 } from '../../types/studySource';

export async function resolveAndVerifySources(
  planId: string,
  expectedPlanRevision: number,
  selection: SelectedSourceScope,
): Promise<StudyPlanDetail> {
  const detail = await getStudyPlan(planId);
  if (detail.version.knowledgeAuthority.kind === 'library') {
    throw new StudyApiError({
      code: 'invalid_state',
      messageKey: 'study_plan.error.already_library_authority',
      retryable: false,
    });
  }
  const sourceScope: StudySourceScopeV1 = await resolveStudySourceScope(selection);
  return saveStudyPlanDraft({
    planId,
    expectedDraftRevision: expectedPlanRevision,
    sourceScope,
    knowledgeAuthority: { kind: 'library', policy: 'source-only' },
    nodes: detail.version.nodes,
    prerequisites: detail.version.prerequisites,
  });
}
