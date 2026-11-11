import { getStudyPlan, StudyApiError } from '../../../api/study-plans';
import type { StudySourceRefV1 } from '../../../types/studySource';
import type { AttemptDetail } from '../../../types/assessmentSessions';
import { studyRubricGradeTask } from '../../ai/tasks/definitions/rubricGradingTask';
import { BlueprintService } from '../assessments/blueprintService';
import { refreshCurriculumScope } from '../generation/curriculumPreflight';
import { performStudyAiPreflight, validatePreflightUnchanged } from '../generation/preflight';
import type { StudyAiPreflight } from '../generation/types';
import { findPendingGradingSubmissions } from './gradingJobPlanner';

export async function prepareRubricGrading(detail: AttemptDetail, authorized?: StudyAiPreflight) {
  const pending = findPendingGradingSubmissions(detail, detail.questions ?? []);
  const blueprint = await BlueprintService.getBlueprintRevision(detail.attempt.blueprintRevisionId);
  const scope = blueprint.revision.sourceScope;
  const hasScope = scope.resolvedDocuments.length > 0 || Object.values(scope.selected).some((ids) => ids.length > 0);
  const live = hasScope ? await refreshCurriculumScope(scope) : scope;
  const docs = new Set(live.resolvedDocuments.map((doc) => doc.documentId));
  const requiredRefIds = [...new Set(pending.flatMap(({ question }) => question.question.sourceRefIds ?? []))];
  const sourceRefs = new Map<string, StudySourceRefV1>();
  if (requiredRefIds.length && blueprint.blueprint.planId && blueprint.revision.planVersionId) {
    const plan = await getStudyPlan(blueprint.blueprint.planId, blueprint.revision.planVersionId);
    for (const id of requiredRefIds) {
      const source = plan.sourceRefs[id];
      if (source?.status === 'current' && docs.has(source.ref.documentId) &&
          (live.selected.documentIds.includes(source.ref.documentId) ||
            !!source.ref.extractId && live.selected.extractIds.includes(source.ref.extractId))) {
        sourceRefs.set(id, source.ref);
      }
    }
  }
  if (requiredRefIds.length !== sourceRefs.size) {
    throw new StudyApiError({
      code: 'stale_source',
      messageKey: 'study_grading.error.source_evidence_unavailable',
      retryable: false,
    });
  }
  const result = await performStudyAiPreflight({
    primaryTask: studyRubricGradeTask,
    documents: live.resolvedDocuments.map((doc) => ({
      id: doc.documentId, isAiExcluded: doc.isAiExcluded, isLocalOnly: doc.isLocalOnly,
    })),
    sourceExcerptCount: sourceRefs.size,
    plannedModelSteps: pending.length,
    inspectOnly: !authorized,
    cloudDisclosureAccepted: authorized?.cloudDisclosureAccepted,
    costConsentAccepted: authorized?.costConsentAccepted,
  });
  result.preflight.sendsAnswersOffDevice = result.preflight.sendsSourceOffDevice;
  if (authorized) {
    validatePreflightUnchanged(authorized, result.route);
    if (result.preflight.maximumModelCalls > authorized.maximumModelCalls ||
        JSON.stringify(result.preflight.documentIds) !== JSON.stringify(authorized.documentIds) ||
        result.preflight.reasoningFallback !== authorized.reasoningFallback) {
      throw new StudyApiError({
        code: 'invalid_state',
        messageKey: 'study_generation.error.provider_changed_on_resume',
        retryable: false,
      });
    }
  }
  return { ...result, sourceRefs };
}
