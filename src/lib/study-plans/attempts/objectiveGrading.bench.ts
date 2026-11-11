/** C8-T07 objective grading bench: 40 items. */
import { bench } from 'vitest';
import { seededRandom } from '../../../test/bench-support';
import { gradeQuestionObjective } from './objectiveGrading';

const rand = seededRandom(0xc80703);
const drafts = Array.from({ length: 40 }, () => (rand() < 0.5 ? { kind: 'single-select', optionId: 'o1' } : { kind: 'single-select', optionId: 'o2' }));
const question = { kind: 'single-select', maxPoints: 1, options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }], correctOptionId: 'o1' };

let sink: unknown;
bench('study-plans/objective-grading-40-items', () => {
  let total = 0;
  for (let i = 0; i < drafts.length; i++) total += gradeQuestionObjective(question as never, drafts[i] as never, 'answered', `q${i}`).points ?? 0;
  sink = total;
});
void sink;
