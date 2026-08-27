import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ESSAY_ROUTE_ALLOWLIST,
  findEssayViolations,
  findSurfaceUsages,
} from '../../scripts/lib/copy-terms.mjs';

const FIXTURE_PATH = '/tmp/whatever/website/dist/index.html';

describe('terminology gate: essay scan', () => {
  it('fails user-facing essay copy in served markup', () => {
    const html = '<body><p>The walkthrough follows one essay on sleep.</p></body>';
    const violations = findEssayViolations(html, FIXTURE_PATH);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].word, 'essay');
    assert.match(violations[0].context, /walkthrough follows one essay/);
  });

  it('catches the plural too', () => {
    const html = '<main><h2>Highlight your essays.</h2></main>';
    const violations = findEssayViolations(html, FIXTURE_PATH);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].word, 'essays');
  });

  it('ignores script bodies (client templates are not served copy)', () => {
    const html = `<body><script>const t = \`essay \${x}\`;</script><p>One document.</p></body>`;
    assert.deepEqual(findEssayViolations(html, FIXTURE_PATH), []);
  });

  it('allows the documented generic-genre listing on /readers', () => {
    assert.ok(ESSAY_ROUTE_ALLOWLIST.includes('/readers'));
    const html = '<p>Books, essays, and papers stay in a local library.</p>';
    assert.deepEqual(
      findEssayViolations(html, '/site/dist/readers/index.html'),
      [],
    );
  });

  it('exempts changelog historical quotes', () => {
    const html = '<p>Back then the docs called it an essay.</p>';
    assert.deepEqual(
      findEssayViolations(html, '/site/dist/changelog/index.html'),
      [],
    );
  });

  it('does not flag substrings like "essays" inside other words', () => {
    const html = '<p>cactus essaysandmore</p>';
    // 'essaysandmore' is a single word; \\b requires a boundary after "essay(s)".
    const violations = findEssayViolations(html, FIXTURE_PATH);
    assert.deepEqual(violations, []);
  });
});

describe('terminology gate: surface report mode', () => {
  it('reports hardware-meaning surface usage without failing', () => {
    const html = '<p>Available on compatible reading surfaces.</p>';
    const usages = findSurfaceUsages(html, FIXTURE_PATH);
    assert.equal(usages.length, 1);
    assert.equal(usages[0].word, 'surfaces');
    assert.match(usages[0].context, /compatible reading surfaces/);
  });

  it('reports nothing when scripts use the word internally', () => {
    const html = '<script>const surface = "reader";</script><p>Across your devices.</p>';
    assert.deepEqual(findSurfaceUsages(html, FIXTURE_PATH), []);
  });

  it('resolves routes from nested dist paths', () => {
    const html = '<p>a surface</p>';
    const usages = findSurfaceUsages(html, '/site/dist/docs/some-guide/index.html');
    assert.equal(usages[0].route, '/docs/some-guide');
  });
});
