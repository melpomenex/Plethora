import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Unit tests for rejoinRoom() — the in-process room switch that lets the
 * scan-to-join flow change rooms without a page reload.
 *
 * y-websocket / y-indexeddb / the crypto layer are mocked so these tests
 * exercise the orchestration logic (tear down old instance, write room ID,
 * rebuild against new room) rather than real Yjs replication. The crypto
 * mock returns non-null sub-keys so buildProvider takes the encrypted-provider
 * branch (sync is always encrypted); the EncryptedWebsocketProvider mock
 * delegates to the same MockWebsocketProvider so room/construction tracking
 * still works.
 */

// --- Mocks --------------------------------------------------------------

// Track the constructor calls so each test can assert which room the provider
// was built against and that disconnect() ran.
let lastBuiltRoom: string | null = null;
let disconnectCalls = 0;
let providerConstructionCount = 0;

const mockProvider = {
  shouldConnect: true,
  wsconnected: false,
  connect: vi.fn(() => {
    mockProvider.wsconnected = true;
  }),
  disconnect: vi.fn(() => {
    disconnectCalls += 1;
    mockProvider.wsconnected = false;
  }),
  destroy: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  ws: undefined as unknown,
};

// A real constructable (a class body) so `new WebsocketProvider(...)` works.
// vi.fn().mockImplementation is not reliably `new`-able here, so we define a
// class and re-export the spy via a factory.
class MockWebsocketProvider {
  constructor(_url: string, room: string) {
    lastBuiltRoom = room;
    providerConstructionCount += 1;
    Object.assign(this, mockProvider);
  }
}

vi.mock("y-websocket", () => ({
  WebsocketProvider: MockWebsocketProvider,
}));

vi.mock("y-indexeddb", () => ({
  IndexeddbPersistence: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    clearData: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  })),
}));

vi.mock("../sync/roomCrypto", () => ({
  // Non-null sub-keys so buildProvider takes the EncryptedWebsocketProvider
  // branch (the plaintext fallback was removed — sync is always encrypted).
  getCachedSubKeys: vi.fn().mockResolvedValue({
    stateKey: {},
    fileKey: {},
    manifestAuthKey: {},
  }),
  // Auto-provisioning should never trigger in these tests because sub-keys
  // are always cached; keep it as a spy so any accidental call is visible.
  ensureEncryptionEnabled: vi.fn().mockResolvedValue("auto-secret"),
}));

// EncryptedWebsocketProvider wraps a real WebsocketProvider internally. For
// these orchestration tests we don't care about encryption — we just need the
// inner provider to be our MockWebsocketProvider so room/construction tracking
// keeps working. The mock stashes the inner provider on `provider` exactly the
// way the real wrapper does, and exposes the diagnostic __encrypted flag the
// yjsSync module reads. Must be a real class so `new EncryptedWebsocketProvider`
// works (vi.fn().mockImplementation is not reliably `new`-able).
vi.mock("../sync/encryptedProvider", () => ({
  EncryptedWebsocketProvider: class {
    provider: MockWebsocketProvider;
    constructor(_Wp: unknown, url: string, room: string, _doc: unknown) {
      this.provider = new MockWebsocketProvider(url, room);
      Object.defineProperty(this.provider, "__encrypted", {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false,
      });
    }
  },
}));

// --- Setup ---------------------------------------------------------------

const ROOM_KEY = "incrementum_sync_room";

beforeEach(async () => {
  vi.clearAllMocks();
  lastBuiltRoom = null;
  disconnectCalls = 0;
  providerConstructionCount = 0;
  mockProvider.wsconnected = false;
  localStorage.clear();

  const { useSettingsStore } = await import("../../stores/settingsStore");
  useSettingsStore.getState().updateSettings({
    sync: {
      enabled: false,
      provider: "dropbox",
      interval: 3600,
      onStartup: false,
      autoDownloadMode: "wifi-only",
      yjs: { enabled: true, url: "" },
    },
  });

  const { resetYjsSync } = await import("../yjsSync");
  await resetYjsSync();
});

afterEach(async () => {
  const { resetYjsSync } = await import("../yjsSync");
  await resetYjsSync();
});

// --- Tests ---------------------------------------------------------------

describe("rejoinRoom", () => {
  it("builds the provider against the requested room", async () => {
    const { rejoinRoom } = await import("../yjsSync");
    await rejoinRoom("room-new");
    expect(lastBuiltRoom).toBe("room-new");
    expect(providerConstructionCount).toBe(1);
  });

  it("writes the new room id to localStorage", async () => {
    const { rejoinRoom } = await import("../yjsSync");
    await rejoinRoom("persisted-room");
    expect(localStorage.getItem(ROOM_KEY)).toBe("persisted-room");
  });

  it("tears down the previous instance before rebuilding", async () => {
    const { getYjsSync, rejoinRoom } = await import("../yjsSync");
    // Establish a first instance.
    await getYjsSync();
    expect(providerConstructionCount).toBe(1);
    expect(disconnectCalls).toBe(0);

    await rejoinRoom("second-room");

    // The old provider must have been disconnected.
    expect(disconnectCalls).toBeGreaterThanOrEqual(1);
    // And a new provider built against the new room.
    expect(lastBuiltRoom).toBe("second-room");
    expect(providerConstructionCount).toBe(2);
  });

  it("is a no-op (no teardown, no rebuild) when rejoining the current room", async () => {
    const { getYjsSync, rejoinRoom } = await import("../yjsSync");
    await getYjsSync(); // builds against whatever localStorage has
    const firstRoom = lastBuiltRoom;
    const constructionsBefore = providerConstructionCount;

    await rejoinRoom(firstRoom!);

    expect(providerConstructionCount).toBe(constructionsBefore);
    expect(lastBuiltRoom).toBe(firstRoom);
  });

  it("rejects an empty room id", async () => {
    const { rejoinRoom } = await import("../yjsSync");
    await expect(rejoinRoom("")).rejects.toThrow(/roomId is required/);
  });

  it("returns a YjsSyncState bound to the new room", async () => {
    const { rejoinRoom } = await import("../yjsSync");
    const state = await rejoinRoom("return-value-room");
    expect(state.room).toBe("return-value-room");
  });
});

describe("IndexeddbPersistence guard", () => {
  it("does not throw when indexedDB is undefined", async () => {
    const original = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    // Simulate a WebView without IndexedDB.
    Object.defineProperty(globalThis, "indexedDB", {
      value: undefined,
      configurable: true,
    });
    try {
      const { resetYjsSync, getYjsSync } = await import("../yjsSync");
      await resetYjsSync();
      // Should resolve rather than throw.
      const state = await getYjsSync();
      // Provider still built; persistence just skipped.
      expect(state.provider).toBeDefined();
      expect(lastBuiltRoom).not.toBeNull();
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        value: original,
        configurable: true,
      });
    }
  });
});

describe("updateYjsSyncStatus", () => {
  it("rebuilds the provider with the new URL from settings", async () => {
    const { getYjsSync, updateYjsSyncStatus } = await import("../yjsSync");
    const { useSettingsStore } = await import("../../stores/settingsStore");

    // Initialize first
    const initialSync = await getYjsSync();
    expect(initialSync.url).toBe("wss://sync.readsync.org");

    // Update settings store with a custom url
    useSettingsStore.getState().updateSettings({
      sync: {
        ...useSettingsStore.getState().settings.sync,
        yjs: { enabled: true, url: "wss://my-custom.sync.server" },
      },
    });

    // Apply URL update
    const updatedSync = await updateYjsSyncStatus();
    expect(updatedSync.url).toBe("wss://my-custom.sync.server");
    expect(providerConstructionCount).toBe(2); // Initial build + URL update rebuild
  });

  it("rejoinRoom triggers updateYjsSyncStatus on URL change for the same room", async () => {
    const { rejoinRoom } = await import("../yjsSync");
    const { useSettingsStore } = await import("../../stores/settingsStore");

    // Join room first
    const state1 = await rejoinRoom("same-room-test");
    expect(state1.url).toBe("wss://sync.readsync.org");

    // Update URL setting
    useSettingsStore.getState().updateSettings({
      sync: {
        ...useSettingsStore.getState().settings.sync,
        yjs: { enabled: true, url: "wss://custom-rejoin-url" },
      },
    });

    // Rejoin the same room - should trigger URL change rebuild
    const state2 = await rejoinRoom("same-room-test");
    expect(state2.url).toBe("wss://custom-rejoin-url");
    expect(state2.room).toBe("same-room-test");
  });
});

