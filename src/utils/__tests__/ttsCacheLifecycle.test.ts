/**
 * ttsCache lifecycle tests (eliminate-long-running-memory-growth, tasks
 * 5.3/5.4): one managed shared connection, metadata-only eviction, backfill
 * of pre-v3 entries, and preserved semantics (500 MB default, mutex, clear).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { installFakeIndexedDb, flushIDb, type FakeIndexedDB } from "../../test/fakeIndexedDb";
import {
  getCachedAudio,
  setCachedAudio,
  setCachedAudioDurable,
  clearAudioCache,
  getCacheSize,
  getTtsCacheConnectionCount,
  updateMaxCacheSize,
  __resetTtsCacheForTests,
} from "../ttsCache";

let fake: FakeIndexedDB;

beforeEach(async () => {
  fake = installFakeIndexedDb();
  __resetTtsCacheForTests();
  await flushIDb();
});

const KiB = 1024;

function payload(bytes: number): ArrayBuffer {
  return new ArrayBuffer(bytes);
}

describe("one managed shared connection (5.3)", () => {
  it("100 sequential lookups open exactly one database and never accumulate handles", async () => {
    await setCachedAudio("k0", payload(KiB), 1);
    for (let i = 0; i < 100; i++) {
      const hit = await getCachedAudio("k0");
      expect(hit?.durationSec).toBe(1);
    }
    expect(fake.openCalls.length).toBe(1);
    const stats = getTtsCacheConnectionCount();
    expect(stats.opened).toBe(1);
    expect(stats.closed).toBe(0);
    expect(stats.live).toBe(1);
  });

  it("clearAudioCache closes the connection; the next operation reopens exactly one", async () => {
    await setCachedAudio("k", payload(KiB), 1);
    await clearAudioCache();
    expect(getTtsCacheConnectionCount().closed).toBe(1);
    expect(getTtsCacheConnectionCount().live).toBe(0);
    await getCacheSize();
    expect(fake.openCalls.length).toBe(2);
    expect(getTtsCacheConnectionCount().live).toBe(1);
  });
});

describe("metadata-only eviction (5.4)", () => {
  it("evicts under the bound without ever reading the payload store", async () => {
    // ~3 KiB cap: holds one 2-KiB entry, evicts the LRU on every second put.
    await updateMaxCacheSize(0.003);
    for (let i = 0; i < 8; i++) {
      await setCachedAudioDurable(`k${i}`, payload(2 * KiB), 1);
    }
    // Eviction runs after each over-size put; drain everything pending.
    for (let i = 0; i < 12; i++) await flushIDb();
    await updateMaxCacheSize(0.003); // re-run ensureCacheSize deterministically
    for (let i = 0; i < 12; i++) await flushIDb();

    const db = fake.databases.get("plethora-tts-cache")!;
    const payloadStore = db.stores.get("audio-cache")!;
    const metaStore = db.stores.get("entry-meta")!;

    const payloadReads = payloadStore.calls.filter((c) => c.method === "get" || c.method === "getAll" || c.method === "openCursor");
    // No payload read at all after the initial writes (only deletes):
    expect(payloadReads.length).toBe(0);

    const size = await getCacheSize();
    expect(size.totalSize).toBeLessThanOrEqual(3 * KiB); // converged under bound
    expect(metaStore.records.size).toBe(payloadStore.records.size); // index consistent
    expect(payloadStore.records.size).toBeGreaterThan(0);
  });

  it("evicts least-recently-accessed first", async () => {
    // Cap holds everything during the loop (6 x 4 KiB = 24 KiB < 31 KiB).
    await updateMaxCacheSize(0.03);
    for (let i = 0; i < 6; i++) {
      await setCachedAudioDurable(`k${i}`, payload(4 * KiB), 1);
      await flushIDb();
    }
    // Touch k0 so k1 becomes the LRU victim.
    await getCachedAudio("k0");
    await flushIDb();
    // Shrink to ~12 KiB: victims must be k1,k2,k3 (LRU order), keeping the
    // touched k0 plus the newest writes.
    await updateMaxCacheSize(0.012);
    for (let i = 0; i < 12; i++) await flushIDb();

    const db = fake.databases.get("plethora-tts-cache")!;
    const payloadStore = db.stores.get("audio-cache")!;
    const keys = [...payloadStore.records.keys()];
    expect(keys).toContain("k0");
    expect(keys).toContain("k4");
    expect(keys).toContain("k5");
    expect(keys).not.toContain("k1");
    expect(keys).not.toContain("k2");
    expect(keys).not.toContain("k3");
  });

  it("old-schema payload entries remain readable and get sized on first access", async () => {
    await setCachedAudio("legacy", payload(3 * KiB), 7);
    await flushIDb();
    // Simulate a pre-v3 database: entry-meta rows stripped.
    const db = fake.databases.get("plethora-tts-cache")!;
    db.stores.get("entry-meta")!.records.clear();
    // Fresh module state = fresh one-time backfill (key-only, no payload get).
    __resetTtsCacheForTests();
    const payloadCallsBefore = db.stores.get("audio-cache")!.calls.length;

    const hit = await getCachedAudio("legacy");
    expect(hit?.durationSec).toBe(7);
    await flushIDb();

    const payloadCalls = db.stores.get("audio-cache")!.calls.slice(payloadCallsBefore);
    for (const call of payloadCalls) {
      // Backfill must be key-only; the only payload read is the hit itself.
      expect(["get", "openKeyCursor"]).toContain(call.method);
    }
    // Metadata now exists and is sized.
    const meta = db.stores.get("entry-meta")!.records.get("legacy") as
      | { sized: boolean; size: number }
      | undefined;
    expect(meta?.sized).toBe(true);
    expect(meta?.size).toBe(3 * KiB);
  });
});
