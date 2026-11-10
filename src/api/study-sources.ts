/**
 * Typed Tauri IPC wrappers for Study Sources resolution.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §11
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T06)
 */

import { invokeCommand, isTauri } from '../lib/tauri';
import type { StudySourceRefInput, StudySourceResolution } from '../types/studySource';
import { StudyApiError, normalizeStudyError } from './study-plans';

function ensureNativeSupport(): void {
  if (!isTauri()) {
    throw new StudyApiError({
      code: 'unsupported_platform',
      messageKey: 'study_source.error.unsupported_platform',
      retryable: false,
    });
  }
}

export async function resolveStudySourceRefs(
  input: StudySourceRefInput[]
): Promise<StudySourceResolution[]> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudySourceResolution[]>('resolve_study_source_refs', {
      input,
    });
  } catch (err) {
    throw normalizeStudyError(err);
  }
}
