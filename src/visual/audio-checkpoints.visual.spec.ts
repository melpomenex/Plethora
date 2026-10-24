import { expect, test } from "@playwright/test";

test("browser checkpoints migrate, reject stale owners, project atomically and preserve reader position", async ({ page }) => {
  await page.goto("/audio-checkpoint-harness.html");
  await page.evaluate(async () => {
    localStorage.setItem("audiobook-legacy-book-bookmarks", JSON.stringify([{ id: "saved-mark", time: 42, title: "Keep this" }]));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("plethora", 4);
      request.onupgradeneeded = () => request.result.createObjectStore("documents", { keyPath: "id" }).put({ id: "legacy-book", file_type: "audio", position_json: '{"type":"time","seconds":42}', progress_percent: 35 });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
  });
  const result = await page.evaluate(async () => {
    // Vite serves the real modules; this page has no application or mocked IndexedDB.
    const apiUrl = "/src/services/audio/browserAudioCheckpoints.ts";
    const databaseUrl = "/src/lib/database.ts";
    const api = await import(/* @vite-ignore */ apiUrl);
    const db = await import(/* @vite-ignore */ databaseUrl);
    const database = await db.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(["documents", "podcast_episodes"], "readwrite");
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      tx.objectStore("documents").put({ id: "text", file_type: "epub", position_json: '{"type":"cfi","cfi":"chapter-two"}', progress_percent: 41 });
      tx.objectStore("documents").put({ id: "promoted", file_type: "audio", metadata: { source: "podcast:episode" } });
      tx.objectStore("podcast_episodes").put({ id: "episode", playback_position: 0 });
    });
    const checkpoint = {
      schemaVersion: 1 as const, sourceKey: { profileKey: "test", kind: "podcast" as const, sourceId: "episode" },
      ownerEpoch: "epoch-1", checkpointSequence: 1, sessionId: "session-1", mediaRevision: "rev-1", partIndex: 0,
      timeInPart: 30, positionSec: 30, durationSec: 120, playbackRate: 1, updatedAt: Date.now(),
    };
    const claim = await api.claimBrowserAudioOwner("test", "epoch-1");
    const accepted = await api.commitBrowserAudioCheckpoint(checkpoint);
    let privateRejected = false;
    try { await api.commitBrowserAudioCheckpoint({ ...checkpoint, nativeUri: "https://example.test/private?token=secret" }); }
    catch { privateRejected = true; }
    const duplicate = await api.commitBrowserAudioCheckpoint(checkpoint);
    const invalidClaim = await api.claimBrowserAudioOwner("test", "epoch-2", "wrong");
    const handover = await api.claimBrowserAudioOwner("test", "epoch-2", "epoch-1");
    const stale = await api.commitBrowserAudioCheckpoint({ ...checkpoint, checkpointSequence: 500 });
    const rewind = await api.commitBrowserAudioCheckpoint({ ...checkpoint, ownerEpoch: "epoch-2", timeInPart: 8, positionSec: 8 });
    await api.commitBrowserAudioCheckpoint({ ...checkpoint, ownerEpoch: "epoch-2", sourceKey: { ...checkpoint.sourceKey, kind: "audio_edition", sourceId: "edition" } });
    let missingRejected = false;
    try { await api.commitBrowserAudioCheckpoint({ ...checkpoint, ownerEpoch: "epoch-2", sourceKey: { ...checkpoint.sourceKey, sourceId: "missing" } }); }
    catch { missingRejected = true; }
    const missing = await api.getBrowserAudioCheckpoint({ ...checkpoint.sourceKey, sourceId: "missing" });
    const reader = await db.getDocument("text");
    const promoted = await db.getDocument("promoted");
    const episode = await db.getPodcastEpisode("episode");
    const legacy = await db.getDocument("legacy-book");
    const bookmarks = JSON.parse(localStorage.getItem("audiobook-legacy-book-bookmarks")!);
    const session = { schemaVersion: 1 as const, current: checkpoint.sourceKey, queue: [checkpoint.sourceKey], playbackRate: 1.5, volume: 0.8, sleepDeadlineMs: null, updatedAt: Date.now() };
    const saved = await api.saveBrowserAudioSession("test", "epoch-2", session);
    const restored = await api.getBrowserAudioSession("test");
    return { claim, accepted, privateRejected, duplicate, invalidClaim, handover, stale, rewind, missingRejected, missing, reader, promoted, episode, saved, restored, legacy, bookmarks };
  });
  expect(result).toMatchObject({ claim: true, accepted: "accepted", privateRejected: true, duplicate: "duplicate", invalidClaim: false, handover: true, stale: "stale", rewind: "accepted", missingRejected: true, missing: null, saved: true });
  expect(JSON.parse(result.reader!.position_json!)).toEqual({ type: "cfi", cfi: "chapter-two" });
  expect(result.reader!.progress_percent).toBe(41);
  expect(JSON.parse(result.promoted!.position_json!).seconds).toBe(8);
  expect(result.episode!.playback_position).toBe(8);
  expect(JSON.parse(result.legacy!.position_json!).seconds).toBe(42);
  expect(result.bookmarks).toEqual([{ id: "saved-mark", time: 42, title: "Keep this" }]);
  expect(result.restored).toMatchObject({ ownerEpoch: "epoch-2", session: { playbackRate: 1.5, current: { sourceId: "episode" } } });
  await page.reload();
  const restarted = await page.evaluate(async () => {
    const apiUrl = "/src/api/audioPlayback.ts";
    const api = await import(/* @vite-ignore */ apiUrl);
    return { checkpoint: await api.getAudioCheckpoint({ profileKey: "test", kind: "podcast", sourceId: "episode" }), session: await api.getAudioSession("test") };
  });
  expect(restarted.checkpoint).toMatchObject({ positionSec: 8, ownerEpoch: "epoch-2" });
  expect(restarted.session).toMatchObject({ ownerEpoch: "epoch-2", session: { playbackRate: 1.5 } });
  const invalidRecovery = await page.evaluate(async () => {
    const databaseUrl = "/src/lib/database.ts";
    const apiUrl = "/src/services/audio/browserAudioCheckpoints.ts";
    const database = await (await import(/* @vite-ignore */ databaseUrl)).openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("audio_playback", "readwrite");
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      tx.objectStore("audio_playback").put({ key: "session:test", value: { schemaVersion: 999 } });
    });
    const api = await import(/* @vite-ignore */ apiUrl);
    return api.getBrowserAudioSession("test");
  });
  expect(invalidRecovery).toMatchObject({ ownerEpoch: "epoch-2", session: null, invalidSession: true });
});
