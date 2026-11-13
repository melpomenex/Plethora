/**
 * Typed Tauri IPC wrappers for Assessment Blueprints & Questions.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §11
 * - openspec/changes/generate-study-plan-examinations/ (C3-T05)
 */

import { invokeCommand, isTauri } from '../lib/tauri';
import { StudyApiError, normalizeStudyError } from './study-plans';
import type {
  BlueprintDetail,
  BlueprintSummary,
  AssessmentQuestionRevision,
  AssessmentConfigV1,
  QuestionKind,
  Difficulty,
} from '../types/assessmentQuestions';
import type { StudySourceScopeV1 } from '../types/studySource';

export interface CreateBlueprintInput {
  planId?: string | null;
  title: string;
  planVersionId?: string | null;
  config: AssessmentConfigV1;
  sourceScope: StudySourceScopeV1;
  sourceSnapshotHash: string;
}

export interface SaveBlueprintDraftInput {
  revisionId: string;
  expectedRevision: number;
  title?: string;
  config?: AssessmentConfigV1;
  sourceScope?: StudySourceScopeV1;
  sourceSnapshotHash?: string;
}

export interface QuestionTargetInput {
  conceptId?: string | null;
  conceptLabel: string;
  nodeId?: string | null;
  objectiveText: string;
}

export interface SaveQuestionDraftInput {
  blueprintRevisionId: string;
  questionId?: string;
  slotKey: string;
  fingerprint: string;
  kind: QuestionKind;
  payloadJson: string;
  answerKeyJson: string;
  rubricJson?: string | null;
  maxPoints: number;
  difficulty: Difficulty;
  validation: string;
  validationIssuesJson?: string | null;
  providerJson?: string | null;
  sourceRefIds: string[];
  targets: QuestionTargetInput[];
}

function ensureNativeSupport(): void {
  if (!isTauri()) {
    throw new StudyApiError({
      code: 'unsupported_platform',
      messageKey: 'study.assessment.error.unsupported_platform',
      retryable: false,
    });
  }
}

/**
 * Creates a new Assessment Blueprint with an initial Draft revision.
 */
export async function createAssessmentBlueprint(
  input: CreateBlueprintInput
): Promise<BlueprintDetail> {
  ensureNativeSupport();
  try {
    return await invokeCommand<BlueprintDetail>('create_assessment_blueprint', {
      input: {
        planId: input.planId ?? null,
        title: input.title,
        planVersionId: input.planVersionId ?? null,
        config: input.config,
        sourceScope: input.sourceScope,
        sourceSnapshotHash: input.sourceSnapshotHash,
      },
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

/**
 * Saves draft modifications to a draft blueprint revision.
 */
export async function saveAssessmentBlueprintDraft(
  input: SaveBlueprintDraftInput
): Promise<BlueprintDetail> {
  ensureNativeSupport();
  try {
    return await invokeCommand<BlueprintDetail>('save_assessment_blueprint_draft', {
      input: {
        revisionId: input.revisionId,
        expectedRevision: input.expectedRevision,
        title: input.title,
        config: input.config,
        sourceScope: input.sourceScope,
        sourceSnapshotHash: input.sourceSnapshotHash,
      },
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

/**
 * Fetches an Assessment Blueprint detail by revision ID.
 */
export async function getAssessmentBlueprintRevision(
  revisionId: string
): Promise<BlueprintDetail> {
  ensureNativeSupport();
  try {
    return await invokeCommand<BlueprintDetail>('get_assessment_blueprint_revision', {
      revisionId,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

/**
 * Lists assessment blueprints, optionally filtered by planId.
 */
export async function listAssessmentBlueprints(
  planId?: string | null
): Promise<BlueprintSummary[]> {
  ensureNativeSupport();
  try {
    return await invokeCommand<BlueprintSummary[]>('list_assessment_blueprints', {
      planId: planId ?? null,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

/**
 * Upserts an uncommitted question draft into a blueprint revision.
 */
export async function upsertAssessmentQuestionDraft(
  input: SaveQuestionDraftInput
): Promise<AssessmentQuestionRevision> {
  ensureNativeSupport();
  try {
    return await invokeCommand<AssessmentQuestionRevision>('upsert_assessment_question_draft', {
      input: {
        blueprintRevisionId: input.blueprintRevisionId,
        questionId: input.questionId ?? null,
        slotKey: input.slotKey,
        fingerprint: input.fingerprint,
        kind: input.kind,
        payloadJson: input.payloadJson,
        answerKeyJson: input.answerKeyJson,
        rubricJson: input.rubricJson ?? null,
        maxPoints: input.maxPoints,
        difficulty: input.difficulty,
        validation: input.validation,
        validationIssuesJson: input.validationIssuesJson ?? null,
        providerJson: input.providerJson ?? null,
        sourceRefIds: input.sourceRefIds,
        targets: input.targets,
      },
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

/**
 * Publishes an assessment blueprint revision, committing all questions and marking it ready.
 */
export async function publishAssessmentBlueprint(
  revisionId: string,
  expectedRevision: number,
  shortfallAccepted: boolean,
  externalEvidenceAccepted = false
): Promise<BlueprintDetail> {
  ensureNativeSupport();
  try {
    return await invokeCommand<BlueprintDetail>('publish_assessment_blueprint', {
      revisionId,
      expectedRevision,
      shortfallAccepted,
      externalEvidenceAccepted,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

/**
 * Discards an uncommitted draft revision.
 */
export async function discardAssessmentBlueprintDraft(
  revisionId: string,
  expectedRevision: number
): Promise<void> {
  ensureNativeSupport();
  try {
    await invokeCommand<void>('discard_assessment_blueprint_draft', {
      revisionId,
      expectedRevision,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

/**
 * Archives an assessment blueprint.
 */
export async function archiveAssessmentBlueprint(
  blueprintId: string,
  expectedRevision: number
): Promise<void> {
  ensureNativeSupport();
  try {
    await invokeCommand<void>('archive_assessment_blueprint', {
      blueprintId,
      expectedRevision,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

/**
 * Deletes an unused assessment blueprint.
 */
export async function deleteUnusedAssessmentBlueprint(
  blueprintId: string,
  expectedRevision: number
): Promise<void> {
  ensureNativeSupport();
  try {
    await invokeCommand<void>('delete_unused_assessment_blueprint', {
      blueprintId,
      expectedRevision,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}
