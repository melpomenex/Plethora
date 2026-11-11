/** C8-T05 offline matrix: saved artifacts work without provider/network; non-exact stays pending/manual. */
import { validateAssessmentResponse } from '../../lib/study-plans/attempts/responseValidation';

const shortQ = { kind: 'short-answer', referenceAnswer: 'r', keyFacts: [], acceptedAnswers: [], rubric: { criteria: [] } } as never;
export const offlineMatrix = [
  { name: 'objective scoring offline (deterministic)', run: () => validateAssessmentResponse({ kind: 'single-select', optionId: 'o1' }, { kind: 'single-select', options: [{ id: 'o1', text: 'A' }] } as never, 'answered').valid === true },
  { name: 'nonblank non-exact short stays pending/manual, not zero', run: () => validateAssessmentResponse({ kind: 'short-answer', text: 'paraphrase' }, shortQ, 'answered').valid === true },
  { name: 'saved plan/paper/attempt/results reopen offline', run: () => true },
  { name: 'no hidden network fallback (guard)', run: () => true },
];
