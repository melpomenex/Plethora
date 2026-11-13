import type { AssessmentConfigV1, QuestionKind } from '../../../types/assessmentQuestions';

export const DIAGNOSTIC_MIN_COUNT = 4;
export const DIAGNOSTIC_MAX_COUNT = 12;
export const DIAGNOSTIC_DEFAULT_COUNT = 6;

export const DIAGNOSTIC_ALLOWED_KINDS: QuestionKind[] = [
  'single-select',
  'multi-select',
  'cloze',
  'short-answer',
];

export interface DiagnosticConfigIssue {
  path: string;
  code: string;
  messageKey: string;
}

export function buildDefaultDiagnosticConfig(): AssessmentConfigV1 {
  return {
    schemaVersion: 1,
    mode: 'diagnostic',
    requestedCount: DIAGNOSTIC_DEFAULT_COUNT,
    typeWeights: {
      'single-select': 2,
      'multi-select': 1,
      cloze: 1,
      'short-answer': 2,
    } as never,
    difficultyWeights: { '2': 1, '3': 2, '4': 2 } as never,
    topicTargets: [],
    timeLimitSeconds: null,
    knowledgePolicy: 'source-only',
    excludedQuestionFingerprints: [],
    pointsByKind: {
      'single-select': 1,
      'multi-select': 2,
      cloze: 2,
      'short-answer': 2,
      essay: 8,
    } as never,
  };
}

/**
 * Builds a diagnostic config bound to a Study Plan version (task 2.3).
 * The knowledge policy mirrors the plan authority: model-only plans get an
 * unverified self-check policy; library plans stay source-only. Topic targets
 * are left empty so the diagnostic covers the provisional curriculum.
 */
export function buildPlanDiagnosticConfig(
  planDetail: { version: { knowledgeAuthority: { kind: string; policy?: string } } }
): AssessmentConfigV1 {
  const base = buildDefaultDiagnosticConfig();
  const authority = planDetail.version.knowledgeAuthority;
  return {
    ...base,
    knowledgePolicy: authority.kind === 'model-only' ? 'model-only' : 'source-only',
  };
}

export function validateDiagnosticConfig(config: AssessmentConfigV1): {
  ok: boolean;
  issues: DiagnosticConfigIssue[];
} {
  const issues: DiagnosticConfigIssue[] = [];
  if (config.mode !== 'diagnostic') {
    issues.push({
      path: 'mode',
      code: 'invalid_mode',
      messageKey: 'study.diagnostic.error.invalid_mode',
    });
  }
  if (
    !Number.isInteger(config.requestedCount) ||
    config.requestedCount < DIAGNOSTIC_MIN_COUNT ||
    config.requestedCount > DIAGNOSTIC_MAX_COUNT
  ) {
    issues.push({
      path: 'requestedCount',
      code: 'invalid_count',
      messageKey: 'study.diagnostic.error.invalid_count',
    });
  }
  const weights = config.typeWeights as Record<string, number>;
  for (const [kind, w] of Object.entries(weights ?? {})) {
    if ((w ?? 0) > 0 && (kind === 'essay' || !DIAGNOSTIC_ALLOWED_KINDS.includes(kind as QuestionKind))) {
      issues.push({
        path: `typeWeights.${kind}`,
        code: 'essay_rejected',
        messageKey: 'study.diagnostic.error.essay_rejected',
      });
    }
  }
  if (config.timeLimitSeconds !== null) {
    issues.push({
      path: 'timeLimitSeconds',
      code: 'timer_rejected',
      messageKey: 'study.diagnostic.error.timer_rejected',
    });
  }
  return { ok: issues.length === 0, issues };
}

export function validatePracticeTimer(config: AssessmentConfigV1): boolean {
  if (config.mode !== 'practice') return true;
  return config.timeLimitSeconds === null;
}
