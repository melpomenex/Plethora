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

test('browser queue membership, future scheduling, and creation defaults agree with native semantics', async ({ page }) => {
  await page.goto('/src/lib/marketingCapture/namespace.ts');
  const result = await page.evaluate(async () => {
    (globalThis as typeof globalThis & { __PLETHORA_CAPTURE_DATABASE__: string }).__PLETHORA_CAPTURE_DATABASE__ = 'plethora-marketing-capture-v2-0000000000000010';
    const fixturePath = '/src/test/issue6/browserFixture.ts';
    const dbPath = '/src/lib/database.ts';
    const commandPath = '/src/lib/tauri.ts';
    const { recreateIssue6BrowserFixture } = await import(/* @vite-ignore */ fixturePath);
    await recreateIssue6BrowserFixture();
    const db = await import(/* @vite-ignore */ dbPath);
    const { invokeCommand: run } = await import(/* @vite-ignore */ commandPath);
    const parentBefore = await db.getDocument('issue6-video');

    const immediate = await run('create_video_extract', { documentId: 'issue6-video', startTime: 1, endTime: 11, title: 'Immediate segment', addToQueue: true });
    const savedOnly = await run('create_video_extract', { documentId: 'issue6-video', startTime: 20, endTime: 30, title: 'Saved only', addToQueue: false });
    const future = await run('create_video_extract', { documentId: 'issue6-video', startTime: 40, endTime: 50, title: 'Future segment', addToQueue: true, initialReviewDate: '2030-01-01T00:00:00.000Z' });

    const queue = await run('get_queue', {}) as Array<{ id: string; item_type: string; entity_title?: string }>;
    const videoIds = queue.filter((item) => item.item_type === 'video-extract').map((item) => item.id);
    const all = await run('get_all_video_extracts', {}) as Array<{ id: string; queue_status: string; collection_id?: string }>;
    const allIds = all.map((item) => item.id);

    await run('set_video_extract_queue_membership', { extractId: immediate.id, queued: false });
    const afterRemove = await run('get_queue', {}) as Array<{ id: string; item_type: string }>;
    await run('set_video_extract_queue_membership', { extractId: immediate.id, queued: true });
    const afterReadd = await run('get_queue', {}) as Array<{ id: string; item_type: string }>;

    const rating = await run('rate_video_extract', { extractId: immediate.id, rating: 3, operationId: crypto.randomUUID() });
    const parentAfter = await db.getDocument('issue6-video');
    const nextReviewDate = rating.extract.next_review_date as string;
    const dueBefore = await run('get_video_extract_review_candidates', { documentId: 'issue6-video' }) as Array<{ id: string }>;
    const dueAfter = await run('get_video_extract_review_candidates', {
      documentId: 'issue6-video',
      now: new Date(Date.parse(nextReviewDate) + 1000).toISOString(),
    }) as Array<{ id: string }>;

    await run('set_video_extract_queue_membership', { extractId: immediate.id, queued: false });
    const removedAfterRating = await run('get_video_extract', { extractId: immediate.id });
    await run('set_video_extract_queue_membership', { extractId: immediate.id, queued: true });
    const readdedAfterRating = await run('get_video_extract', { extractId: immediate.id });
    db.closeDatabase();
    const restarted = await run('get_video_extract', { extractId: immediate.id });
    return {
      immediate,
      savedOnly,
      future,
      videoIds,
      allIds,
      afterRemoveIds: afterRemove.filter((item) => item.item_type === 'video-extract').map((item) => item.id),
      afterReaddIds: afterReadd.filter((item) => item.item_type === 'video-extract').map((item) => item.id),
      rating,
      parentBefore,
      parentAfter,
      dueBefore,
      dueAfter,
      removedAfterRating,
      readdedAfterRating,
      restarted,
      nextReviewDate,
    };
  });
  expect(result.immediate.queue_status).toBe('queued');
  expect(result.immediate.next_review_date).toBeUndefined();
  expect(result.savedOnly.queue_status).toBe('not_queued');
  expect(result.savedOnly.next_review_date).toBeUndefined();
  expect(result.future.queue_status).toBe('queued');
  expect(result.future.next_review_date).toBe('2030-01-01T00:00:00.000Z');
  expect(result.videoIds).toContain(result.immediate.id);
  expect(result.videoIds).not.toContain(result.savedOnly.id);
  expect(result.videoIds).not.toContain(result.future.id);
  expect(result.allIds).toEqual(expect.arrayContaining([result.immediate.id, result.savedOnly.id, result.future.id]));
  expect(result.allIds).not.toContain(result.immediate.id + '-missing');
  expect(result.afterRemoveIds).not.toContain(result.immediate.id);
  expect(result.afterReaddIds).toContain(result.immediate.id);
  expect(result.rating.extract.review_count).toBe(1);
  expect(result.parentAfter).toEqual(result.parentBefore);
  expect(result.dueBefore.map((item) => item.id)).not.toContain(result.immediate.id);
  expect(result.dueAfter.map((item) => item.id)).toContain(result.immediate.id);
  expect(result.removedAfterRating.queue_status).toBe('not_queued');
  expect(result.readdedAfterRating.queue_status).toBe('queued');
  expect(result.readdedAfterRating.next_review_date).toBe(result.nextReviewDate);
  expect(result.restarted.review_count).toBe(1);
  expect(result.restarted.next_review_date).toBe(result.nextReviewDate);
});

test('browser v8 video rows infer membership and collection on the v9 upgrade', async ({ page }) => {
  await page.goto('/src/lib/marketingCapture/namespace.ts');
  const result = await page.evaluate(async () => {
    const namespace = 'plethora-marketing-capture-v2-0000000000000011';
    (globalThis as typeof globalThis & { __PLETHORA_CAPTURE_DATABASE__: string }).__PLETHORA_CAPTURE_DATABASE__ = namespace;
    await new Promise<void>((resolve, reject) => {
      const del = indexedDB.deleteDatabase(namespace);
      del.onsuccess = () => resolve();
      del.onerror = () => reject(del.error);
    });
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(namespace, 8);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore('documents', { keyPath: 'id' });
        db.createObjectStore('video_extracts', { keyPath: 'id' }).createIndex('by_document', 'document_id', { unique: false });
        db.createObjectStore('video_extract_review_events', { keyPath: 'operation_id' });
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(['documents', 'video_extracts'], 'readwrite');
        tx.objectStore('documents').put({ id: 'legacy-video', collection_id: 'legacy-collection', title: 'Legacy video', file_type: 'youtube' });
        tx.objectStore('video_extracts').put({
          id: 'dated', document_id: 'legacy-video', start_time: 0, end_time: 10, title: 'Dated',
          tags: [], next_review_date: '2026-10-30T00:00:00Z', review_count: 0, reps: 0,
          date_created: '2026-01-01T00:00:00Z', date_modified: '2026-01-01T00:00:00Z',
        });
        tx.objectStore('video_extracts').put({
          id: 'undated', document_id: 'legacy-video', start_time: 20, end_time: 30, title: 'Undated',
          tags: [], review_count: 0, reps: 0,
          date_created: '2026-01-01T00:00:00Z', date_modified: '2026-01-01T00:00:00Z',
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
    const dbPath = '/src/lib/database.ts';
    const commandPath = '/src/lib/tauri.ts';
    const db = await import(/* @vite-ignore */ dbPath);
    const { invokeCommand: run } = await import(/* @vite-ignore */ commandPath);
    const dated = await run('get_video_extract', { extractId: 'dated' });
    const undated = await run('get_video_extract', { extractId: 'undated' });
    const version = (await db.openDatabase()).version;
    return { dated, undated, version };
  });
  expect(result.version).toBe(9);
  expect(result.dated.queue_status).toBe('queued');
  expect(result.dated.collection_id).toBe('legacy-collection');
  expect(result.undated.queue_status).toBe('not_queued');
  expect(result.undated.collection_id).toBe('legacy-collection');
});
