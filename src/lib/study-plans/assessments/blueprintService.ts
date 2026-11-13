/**
 * Assessment Blueprint and Question Service.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §§4–6, §11
 * - openspec/changes/generate-study-plan-examinations/ (C3-T05)
 */

import {
  createAssessmentBlueprint,
  saveAssessmentBlueprintDraft,
  getAssessmentBlueprintRevision,
  listAssessmentBlueprints,
  upsertAssessmentQuestionDraft,
  publishAssessmentBlueprint,
  discardAssessmentBlueprintDraft,
  archiveAssessmentBlueprint,
  deleteUnusedAssessmentBlueprint,
  type CreateBlueprintInput,
  type SaveBlueprintDraftInput,
  type SaveQuestionDraftInput,
  type QuestionTargetInput,
} from '../../../api/assessment-blueprints';
import type {
  AssessmentConfigV1,
  AssessmentQuestion,
  AssessmentQuestionRevision,
  BlueprintDetail,
  BlueprintSummary,
} from '../../../types/assessmentQuestions';
import type { StudySourceScopeV1 } from '../../../types/studySource';
import { encodeQuestionRevision, decodeQuestionRevision } from './questionCodec';
import { computeQuestionFingerprint } from './questionFingerprint';
import { validateAssessmentQuestion } from './questionValidation';

type StoredQuestionRevision = AssessmentQuestionRevision & {
  kind?: AssessmentQuestion['kind'];
  payload?: unknown;
  answerKey?: unknown;
  rubric?: unknown;
};

/** Normalize the native storage DTO into the nested domain question used by the UI. */
function normalizeQuestionRevision(revision: AssessmentQuestionRevision): AssessmentQuestionRevision {
  if (revision.question?.prompt) return revision;

  const stored = revision as StoredQuestionRevision;
  if (typeof stored.kind !== 'string' || stored.payload == null || stored.answerKey == null) {
    throw new Error('study.assessment.error.invalid_question_revision');
  }

  const toJson = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);
  const decoded = decodeQuestionRevision(
    toJson(stored.payload),
    toJson(stored.answerKey),
    stored.rubric == null ? null : toJson(stored.rubric),
  );
  return { ...revision, question: decoded.question };
}

function normalizeBlueprintDetail(detail: BlueprintDetail): BlueprintDetail {
  return {
    ...detail,
    questions: (detail.questions ?? []).map(normalizeQuestionRevision),
  };
}

export interface CreateBlueprintParams {
  planId?: string | null;
  title: string;
  planVersionId?: string | null;
  config: AssessmentConfigV1;
  sourceScope: StudySourceScopeV1;
  sourceSnapshotHash: string;
}

export interface SaveBlueprintDraftParams {
  revisionId: string;
  expectedRevision: number;
  title?: string;
  config?: AssessmentConfigV1;
  sourceScope?: StudySourceScopeV1;
  sourceSnapshotHash?: string;
}

export interface SaveDomainQuestionParams {
  blueprintRevisionId: string;
  question: AssessmentQuestion;
  slotKey: string;
  questionId?: string;
  targets?: QuestionTargetInput[];
  providerJson?: string | null;
}

export class BlueprintService {
  /**
   * Lists assessment blueprints, optionally filtered by planId.
   */
  static async listBlueprints(planId?: string | null): Promise<BlueprintSummary[]> {
    return listAssessmentBlueprints(planId);
  }

  /**
   * Creates a new assessment blueprint with initial draft revision.
   */
  static async createBlueprint(params: CreateBlueprintParams): Promise<BlueprintDetail> {
    const input: CreateBlueprintInput = {
      planId: params.planId ?? null,
      title: params.title.trim(),
      planVersionId: params.planVersionId ?? null,
      config: params.config,
      sourceScope: params.sourceScope,
      sourceSnapshotHash: params.sourceSnapshotHash,
    };
    return normalizeBlueprintDetail(await createAssessmentBlueprint(input));
  }

  /**
   * Fetches an assessment blueprint revision detail.
   */
  static async getBlueprintRevision(revisionId: string): Promise<BlueprintDetail> {
    return normalizeBlueprintDetail(await getAssessmentBlueprintRevision(revisionId));
  }

  /**
   * Saves draft modifications (title, config, scope).
   */
  static async saveBlueprintDraft(params: SaveBlueprintDraftParams): Promise<BlueprintDetail> {
    const input: SaveBlueprintDraftInput = {
      revisionId: params.revisionId,
      expectedRevision: params.expectedRevision,
      title: params.title?.trim(),
      config: params.config,
      sourceScope: params.sourceScope,
      sourceSnapshotHash: params.sourceSnapshotHash,
    };
    return normalizeBlueprintDetail(await saveAssessmentBlueprintDraft(input));
  }

  /**
   * Validates and encodes a domain AssessmentQuestion, then persists it to the blueprint revision.
   */
  static async saveQuestionFromDomain(
    params: SaveDomainQuestionParams
  ): Promise<AssessmentQuestionRevision> {
    const { question, blueprintRevisionId, slotKey, questionId, targets = [], providerJson } = params;

    // Validate pure domain question
    const validationResult = validateAssessmentQuestion(question);

    // Encode to three-part storage
    const encoded = encodeQuestionRevision(question);

    // Canonical fingerprint
    const fingerprint = computeQuestionFingerprint(question, targets);

    const input: SaveQuestionDraftInput = {
      blueprintRevisionId,
      questionId,
      slotKey,
      fingerprint,
      kind: question.kind,
      payloadJson: encoded.payloadJson,
      answerKeyJson: encoded.answerKeyJson,
      rubricJson: encoded.rubricJson,
      maxPoints: question.maxPoints,
      difficulty: question.difficulty,
      validation: validationResult.valid ? 'valid' : 'invalid',
      validationIssuesJson:
        validationResult.issues.length > 0 ? JSON.stringify(validationResult.issues) : null,
      providerJson: providerJson ?? null,
      sourceRefIds: question.sourceRefIds,
      targets,
    };

    return normalizeQuestionRevision(await upsertAssessmentQuestionDraft(input));
  }

  /**
   * Saves a raw question draft revision.
   */
  static async saveQuestionDraft(
    input: SaveQuestionDraftInput
  ): Promise<AssessmentQuestionRevision> {
    return normalizeQuestionRevision(await upsertAssessmentQuestionDraft(input));
  }

  /**
   * Publishes an assessment blueprint revision to Ready state.
   */
  static async publishBlueprint(
    revisionId: string,
    expectedRevision: number,
    shortfallAccepted = false,
    externalEvidenceAccepted = false
  ): Promise<BlueprintDetail> {
    return normalizeBlueprintDetail(await publishAssessmentBlueprint(
      revisionId,
      expectedRevision,
      shortfallAccepted,
      externalEvidenceAccepted,
    ));
  }

  /**
   * Discards an uncommitted draft revision.
   */
  static async discardBlueprintDraft(
    revisionId: string,
    expectedRevision: number
  ): Promise<void> {
    return discardAssessmentBlueprintDraft(revisionId, expectedRevision);
  }

  /**
   * Archives an assessment blueprint.
   */
  static async archiveBlueprint(
    blueprintId: string,
    expectedRevision: number
  ): Promise<void> {
    return archiveAssessmentBlueprint(blueprintId, expectedRevision);
  }

  /**
   * Deletes an unused assessment blueprint.
   */
  static async deleteUnusedBlueprint(
    blueprintId: string,
    expectedRevision: number
  ): Promise<void> {
    return deleteUnusedAssessmentBlueprint(blueprintId, expectedRevision);
  }

  /**
   * Hydrates questions from stored revisions into domain AssessmentQuestions.
   */
  static hydrateQuestions(detail: BlueprintDetail): AssessmentQuestion[] {
    const questions: AssessmentQuestion[] = [];
    for (const qr of detail.questions) {
      if (qr.question) {
        questions.push(qr.question);
      } else if ((qr as any).payloadJson) {
        try {
          const decoded = decodeQuestionRevision(
            (qr as any).payloadJson,
            (qr as any).answerKeyJson,
            (qr as any).rubricJson ?? null
          );
          questions.push(decoded.question);
        } catch {
          // Skip corrupt questions in hydration
        }
      }
    }
    return questions;
  }
}
