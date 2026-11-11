import type { AssessmentQuestion } from '../../../types/assessmentQuestions';
import { isValidHintLevel, validatePracticeHintRequest } from '../attempts/responseValidation';

export interface HintRevealState {
  revealed: number;
  total: number;
}

export function getHintState(question: AssessmentQuestion, revealed: number): HintRevealState {
  const total = Array.isArray(question.hints) ? question.hints.length : 0;
  return { revealed: Math.max(0, Math.min(revealed, total)), total };
}

export function nextHint(
  question: AssessmentQuestion,
  revealed: number,
  mode: 'exam' | 'practice' | 'diagnostic',
): { hint: string | null; revealed: number } {
  if (mode !== 'practice') return { hint: null, revealed };
  if (!isValidHintLevel(revealed + 1)) return { hint: null, revealed };
  const check = validatePracticeHintRequest(question, revealed + 1, revealed, mode);
  if (!check.valid) return { hint: null, revealed };
  const hints = question.hints ?? [];
  return { hint: hints[revealed] ?? null, revealed: revealed + 1 };
}

export function hintForLevel(question: AssessmentQuestion, level: number): string | null {
  if (!isValidHintLevel(level) || level === 0) return null;
  const hints = question.hints ?? [];
  return hints[level - 1] ?? null;
}
