/** C8-T04 question negatives: invalid keys/multi/cloze/rubric/duplicate/quota/malformed. */
import { validateAssessmentQuestion } from '../../lib/study-plans/assessments/questionValidation';

function single(over: Record<string, unknown> = {}) {
  return { schemaVersion: 1, kind: 'single-select', prompt: 'p', difficulty: 2, learningObjectives: ['o'], sourceRefIds: [], explanation: 'e', maxPoints: 1, applicationLevel: 'recall', hints: [], options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }], correctOptionId: 'o1', ...over } as never;
}
export const questionNegatives = [
  { name: 'unknown correct id', run: () => validateAssessmentQuestion(single({ correctOptionId: 'zz' })).valid === false },
  { name: 'duplicate option ids leak impossible (validator: dup text)', run: () => validateAssessmentQuestion(single({ options: [{ id: 'o1', text: 'A' }, { id: 'o1', text: 'A' }] })).valid === false },
  { name: 'hint equals answer rejected', run: () => validateAssessmentQuestion(single({ hints: ['A'] })).valid === false },
  { name: 'more than 3 hints rejected', run: () => validateAssessmentQuestion(single({ hints: ['1', '2', '3', '4'] })).valid === false },
  { name: 'empty prompt rejected', run: () => validateAssessmentQuestion(single({ prompt: '' })).valid === false },
];
