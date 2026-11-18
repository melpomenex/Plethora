import { invokeCommand } from '../lib/tauri';
import { paidEmbeddingsConsentFlag } from './ai-learning';
import { resolveEmbeddingConfigForRag } from '../components/assistant/ragConfig';
import type {
  AssessmentEligibilityPolicy,
  AssessmentEligibilitySummary,
  FormativeCheckResult,
  FormativeMultipleChoiceQuestion,
  FormativePromptFormat,
  StudyTrailItem,
  StudyTrailItemStatus,
  StudyTrailOverview,
} from '../types/studyTrail';

export interface GenerateStudyTrailInput {
  planId: string;
  versionId: string;
  nodeId?: string;
  objectiveIndex?: number;
  policy?: AssessmentEligibilityPolicy;
}

export interface UpdateTrailProgressInput {
  itemId: string;
  status: StudyTrailItemStatus;
  readingProgress: number;
  lastLocator?: Record<string, unknown> | null;
}

export interface SubmitFormativeCheckInput {
  planId: string;
  versionId: string;
  trailItemId: string;
  nodeId: string;
  objectiveIndex: number;
  promptFormat: FormativePromptFormat;
  promptText: string;
  learnerResponse: string;
  isCorrectChoice?: boolean;
  choiceExplanation?: string;
}

export interface GenerateFormativeMcInput {
  planId: string;
  versionId: string;
  trailItemId: string;
  nodeId: string;
  objectiveIndex: number;
  promptFormat: FormativePromptFormat;
}

export interface OverrideTrailAssignmentInput {
  itemId: string;
  segmentId?: string;
  isRequired?: boolean;
  manualOrderOverride?: number;
  rejectedReason?: string;
}

export async function generateStudyTrailSegments(
  input: GenerateStudyTrailInput,
): Promise<StudyTrailOverview> {
  let embeddingConfig;
  let paidEmbeddingsEnabled = false;
  try {
    embeddingConfig = await resolveEmbeddingConfigForRag();
    paidEmbeddingsEnabled = paidEmbeddingsConsentFlag();
  } catch {
    // Store may be unavailable in isolated test contexts; degrade to local/FTS5.
  }
  return invokeCommand<StudyTrailOverview>('generate_study_trail_segments', {
    input: {
      ...input,
      ...(embeddingConfig ? { embeddingConfig } : {}),
      paidEmbeddingsEnabled,
    },
  });
}

export function getStudyTrailOverview(
  planId: string,
  versionId: string,
  policy?: AssessmentEligibilityPolicy,
): Promise<StudyTrailOverview> {
  return invokeCommand<StudyTrailOverview>('get_study_trail_overview', { planId, versionId, policy });
}

export function updateStudyTrailItemProgress(input: UpdateTrailProgressInput): Promise<void> {
  return invokeCommand<void>('update_study_trail_item_progress', { input });
}

export function submitFormativeCheck(input: SubmitFormativeCheckInput): Promise<FormativeCheckResult> {
  return invokeCommand<FormativeCheckResult>('submit_formative_check', { input });
}

export function generateFormativeMultipleChoice(
  input: GenerateFormativeMcInput,
): Promise<FormativeMultipleChoiceQuestion> {
  return invokeCommand<FormativeMultipleChoiceQuestion>('generate_formative_multiple_choice', { input });
}

export function overrideStudyTrailAssignment(input: OverrideTrailAssignmentInput): Promise<void> {
  return invokeCommand<void>('override_study_trail_assignment', { input });
}

export function checkAssessmentEligibility(
  planId: string,
  versionId: string,
  policy?: AssessmentEligibilityPolicy,
): Promise<AssessmentEligibilitySummary> {
  return invokeCommand<AssessmentEligibilitySummary>('check_assessment_eligibility', { planId, versionId, policy });
}

export function getRemediationTrailItems(planId: string, versionId: string): Promise<StudyTrailItem[]> {
  return invokeCommand<StudyTrailItem[]>('get_remediation_trail_items', { planId, versionId });
}
