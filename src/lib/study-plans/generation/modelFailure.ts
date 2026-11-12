import { warn } from '@tauri-apps/plugin-log';
import type { StudyCommandError } from '../../../types/learningPaths';
import { isTauri } from '../../tauri';
import type { AIError } from '../../ai/errors';
import { sanitizeCompletionRecovery } from '../../ai/tasks/completion';

export const MALFORMED_OUTPUT = {
  code: 'invalid_model_output',
  messageKey: 'study_generation.error.malformed_output',
  retryable: true,
} as const;

export function modelFailure(error: AIError): StudyCommandError {
  if (error.code === 'timeout') {
    return { code: 'model_timeout', messageKey: 'study_generation.error.model_timeout', retryable: true };
  }
  switch (error.category) {
    case 'InvalidStructuredOutput':
      if (error.completion?.outputLimitObserved || error.completion?.finishReason === 'length') {
        return { code: 'invalid_model_output', messageKey: 'study_generation.error.output_truncated', retryable: true };
      }
      return MALFORMED_OUTPUT;
    case 'InputTooLarge':
      return { code: 'provider_capability_missing', messageKey: 'study_generation.error.model_context_too_small', retryable: false };
    case 'Cancelled':
      return { code: 'cancelled', messageKey: 'study_generation.error.cancelled', retryable: false };
    case 'SafetyBlocked':
    case 'PermissionDenied':
      return { code: 'provider_unavailable', messageKey: 'study_generation.error.model_declined', retryable: false };
    default:
      return { code: 'provider_unavailable', messageKey: 'study_generation.error.model_request_failed', retryable: true };
  }
}

export function logModelFailure(jobId: string, stepKey: string, error: AIError): void {
  const diagnostic = {
    jobId,
    stepKey,
    category: error.category,
    messageKey: modelFailure(error).messageKey,
    ...(error.completion && sanitizeCompletionRecovery(error.completion)),
  };
  if (isTauri()) void warn(`[study-plans] Curriculum model failure ${JSON.stringify(diagnostic)}`).catch(() => undefined);
}
