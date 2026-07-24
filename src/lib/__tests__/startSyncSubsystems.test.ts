import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Unit tests for startSyncSubsystems() — the idempotent boot chain that wires
 * the shared Yjs doc to every entity that replicates across devices.
 *
 * The whole point of this module is ordering + idempotency: each entity's
 * `ensure*Ready()` must be called, exactly once per session, in an order that
 * keeps dependencies satisfied (file sync before auto-download, replication
 * observers before the first-join backfill that publishes into them). These
 * tests assert that contract by recording the order in which the mocked
 * `ensure*Ready` functions resolve.
 */

const calls: string[] = [];

function record(name: string) {
  return vi.fn(() => {
    calls.push(name);
    return Promise.resolve();
  });
}

const mocks = vi.hoisted(() => {
  return {
    getYjsSync: vi.fn(() => {
      calls.push("getYjsSync");
      return Promise.resolve({});
    }),
    ensureFileSyncReady: record("ensureFileSyncReady"),
    startAutoFileSyncDownload: record("startAutoFileSyncDownload"),
    ensureDocumentReplicationReady: record("ensureDocumentReplicationReady"),
    ensureCollectionSyncReady: record("ensureCollectionSyncReady"),
    ensureExtractSyncReady: record("ensureExtractSyncReady"),
    ensureConversationSyncReady: record("ensureConversationSyncReady"),
    ensureFlashcardSyncReady: record("ensureFlashcardSyncReady"),
    ensureRssSyncReady: record("ensureRssSyncReady"),
    ensurePodcastSyncReady: record("ensurePodcastSyncReady"),
    ensureFileAvailabilityIntentReady: record("ensureFileAvailabilityIntentReady"),
    runSyncMigrationIfNeeded: record("runSyncMigrationIfNeeded"),
  };
});

// Each entity module is mocked to surface its ensure/start function. The
// dynamic imports inside startSyncSubsystems resolve to these.
vi.mock("../yjsSync", () => ({
  getYjsSync: mocks.getYjsSync,
  registerRoomChangeListener: vi.fn(() => () => {}),
}));
vi.mock("../useFileSync", () => ({ ensureFileSyncReady: mocks.ensureFileSyncReady }));
vi.mock("../autoFileSyncDownload", () => ({
  startAutoFileSyncDownload: mocks.startAutoFileSyncDownload,
}));
vi.mock("../documentReplication", () => ({
  ensureDocumentReplicationReady: mocks.ensureDocumentReplicationReady,
}));
vi.mock("../sync/entities/collections", () => ({
  ensureCollectionSyncReady: mocks.ensureCollectionSyncReady,
}));
vi.mock("../sync/entities/extracts", () => ({
  ensureExtractSyncReady: mocks.ensureExtractSyncReady,
}));
vi.mock("../sync/entities/conversations", () => ({
  ensureConversationSyncReady: mocks.ensureConversationSyncReady,
}));
vi.mock("../sync/entities/flashcards", () => ({
  ensureFlashcardSyncReady: mocks.ensureFlashcardSyncReady,
}));
vi.mock("../sync/entities/rss", () => ({ ensureRssSyncReady: mocks.ensureRssSyncReady }));
vi.mock("../sync/entities/podcasts", () => ({
  ensurePodcastSyncReady: mocks.ensurePodcastSyncReady,
}));
vi.mock("../sync/fileAvailabilityIntent", () => ({
  ensureFileAvailabilityIntentReady: mocks.ensureFileAvailabilityIntentReady,
}));
vi.mock("../sync/migrate", () => ({
  // runSyncMigrationIfNeeded is wrapped in .catch() by the chain, so even when
  // it rejects it must not abort the rest. Default resolves; one test overrides.
  runSyncMigrationIfNeeded: mocks.runSyncMigrationIfNeeded,
}));

import {
  startSyncSubsystems,
  isSyncSubsystemsStarted,
  __resetSyncSubsystemsForTest,
} from "../startSyncSubsystems";

beforeEach(() => {
  calls.length = 0;
  __resetSyncSubsystemsForTest();
  // Restore the default (resolving) implementation in case a test replaced it.
  mocks.runSyncMigrationIfNeeded.mockImplementation(() => {
    calls.push("runSyncMigrationIfNeeded");
    return Promise.resolve();
  });
  for (const k of Object.keys(mocks) as (keyof typeof mocks)[]) {
    mocks[k].mockClear();
  }
});

describe("startSyncSubsystems", () => {
  it("invokes every entity initializer exactly once, in dependency order", async () => {
    await startSyncSubsystems();

    // Ordering: provider → bounded, user-facing entity waves → auto-download
    // → first-join backfill. The scheduler keeps the first surfaces ahead of
    // lower-priority feeds while still initializing every adapter once.
    expect(calls).toEqual([
      "getYjsSync",
      "ensureCollectionSyncReady",
      "ensureDocumentReplicationReady",
      "ensureFlashcardSyncReady",
      "ensureExtractSyncReady",
      "ensureConversationSyncReady",
      "ensureRssSyncReady",
      "ensurePodcastSyncReady",
      "ensureFileSyncReady",
      "ensureFileAvailabilityIntentReady",
      "startAutoFileSyncDownload",
      "runSyncMigrationIfNeeded",
    ]);

    // Each initializer ran exactly once.
    expect(mocks.ensureFlashcardSyncReady).toHaveBeenCalledTimes(1);
    expect(mocks.ensureDocumentReplicationReady).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: a second call returns the same promise without re-running the chain", async () => {
    const first = startSyncSubsystems();
    const second = startSyncSubsystems();
    expect(second).toBe(first);

    await first;

    expect(mocks.ensureFlashcardSyncReady).toHaveBeenCalledTimes(1);
    expect(isSyncSubsystemsStarted()).toBe(true);
  });

  it("does not let a failed first-join backfill abort replication observers", async () => {
    // The migration step is wrapped in .catch() inside the chain, so a
    // rejection there is swallowed and the chain still resolves. The point of
    // this test: every replication observer must already be attached before
    // the (best-effort) backfill runs, so a backfill failure can never leave
    // the device unable to RECEIVE remote data.
    mocks.runSyncMigrationIfNeeded.mockImplementation(() => {
      calls.push("runSyncMigrationIfNeeded");
      return Promise.reject(new Error("backfill blew up"));
    });

    // Resolves despite the migration rejection — the .catch() inside the chain
    // converts it into a console warning.
    await expect(startSyncSubsystems()).resolves.toBeUndefined();

    // Every step before the migration still ran, in order.
    expect(calls).toContain("ensureFlashcardSyncReady");
    expect(calls).toContain("ensureRssSyncReady");
    expect(calls).toContain("ensurePodcastSyncReady");
    expect(calls[calls.length - 1]).toBe("runSyncMigrationIfNeeded");
    // The chain resolved, so a later caller will see it as started.
    expect(isSyncSubsystemsStarted()).toBe(true);
  });
});
