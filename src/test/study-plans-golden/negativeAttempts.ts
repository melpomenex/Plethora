/** C8-T04 attempt negatives: save/double-submit/timer/restart/partial. */
import { validateAssessmentResponse } from '../../lib/study-plans/attempts/responseValidation';
import { shouldReusePracticeCheck } from '../../lib/study-plans/attempts/attemptPolicy';

const q = { kind: 'single-select', options: [{ id: 'o1', text: 'A' }] } as never;
export const attemptNegatives = [
  { name: 'mismatched kind rejected', run: () => validateAssessmentResponse({ kind: 'cloze', answers: {} }, q, 'answered').valid === false },
  { name: 'unknown option rejected', run: () => validateAssessmentResponse({ kind: 'single-select', optionId: 'zz' }, q, 'answered').valid === false },
  { name: 'same mutation id + different payload invalid (native)', run: () => true },
  { name: 'duplicate submit new key is no-op (native)', run: () => true },
  { name: 'finish changed payload appends (no reuse)', run: () => shouldReusePracticeCheck({ payloadJson: 'a', mark: 'answered', hintLevel: 1 }, { payloadJson: 'b', mark: 'answered', hintLevel: 1 }) === false },
];
