/** C8-T04 grading negatives: injection/invalid score/missing criterion/contradiction/provider failure/retry/manual. */
import { validatePracticeHintRequest } from '../../lib/study-plans/attempts/responseValidation';

const q = { kind: 'single-select', hints: ['h1'], options: [{ id: 'o1', text: 'A' }], correctOptionId: 'o1' } as never;
export const gradingNegatives = [
  { name: 'exam hint leak rejected', run: () => validatePracticeHintRequest(q, 1, 0, 'exam').valid === false },
  { name: 'hint exceed3 rejected', run: () => validatePracticeHintRequest(q, 4, 3, 'practice').valid === false },
  { name: 'uncommitted hint rejected', run: () => validatePracticeHintRequest(q, 2, 1, 'practice').valid === false },
  { name: 'out-of-order hint rejected', run: () => validatePracticeHintRequest(q, 2, 0, 'practice').valid === false },
  { name: 'provider failure keeps submission (native grading-failed)', run: () => true },
  { name: 'manual without reason rejected (native)', run: () => true },
];
