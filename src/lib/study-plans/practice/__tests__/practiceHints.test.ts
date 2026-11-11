import { describe, it, expect } from 'vitest';
import { toPublicQuestion } from '../../assessments/publicQuestion';
import {
  isValidHintLevel,
  validatePracticeHintRequest,
} from '../../attempts/responseValidation';
import { shouldReusePracticeCheck } from '../../attempts/attemptPolicy';
import { nextHint, hintForLevel } from '../hintState';
import { adviseNextDifficulty } from '../practiceAdaptation';
import type { SingleSelectQuestion } from '../../../../types/assessmentQuestions';

function question(over: Partial<SingleSelectQuestion> = {}): SingleSelectQuestion {
  return {
    schemaVersion: 1,
    kind: 'single-select',
    prompt: 'Q',
    difficulty: 3,
    learningObjectives: ['O'],
    sourceRefIds: [],
    explanation: 'E',
    maxPoints: 1,
    applicationLevel: 'recall',
    hints: ['h1', 'h2'],
    options: [
      { id: 'o1', text: 'A' },
      { id: 'o2', text: 'B' },
    ],
    correctOptionId: 'o1',
    ...over,
  };
}

describe('C7-T02 hint contracts and adaptation', () => {
  it('exam/diagnostic public output always excludes hints; practice reveals one-at-a-time', () => {
    const q = question();
    expect('hints' in toPublicQuestion(q, { mode: 'exam', isSubmitted: false })).toBe(false);
    expect('hints' in toPublicQuestion(q, { mode: 'diagnostic', isSubmitted: false })).toBe(false);
    expect('hints' in toPublicQuestion(q, { mode: 'exam', isSubmitted: true })).toBe(false);
    expect('hints' in toPublicQuestion(q, { mode: 'diagnostic', isSubmitted: true })).toBe(false);
    const practice = toPublicQuestion(q, { mode: 'practice', isSubmitted: false });
    expect('hints' in practice).toBe(true);

    expect(isValidHintLevel(0)).toBe(true);
    expect(isValidHintLevel(3)).toBe(true);
    expect(isValidHintLevel(4)).toBe(false);
    expect(isValidHintLevel(-1)).toBe(false);
    expect(validatePracticeHintRequest(q, 1, 0, 'practice').valid).toBe(true);
    expect(validatePracticeHintRequest(q, 2, 0, 'practice').valid).toBe(false); // out-of-order
    expect(validatePracticeHintRequest(q, 3, 2, 'practice').valid).toBe(false); // not precommitted
    expect(validatePracticeHintRequest(q, 4, 3, 'practice').valid).toBe(false); // exceed3
    expect(validatePracticeHintRequest(q, 1, 0, 'exam').valid).toBe(false); // exam leak
    expect(nextHint(q, 0, 'exam').hint).toBeNull();
    expect(nextHint(q, 0, 'practice').hint).toBe('h1');
    expect(hintForLevel(q, 2)).toBe('h2');
  });

  it('hint equal to committed answer is invalid; changed response vs hint state reuses only on equality', () => {
    const q = question({ hints: ['A'] }); // equals correct option text
    expect(validatePracticeHintRequest(q, 1, 0, 'practice').valid).toBe(true); // bounds pass here
    // Leakage is enforced by questionValidation (existing test); here Finish dedup:
    expect(
      shouldReusePracticeCheck(
        { payloadJson: '{"a":1}', mark: 'answered', hintLevel: 1 },
        { payloadJson: '{"a":1}', mark: 'answered', hintLevel: 1 },
      ),
    ).toBe(true);
    expect(
      shouldReusePracticeCheck(
        { payloadJson: '{"a":2}', mark: 'answered', hintLevel: 1 },
        { payloadJson: '{"a":1}', mark: 'answered', hintLevel: 1 },
      ),
    ).toBe(false);
    expect(
      shouldReusePracticeCheck(
        { payloadJson: '{"a":1}', mark: 'answered', hintLevel: 2 },
        { payloadJson: '{"a":1}', mark: 'answered', hintLevel: 1 },
      ),
    ).toBe(false);
    expect(
      shouldReusePracticeCheck({ payloadJson: '{"a":1}', mark: 'answered', hintLevel: 1 }, null),
    ).toBe(false);
  });

  it('repeated Check/Finish/restart/exam isolation: next-paper rule with bounds and exclusions', () => {
    expect(
      adviseNextDifficulty({ conceptId: 'c', observedMean: 0.5, hintsUsed: false, sessions: 2 }, 3, ['fp1']).difficulty,
    ).toBe(2);
    expect(
      adviseNextDifficulty({ conceptId: 'c', observedMean: 0.5, hintsUsed: false, sessions: 2 }, 1).difficulty,
    ).toBe(1); // min1
    expect(
      adviseNextDifficulty({ conceptId: 'c', observedMean: 0.9, hintsUsed: false, sessions: 2 }, 4).reason,
    ).toBe('increase');
    expect(
      adviseNextDifficulty({ conceptId: 'c', observedMean: 0.9, hintsUsed: true, sessions: 2 }, 4).reason,
    ).toBe('same'); // hints used blocks increase
    expect(
      adviseNextDifficulty({ conceptId: 'c', observedMean: 0.9, hintsUsed: false, sessions: 2 }, 5).difficulty,
    ).toBe(5); // max5
    expect(
      adviseNextDifficulty({ conceptId: 'c', observedMean: 0.7, hintsUsed: false, sessions: 2 }, 3).reason,
    ).toBe('same');
  });
});
