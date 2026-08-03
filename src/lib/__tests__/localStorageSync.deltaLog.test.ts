import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  getYjsSync: vi.fn(),
}));

vi.mock("../tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tauri")>();
  return { ...actual, isTauri: () => true, invokeCommand: mocks.invokeCommand };
});
vi.mock("../yjsSync", () => ({
  getYjsSync: mocks.getYjsSync,
  registerRoomChangeListener: () => () => {},
}));

function makeFakeMap() {
  const store = new Map<string, unknown>();
  const observers: Array<(e: { keysChanged: Set<string> }) => void> = [];
  return {
    get: (k: string) => store.get(k),
    set: (k: string, v: unknown) => {
      store.set(k, v);
      observers.forEach((fn) => fn({ keysChanged: new Set([k]) }));
    },
    delete: (k: string) => store.delete(k),
    has: (k: string) => store.has(k),
    get size() {
      return store.size;
    },
    forEach: (fn: (v: unknown, k: string) => void) => store.forEach(fn),
    observe: (fn: (e: { keysChanged: Set<string> }) => void) => observers.push(fn),
  };
}

describe("localStorageSync delta-log integration (task 5.5)", () => {
  let map: ReturnType<typeof makeFakeMap>;

  beforeEach(async () => {
    vi.resetModules();
    mocks.invokeCommand.mockReset();
    map = makeFakeMap();
    mocks.getYjsSync.mockResolvedValue({ doc: { getMap: () => map } });
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers a 'localStorage' domain handler that applies a remote SyncEntry upsert", async () => {
    const { initLocalStorageSync } = await import("../localStorageSync");
    const { getDomainHandler } = await import("../sync/deltaLog/domainRegistry");
    await initLocalStorageSync();

    const handler = getDomainHandler("localStorage");
    expect(handler).toBeDefined();

    await handler!("my-setting", { value: "hello", updatedAt: Date.now() });
    expect(localStorage.getItem("my-setting")).toBe("hello");
  });

  it("normalizes the router's tombstone shape into a delete", async () => {
    const { initLocalStorageSync } = await import("../localStorageSync");
    const { getDomainHandler } = await import("../sync/deltaLog/domainRegistry");
    await initLocalStorageSync();

    localStorage.setItem("about-to-delete", "x");
    // Bypass the setItem patch's own sync scheduling for this assertion setup.

    const handler = getDomainHandler("localStorage")!;
    const nowMs = Date.now();
    const hlc = `${String(nowMs).padStart(13, "0")}.000001`;
    await handler("about-to-delete", { _deleted: true, deletedAt: hlc });

    expect(localStorage.getItem("about-to-delete")).toBeNull();
  });

  it("never applies a remote value for a blocked key", async () => {
    const { initLocalStorageSync } = await import("../localStorageSync");
    const { getDomainHandler } = await import("../sync/deltaLog/domainRegistry");
    await initLocalStorageSync();

    const handler = getDomainHandler("localStorage")!;
    await handler("incrementum_auth_token", { value: "leaked-token", updatedAt: Date.now() });
    expect(localStorage.getItem("incrementum_auth_token")).toBeNull();
  });

  it("echo guard: does not reapply a remote entry no newer than what was already applied", async () => {
    const { initLocalStorageSync } = await import("../localStorageSync");
    const { getDomainHandler } = await import("../sync/deltaLog/domainRegistry");
    await initLocalStorageSync();

    const handler = getDomainHandler("localStorage")!;
    await handler("k", { value: "v2", updatedAt: 2000 });
    expect(localStorage.getItem("k")).toBe("v2");

    // Stale/duplicate delivery with an older or equal clock must not clobber.
    await handler("k", { value: "v1-stale", updatedAt: 1000 });
    expect(localStorage.getItem("k")).toBe("v2");
  });

  it("setItem on a syncable key eventually enqueues a journaled outbox op when journaledProjection is on", async () => {
    vi.useFakeTimers();
    const { __resetSyncFeatureFlagsForTest } = await import("../sync/featureFlags");
    __resetSyncFeatureFlagsForTest();
    localStorage.setItem(
      "incrementum.sync.feature-flags",
      JSON.stringify({ journaledProjection: true }),
    );

    const { initLocalStorageSync } = await import("../localStorageSync");
    await initLocalStorageSync();

    localStorage.setItem("my-pref", "on");
    await vi.advanceTimersByTimeAsync(400); // past LOCAL_WRITE_DEBOUNCE_MS

    const enqueueCalls = mocks.invokeCommand.mock.calls.filter((c) => c[0] === "enqueue_sync_outbox");
    const call = enqueueCalls.find((c) => (c[1] as { entityKey: string }).entityKey === "my-pref");
    expect(call).toBeDefined();
    expect((call![1] as { domain: string }).domain).toBe("localStorage");
  });
});
