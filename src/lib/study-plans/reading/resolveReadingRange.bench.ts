import { bench, describe } from 'vitest';
import { seededRandom } from '../../../test/bench-support';
import { normalizeReadingQuote, uniqueQuote } from './resolveReadingRange';

const random = seededRandom(483104);
const pages = Array.from({ length: 1800 }, (_, index) =>
  `Paragraph ${index} belongs to chapter ${Math.floor(random() * 100)} of the reader.`,
);
const section = normalizeReadingQuote(pages.join(' '));
const quote = { exact: 'of the reader.', prefix: pages[847].replace(' of the reader.', '') };
let sink = '';
describe('Guided Reading quote lookup', () => {
  bench('resolve a bounded chapter with duplicate phrases', () => {
    const result = uniqueQuote(section, quote);
    sink = result.status;
  });
});
void sink;
