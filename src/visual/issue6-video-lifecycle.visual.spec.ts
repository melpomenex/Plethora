import { expect, test } from '@playwright/test';

test('video lifecycle persists offline, serializes ratings, and retains receipts after deletion', async ({ page }) => {
  await page.goto('/src/lib/marketingCapture/namespace.ts');
  const result = await page.evaluate(async () => {
    (globalThis as typeof globalThis & { __PLETHORA_CAPTURE_DATABASE__: string }).__PLETHORA_CAPTURE_DATABASE__ = 'plethora-marketing-capture-v2-0000000000000008';
    const fixturePath = '/src/test/issue6/browserFixture.ts';
    const dbPath = '/src/lib/database.ts';
    const commandPath = '/src/lib/tauri.ts';
    const { recreateIssue6BrowserFixture } = await import(/* @vite-ignore */ fixturePath);
    const db = await import(/* @vite-ignore */ dbPath);
    await recreateIssue6BrowserFixture();
    const { invokeCommand: run } = await import(/* @vite-ignore */ commandPath);
    const parentBefore = await db.getDocument('issue6-video');
    const created = await run('create_video_extract', { documentId: 'issue6-video', startTime: 10, endTime: 30, title: 'Local segment', addToQueue: false });
    const seen = await run('mark_video_extract_seen', { extractId: created.id });
    const secondSeen = await run('mark_video_extract_seen', { extractId: created.id });
    const operationId = crypto.randomUUID();
    // Requests run in one readwrite transaction and resolve on commit.
    const [first, replay] = await Promise.all([1, 2].map(() => run('rate_video_extract', { extractId: created.id, rating: 3, operationId })));
    let conflict = false;
    try { await run('rate_video_extract', { extractId: created.id, rating: 4, operationId }); } catch { conflict = true; }
    await Promise.all([1, 2].map(() => run('rate_video_extract', { extractId: created.id, rating: 3, operationId: crypto.randomUUID() })));
    db.closeDatabase();
    const restarted = await run('get_video_extract', { extractId: created.id });
    const parentAfter = await db.getDocument('issue6-video');
    await run('delete_video_extract', { extractId: created.id });
    db.closeDatabase();
    const deletedReplay = await run('rate_video_extract', { extractId: created.id, rating: 3, operationId });
    let missing = false;
    try { await run('rate_video_extract', { extractId: created.id, rating: 3, operationId: crypto.randomUUID() }); } catch { missing = true; }
    const database = await db.openDatabase();
    const count = await new Promise((resolve) => {
      const request = database.transaction('video_extract_review_events').objectStore('video_extract_review_events').count();
      request.onsuccess = () => resolve(request.result);
    });
    return { created, seen, secondSeen, first, replay, conflict, restarted, parentBefore, parentAfter, deletedReplay, missing, count };
  });
  expect(result.created.review_count).toBe(0);
  expect(result.created.first_seen_at).toBeNull();
  expect(result.seen.first_seen_at).toBeTruthy();
  expect(result.secondSeen.first_seen_at).toBe(result.seen.first_seen_at);
  expect(result.seen.next_review_date).toBe(result.created.next_review_date);
  expect(result.seen.review_count).toBe(0);
  expect(result.first.receipt).toEqual(result.replay.receipt);
  expect(result.restarted.review_count).toBe(3);
  expect(result.restarted.first_seen_at).toBe(result.seen.first_seen_at);
  expect(result.parentAfter).toEqual(result.parentBefore);
  expect(result.conflict).toBe(true);
  expect(result.deletedReplay.extract).toBeNull();
  expect(result.deletedReplay.receipt.after.review_count).toBe(1);
  expect(result.missing).toBe(true);
  expect(result.count).toBe(3);
});

test('collection archives restore video history locally and reject invalid lineage before clearing data', async ({ page }) => {
  await page.goto('/src/lib/marketingCapture/namespace.ts');
  const result = await page.evaluate(async () => {
    (globalThis as typeof globalThis & { __PLETHORA_CAPTURE_DATABASE__: string }).__PLETHORA_CAPTURE_DATABASE__ = 'plethora-marketing-capture-v2-0000000000000009';
    const fixturePath = '/src/test/issue6/browserFixture.ts';
    const tauriPath = '/src/lib/tauri.ts';
    const archivePath = '/src/utils/collectionArchive.ts';
    const dbPath = '/src/lib/database.ts';
    const { recreateIssue6BrowserFixture } = await import(/* @vite-ignore */ fixturePath);
    await recreateIssue6BrowserFixture();
    const { invokeCommand: run } = await import(/* @vite-ignore */ tauriPath);
    const { buildCollectionArchive, parseCollectionArchive, restoreBrowserArchive } = await import(/* @vite-ignore */ archivePath);
    const db = await import(/* @vite-ignore */ dbPath);
    const extract = await run('create_video_extract', { documentId: 'issue6-video', startTime: 5, endTime: 25, title: 'Archived segment' });
    await run('mark_video_extract_seen', { extractId: extract.id });
    const operationId = crypto.randomUUID();
    await run('rate_video_extract', { extractId: extract.id, rating: 3, operationId });
    const before = await run('get_video_extract_lifecycle', {});
    const { blob } = await buildCollectionArchive({ scope: 'all', activeCollectionId: null, collections: [] });
    const parsed = await parseCollectionArchive(new File([blob], 'test.zip'));
    const invalid = structuredClone(parsed);
    invalid.payload.videoLifecycle.extracts[0].document_id = 'missing-source';
    let rejected = false;
    try { await restoreBrowserArchive(invalid); } catch { rejected = true; }
    const afterFailure = await run('get_video_extract_lifecycle', {});
    await restoreBrowserArchive(parsed);
    db.closeDatabase();
    const restored = await run('get_video_extract_lifecycle', {});
    const replay = await run('rate_video_extract', { extractId: extract.id, rating: 3, operationId });
    return { before, afterFailure, restored, replay, rejected, manifest: parsed.manifest };
  });
  expect(result.manifest.archiveType).toBe('plethora-collection-export-v2');
  expect(result.manifest.version).toBe('2.0');
  expect(result.rejected).toBe(true);
  expect(result.afterFailure).toEqual(result.before);
  expect(result.restored).toEqual(result.before);
  expect(result.replay.extract.review_count).toBe(1);
});
