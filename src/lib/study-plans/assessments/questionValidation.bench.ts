/** C8-T07 question validation bench: 40 items. */
import { bench } from 'vitest';
import { seededRandom } from '../../../test/bench-support';
import { validateAssessmentQuestion } from './questionValidation';

const rand = seededRandom(0xc80702);
const items = Array.from({ length: 40 }, (_, i) => ({
  schemaVersion: 1,
  kind: 'single-select',
  prompt: `Prompt ${i} ${'x'.repeat(20)}`,
  difficulty: 1 + Math.floor(rand() * 5),
  learningObjectives: ['Objective one'],
  sourceRefIds: [],
  explanation: 'e',
  maxPoints: 1,
  applicationLevel: 'recall',
  hints: [],
  options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }],
  correctOptionId: 'o1',
}));

let sink: unknown;
bench('study-plans/question-validation-40-items', () => {
  let valid = 0;
  for (const q of items) valid += validateAssessmentQuestion(q as never).valid ? 1 : 0;
  sink = valid;
});
void sink;
