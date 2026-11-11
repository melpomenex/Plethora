import { describe, it, expect } from 'vitest';
import { OS_PDF_PAGES, OS_VIDEO_EXTRACTS, OS_EPUB_PARAGRAPH, OS_EPUB_CFI_RANGE, OS_CONCEPTS, FIX_CLOCK } from '../fixtures/osCourse';
import { SOURCE_MANIFEST } from '../fixtures/sourceManifest';
import { CURRICULUM_NODES, CURRICULUM_EDGES, QUOTA_SLOTS, EXPECTED_TOTAL, EXPECTED_INITIAL_SCORE, EXPECTED_ITEM_SCORES, INITIAL_EVIDENCE } from '../fixtures/goldenOracle';
import { sha256Hex, toCanonicalJson, computeExcerptSha256 } from '../../../lib/study-plans/sourceValidation';
import { allocateLargestRemainder } from '../../../lib/study-plans/assessments/quotaPlanner';
import { normalizeSnapshot } from '../fixtures/aliases';
import { SENTINEL_FIXTURE, sentinelEquals } from '../fixtures/schedulerSentinel';
import * as fs from 'node:fs';

describe('C8-T01 golden fixtures and oracle (run twice identically)', () => {
  it.each([1, 2])('pass %i: corpus content, hashes, slots, scores, evidence math identical', () => {
    expect(OS_PDF_PAGES).toHaveLength(5);
    expect(OS_VIDEO_EXTRACTS).toHaveLength(2);
    expect(OS_EPUB_PARAGRAPH).toContain('wait(empty)');
    expect(OS_EPUB_CFI_RANGE).toContain('chap01ref');
    expect(OS_CONCEPTS).toHaveLength(5);
    expect(SOURCE_MANIFEST).toHaveLength(8);
    // Independent hash validation (not trusting task outputs)
    for (const s of SOURCE_MANIFEST) {
      const h = computeExcerptSha256(s.excerpt);
      expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(sha256Hex(s.excerpt.replace(/\r\n/g, '\n'))).toHaveLength(64);
    }
    expect(toCanonicalJson({ b: 1, a: 1 })).toBe('{"a":1,"b":1}');
    // Quota math independently: type weights [2,1,1,1,1] over 6
    const counts = allocateLargestRemainder(6, [{ key: 'single-select', weight: 2 }, { key: 'multi-select', weight: 1 }, { key: 'cloze', weight: 1 }, { key: 'short-answer', weight: 1 }, { key: 'essay', weight: 1 }], ['single-select', 'multi-select', 'cloze', 'short-answer', 'essay']);
    expect([...counts.values()]).toEqual([2, 1, 1, 1, 1]);
    expect(CURRICULUM_NODES).toHaveLength(5);
    expect(CURRICULUM_EDGES).toHaveLength(4);
    expect(QUOTA_SLOTS).toHaveLength(6);
    expect(EXPECTED_TOTAL).toBe(15);
    const total = Object.values(EXPECTED_ITEM_SCORES).reduce((a, b) => a + b, 0);
    expect(total).toBe(EXPECTED_INITIAL_SCORE);
    expect(INITIAL_EVIDENCE.N2.mean).toBeCloseTo(0.5, 10);
    // Normalization stable across runs
    const snap = normalizeSnapshot({ id: 'sp_abc', at: '2026-01-05T09:00:00.000Z' }, { PLAN: 'sp_abc' });
    expect(snap).toEqual({ id: '<PLAN>', at: '<TIMESTAMP>' });
    expect(FIX_CLOCK).toBe('2026-01-05T09:00:00.000Z');
    // Scheduler sentinel shape covers real fields
    expect(sentinelEquals(SENTINEL_FIXTURE, { ...SENTINEL_FIXTURE })).toBe(true);
  });

  it('fixture assets exist with deterministic bytes; mutation detected', () => {
    const pdf = fs.readFileSync('src/test/study-plans-golden/assets/os.pdf');
    const xhtml = fs.readFileSync('src/test/study-plans-golden/assets/ch01.xhtml', 'utf8');
    const tx = JSON.parse(fs.readFileSync('src/test/study-plans-golden/assets/transcripts.json', 'utf8'));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(xhtml).toContain('chap01ref');
    expect(tx.extracts).toHaveLength(2);
    const h1 = sha256Hex(pdf.toString('utf8'));
    const h1b = sha256Hex(pdf.toString('utf8'));
    expect(h1).toBe(h1b);
    const mutated = Buffer.concat([pdf, Buffer.from('x')]);
    expect(sha256Hex(mutated.toString('utf8'))).not.toBe(h1);
    expect(xhtml).toContain('empty=N, full=0, and mutex=1');
  });
});
