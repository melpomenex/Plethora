/**
 * Typed Tauri IPC wrappers for Study Plans lifecycle management.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §11
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T06)
 */

import { invokeCommand, isTauri } from '../lib/tauri';
import type {
  CreateStudyPlanInput,
  LegacyImportResult,
  NodeActivity,
  RenameStudyPlanInput,
  SaveStudyPlanDraftInput,
  StudyCommandError,
  StudyPlan,
  StudyPlanDetail,
  StudyPlanSummary,
} from '../types/learningPaths';

export class StudyApiError extends Error implements StudyCommandError {
  code: StudyCommandError['code'];
  messageKey: string;
  retryable: boolean;
  fieldIssues?: StudyCommandError['fieldIssues'];
  details?: StudyCommandError['details'];

  constructor(error: StudyCommandError) {
    super(error.messageKey);
    this.name = 'StudyApiError';
    this.code = error.code;
    this.messageKey = error.messageKey;
    this.retryable = error.retryable;
    this.fieldIssues = error.fieldIssues;
    this.details = error.details;
    Object.setPrototypeOf(this, StudyApiError.prototype);
  }
}

export function normalizeStudyError(err: unknown): StudyApiError {
  if (err instanceof StudyApiError) {
    return err;
  }
  if (typeof err === 'object' && err !== null && 'code' in err && 'messageKey' in err) {
    return new StudyApiError(err as StudyCommandError);
  }
  // If Tauri error wrapper wrapped the error into Error with message
  const msg = err instanceof Error ? err.message : String(err || 'Unknown error');
  return new StudyApiError({
    code: 'storage_failed',
    messageKey: msg,
    retryable: true,
  });
}

function ensureNativeSupport(): void {
  if (!isTauri()) {
    throw new StudyApiError({
      code: 'unsupported_platform',
      messageKey: 'study_plan.error.unsupported_platform',
      retryable: false,
    });
  }
}

export async function createStudyPlan(input: CreateStudyPlanInput): Promise<StudyPlanDetail> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudyPlanDetail>('create_study_plan', { input });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function listStudyPlans(includeArchived = false): Promise<StudyPlanSummary[]> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudyPlanSummary[]>('list_study_plans', { includeArchived });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function getStudyPlan(planId: string, versionId?: string | null): Promise<StudyPlanDetail> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudyPlanDetail>('get_study_plan', {
      planId,
      versionId: versionId ?? null,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function saveStudyPlanDraft(input: SaveStudyPlanDraftInput): Promise<StudyPlanDetail> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudyPlanDetail>('save_study_plan_draft', { input });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function renameStudyPlan(input: RenameStudyPlanInput): Promise<StudyPlan> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudyPlan>('rename_study_plan', { input });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function publishStudyPlanVersion(
  planId: string,
  draftVersionId: string,
  expectedPlanRevision: number
): Promise<StudyPlanDetail> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudyPlanDetail>('publish_study_plan_version', {
      planId,
      draftVersionId,
      expectedPlanRevision,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function discardStudyPlanDraft(
  planId: string,
  expectedPlanRevision: number
): Promise<StudyPlanDetail> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudyPlanDetail>('discard_study_plan_draft', {
      planId,
      expectedPlanRevision,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function setStudyPlanNodeActivity(
  planId: string,
  nodeId: string,
  activity: NodeActivity,
  expectedPlanRevision: number
): Promise<StudyPlanDetail> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudyPlanDetail>('set_study_plan_node_activity', {
      planId,
      nodeId,
      activity,
      expectedPlanRevision,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function archiveStudyPlan(
  planId: string,
  expectedPlanRevision: number
): Promise<void> {
  ensureNativeSupport();
  try {
    await invokeCommand<void>('archive_study_plan', {
      planId,
      expectedPlanRevision,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function deleteStudyPlan(
  planId: string,
  expectedPlanRevision: number
): Promise<void> {
  ensureNativeSupport();
  try {
    await invokeCommand<void>('delete_study_plan', {
      planId,
      expectedPlanRevision,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function importLegacyStudyPlans(
  payload: string,
  importHash: string
): Promise<LegacyImportResult> {
  ensureNativeSupport();
  try {
    return await invokeCommand<LegacyImportResult>('import_legacy_study_plans', {
      payload,
      importHash,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export interface StudyPlanPreferences {
  deadline?: string | null;
  restDays?: number[];
}

export async function getStudyPlanPreferences(planId: string): Promise<StudyPlanPreferences> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudyPlanPreferences>('get_study_plan_preferences', { planId });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}

export async function updateStudyPlanPreferences(
  planId: string,
  preferences: StudyPlanPreferences
): Promise<StudyPlanPreferences> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudyPlanPreferences>('update_study_plan_preferences', {
      planId,
      preferences,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}
