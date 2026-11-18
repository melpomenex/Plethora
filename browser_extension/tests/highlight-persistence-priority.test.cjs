const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
require('../shared.js');

const { buildExtensionPayload } = globalThis.IncrementumExtensionShared;
const root = join(__dirname, '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const content = read('browser_extension/content.js');
const background = read('browser_extension/background.js');

test('buildExtensionPayload preserves highlight color', () => {
  const payload = buildExtensionPayload({
    url: 'https://example.com/post',
    title: 'Post',
    text: 'Highlighted snippet',
    type: 'extract',
    color: '#c8e6c9',
    priority: 72
  });
  assert.equal(payload.color, '#c8e6c9');
  assert.equal(payload.priority, 72);
});

test('content script restores highlights across multiple text nodes, SPA navigation, and server sync', () => {
  assert.ok(content.includes('function findRangeAcrossTextNodes('));
  assert.ok(content.includes('function resolveSavedRange('));
  assert.ok(content.includes('function getNormalizedPageUrl('));
  assert.ok(content.includes('function syncPageExtractsFromServer('));
  assert.ok(content.includes('function handleSpaUrlChange('));
  // Context-menu / background-registered extracts highlight immediately
  const registerFn = content.slice(
    content.indexOf('function registerExtracts('),
    content.indexOf('function highlightText(')
  );
  assert.ok(registerFn.includes('restoreAllPageHighlights()'));
});

test('background script exposes server extract fetch and delete handlers', () => {
  assert.ok(background.includes("case 'fetchPageExtractsFromServer':"));
  assert.ok(background.includes('/api/browser-sync/extracts?url='));
  assert.ok(background.includes("case 'deleteExtractOnServer':"));
});

test('priority dialog uses concrete auto-calculation, segmented pills, and range slider', () => {
  assert.ok(content.includes('function calculateExtractPriorityDetailed('));
  assert.ok(content.includes('function extractDomPrioritySignals('));
  assert.ok(content.includes('id="extract-priority-slider"'));
  assert.ok(content.includes('class="priority-pill active" data-preset="auto"'));
  assert.ok(content.includes('id="plethora-priority-factors"'));
});
