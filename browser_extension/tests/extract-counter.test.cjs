/**
 * Extract-counter accounting tests (requirement #16). The visible "Extracts"
 * counter is DERIVED from the content script's `pageExtracts` array
 * (`getPageStats()` -> `pageExtracts.length`), persisted per-host in
 * localStorage. The context-menu / quick-extract command flow creates the
 * extract in the background and then registers it into the tab's
 * `pageExtracts` via a `registerExtracts` message — only on server success,
 * exactly once.
 *
 * The content script's `registerExtracts()` mirrors `mergeExtracts()` in
 * shared.js (see the keep-in-sync comment on both), so these tests exercise
 * the real accounting helpers plus source-contract wiring checks for the
 * parts that only exist in the browser (chrome.*, DOM).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
require('../shared.js');
const {
  mergeExtracts,
  normalizeExtractRecord,
  createMutex
} = globalThis.IncrementumExtensionShared;

const root = join(__dirname, '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const background = read('browser_extension/background.js');
const content = read('browser_extension/content.js');
const popup = read('browser_extension/popup.js');

// The content script's registerExtracts() and shared.mergeExtracts() are the
// same algorithm (mirrored across the two contexts by hand). Exercise it
// through this wrapper so the scenarios below map 1:1 onto the content
// script's pageExtracts behavior.
function registerInPage(pageExtracts, records) {
  const { merged, added } = mergeExtracts(pageExtracts, records);
  return { pageExtracts: merged, addedCount: added.length };
}

function pageStats(pageExtracts) {
  return { success: true, extractsCount: pageExtracts.length, extracts: pageExtracts };
}

function record(id, overrides = {}) {
  return normalizeExtractRecord(
    { text: `selection ${id}`, url: 'https://example.com/article', title: 'Article' },
    { id, ...overrides }
  );
}

test('normal extraction path pushes to pageExtracts and persists (regression)', () => {
  // The popup/selection flow calls content.js createExtract(), which pushes
  // into pageExtracts and saves before informing the background.
  assert.ok(content.includes('pageExtracts.push(extractData);'));
  assert.ok(content.includes('savePageExtracts();'));
  assert.ok(content.includes('action: \'saveExtract\''));
  // Its counter contribution is derived from the same array the popup reads.
  const before = [];
  const { pageExtracts, addedCount } = registerInPage(before, [record('r1')]);
  assert.equal(addedCount, 1);
  assert.equal(pageStats(pageExtracts).extractsCount, 1);
});

test('a successful context-menu extract increments exactly once', () => {
  // One server-confirmed record arrives from the background.
  const r1 = record('server-extract-1');
  let state = registerInPage([], [r1]);
  assert.equal(state.addedCount, 1);
  assert.equal(pageStats(state.pageExtracts).extractsCount, 1);

  // Re-delivery of the SAME extract id (e.g. a retried tab message) must not
  // double-count — the dedupe-by-id rule is exactly-once.
  state = registerInPage(state.pageExtracts, [r1, r1]);
  assert.equal(state.addedCount, 0);
  assert.equal(pageStats(state.pageExtracts).extractsCount, 1);
});

test('background only registers after server success and never for the queued/offline branch', () => {
  // Registration is gated on result.success and excludes the queued path, so
  // a rejected/offline create never reaches the content script.
  assert.ok(background.includes('const shouldRegister = Boolean(result.success && !result.queued && tab?.id)'));
  const gateIndex = background.indexOf('if (shouldRegister) {');
  const persistIndex = background.indexOf('await persistExtractRegistration(tab.id, record);');
  const notifyIndex = background.indexOf('await notifyTabRegisterExtract(tab.id, record);');
  assert.ok(gateIndex !== -1 && persistIndex > gateIndex && notifyIndex > gateIndex);
  // The queued branch returns before any registration helper is reached.
  assert.ok(background.indexOf("queued: true") < gateIndex);
});

test('failed/rejected extraction leaves the counter unchanged', () => {
  const before = [record('existing')];
  // No record is produced for a failed create, so nothing merges in.
  const state = registerInPage(before, []);
  assert.equal(state.addedCount, 0);
  assert.equal(pageStats(state.pageExtracts).extractsCount, 1);
  // Records without an id are never merged either (dedupe key integrity).
  const bad = registerInPage(before, [{ text: 'no id' }]);
  assert.equal(bad.addedCount, 0);
  assert.equal(pageStats(bad.pageExtracts).extractsCount, 1);
});

test('multiple extracts are all counted', () => {
  const incoming = Array.from({ length: 5 }, (_, i) => record(`multi-${i}`));
  const state = registerInPage([], incoming);
  assert.equal(state.addedCount, 5);
  assert.equal(pageStats(state.pageExtracts).extractsCount, 5);
});

test('popup reopened after extraction reports the updated count', () => {
  // The popup reads the tab's pageExtracts via getPageStats every time it
  // opens, so state persisted in the tab is what the counter reflects.
  const tabExtracts = [record('open-1'), record('open-2')];
  const stats = pageStats(tabExtracts);
  assert.equal(stats.extractsCount, 2);
  // popup.js loadStats() is invoked on every open and pulls getPageStats.
  assert.ok(popup.includes('action: \'getPageStats\''));
  assert.ok(popup.includes('await this.loadStats();'));
  // And the content script answers getPageStats from pageExtracts.length.
  assert.ok(content.includes('extractsCount: pageExtracts.length'));
});

test('service-worker restart loses nothing and double-counts nothing', () => {
  // Restart window A: the background persisted the record but died before
  // telling the content script. On restart it re-delivers into a tab that
  // never saw it -> exactly one registration (no loss).
  const r1 = record('restart-1');
  const pendingAfterRestart = [r1];
  const unawareTab = registerInPage([], pendingAfterRestart);
  assert.equal(unawareTab.addedCount, 1);
  assert.equal(pageStats(unawareTab.pageExtracts).extractsCount, 1);

  // Restart window B: the content script got the registration before the
  // restart, but the background still owes the (persisted) record. Re-delivery
  // merges into a tab that already has it -> zero new registrations (no double).
  const awareTab = registerInPage([r1], pendingAfterRestart);
  assert.equal(awareTab.addedCount, 0);
  assert.equal(pageStats(awareTab.pageExtracts).extractsCount, 1);

  // Wiring: the background persists pending registrations and re-flushes them
  // on startup / install / keep-alive.
  assert.ok(background.includes("PENDING_EXTRACT_REGISTRATIONS_KEY"));
  const flushCalls = (background.match(/await flushPendingExtractRegistrations\(\);/g) || []).length;
  assert.ok(flushCalls >= 3, `expected startup/install/keep-alive flush calls, found ${flushCalls}`);
  assert.ok(background.includes("chrome.runtime.onStartup.addListener"));
  assert.ok(background.includes("action: 'registerExtracts'"));
  assert.ok(background.includes("parsed.extract_id"));
});

test('background-registered records are first-class pageExtracts members', () => {
  const r = normalizeExtractRecord(
    { text: 'selection', url: 'https://example.com/a', title: 'Title' },
    { id: 'server-id-1' }
  );
  // Same field set as content.js createExtract() builds.
  assert.equal(r.id, 'server-id-1');
  assert.equal(r.url, 'https://example.com/a');
  assert.equal(r.title, 'Title');
  assert.equal(r.text, 'selection');
  assert.ok(r.timestamp);
  // Falling back to a generated id keeps dedupe intact when no extract_id.
  const noServerId = normalizeExtractRecord(
    { text: 'selection' },
    {}
  );
  assert.match(noServerId.id, /^extract_/);
  // Unknown extra fields (html_content/analysis when available) survive.
  const rich = normalizeExtractRecord(
    { text: 'selection', html_content: '<b>x</b>', analysis: { wordCount: 1 } },
    { id: 'server-id-2' }
  );
  assert.equal(rich.html_content, '<b>x</b>');
  assert.equal(rich.analysis.wordCount, 1);
});

test('content script registers background extracts into pageExtracts idempotently', () => {
  // The content script must handle the registerExtracts message and dedupe by
  // extract id (its authoritative registration path).
  assert.ok(content.includes("case 'registerExtracts':"));
  assert.ok(content.includes('function registerExtracts(records)'));
  assert.ok(content.includes('if (seen.has(record.id))'));
  assert.ok(content.includes('savePageExtracts();'));
});

test('the registration mutex serializes read-modify-write so concurrent operations drop nothing', async () => {
  // Models persistExtractRegistration's read-then-write against a shared
  // storage list, with an explicit yield so overlapping ops interleave exactly
  // the way the chrome.storage.local awaits do.
  async function runPersists(mutexOrNull, items) {
    let store = [];
    const persist = async (item) => {
      const op = async () => {
        const current = await Promise.resolve(store.slice());
        current.push(item);
        await Promise.resolve();
        store = current;
      };
      if (mutexOrNull) {
        await mutexOrNull(op);
      } else {
        await op();
      }
    };
    await Promise.all(items.map(persist));
    return store;
  }

  // Sanity: without the mutex, three concurrent persists read the same empty
  // snapshot and clobber each other (this is the bug being guarded against).
  const unguarded = await runPersists(null, ['a', 'b', 'c']);
  assert.ok(unguarded.length < 3, `expected unguarded concurrent persists to drop items, got ${unguarded.length}`);

  // Under the mutex each operation completes before the next starts, so every
  // item survives — a create landing mid-flush cannot be lost or double-added.
  const mutex = createMutex();
  const guarded = await runPersists(mutex, ['a', 'b', 'c']);
  assert.deepEqual(guarded.sort(), ['a', 'b', 'c']);
  assert.equal(guarded.length, 3);

  // A rejected operation does not poison the lock for the next operation.
  const afterRejection = await createMutex();
  let threw = false;
  await afterRejection(async () => { throw new Error('boom'); }).catch(() => { threw = true; });
  assert.equal(threw, true);
  await afterRejection(async () => { await Promise.resolve(); return 'ok'; });
});

test('background read-modify-write on pending registrations runs under the mutex', () => {
  // The fix for the flush-vs-persist clobber: all three list operations
  // (persist, remove, flush's read-then-write) go through the same lock.
  assert.ok(background.includes('createMutex'));
  assert.ok(background.includes('PendingExtractRegistrationsMutex'));
  assert.ok(background.includes('withPendingExtractRegistrationsLock(async () =>'));
  const flushIndex = background.indexOf('async function flushPendingExtractRegistrations');
  const lockIndex = background.indexOf('return withPendingExtractRegistrationsLock(async () => {', flushIndex);
  assert.ok(lockIndex !== -1 && lockIndex > flushIndex, 'flush must run its body under the mutex');
  // persist and remove each run their read-modify-write under the lock too.
  assert.ok(background.indexOf('async function persistExtractRegistration') < background.indexOf('await withPendingExtractRegistrationsLock', background.indexOf('async function persistExtractRegistration')));
  assert.ok(background.indexOf('async function removeExtractRegistration') < background.indexOf('await withPendingExtractRegistrationsLock', background.indexOf('async function removeExtractRegistration')));
});
