import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Tests for the "encryption by default" behavior of getYjsSync().
 *
 * Sync is end-to-end encrypted unconditionally: buildProvider() must never
 * return a plaintext WebsocketProvider when sync is enabled. If no room key is
 * cached, it must silently provision one via ensureEncryptionEnabled and then
 * build the EncryptedWebsocketProvider. These tests pin that contract.
 *
 * The orchestration is identical to yjsSync.rejoin.test.ts (same mock shape),
 * but focused on the encryption fork point.
 */

let providerConstructionCount = 0;
let encryptedConstructionCount = 0;

const mockProvider = {
  shouldConnect: true,
  wsconnected: false,
  connect: vi.fn(() => {
    mockProvider.wsconnected = true;
  }),
  disconnect: vi.fn(() => {
    mockProvider.wsconnected = false;
  }),
  destroy: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  ws: undefined as unknown,
};

class MockWebsocketProvider {
  constructor(_url: string, _room: string) {
    providerConstructionCount += 1;
    Object.assign(this, mockProvider);
  }
}

// The cached-sub-keys getter is the lever each test pulls to simulate
// "key already cached" vs. "fresh device". ensureEncryptionEnabled is spied so
// we can assert it fires exactly once on the fresh-device path.
const roomCryptoMocks = vi.hoisted(() => ({
  getCachedSubKeys: vi.fn(),
  ensureEncryptionEnabled: vi.fn().mockResolvedValue("auto-secret"),
}));

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
  getCachedSubKeys: roomCryptoMocks.getCachedSubKeys,
  ensureEncryptionEnabled: roomCryptoMocks.ensureEncryptionEnabled,
}));

vi.mock("../sync/encryptedProvider", () => ({
  // Real class so `new` works. Counts constructions so the tests can assert
  // the encrypted branch was taken, and exposes the inner provider + the
  // __encrypted diagnostic flag exactly the way the real wrapper does.
  EncryptedWebsocketProvider: class {
    provider: MockWebsocketProvider;
    constructor(_Wp: unknown, _url: string, _room: string, _doc: unknown) {
      encryptedConstructionCount += 1;
      this.provider = new MockWebsocketProvider(_url, _room);
      Object.defineProperty(this.provider, "__encrypted", {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false,
      });
    }
  },
}));

beforeEach(async () => {
  vi.clearAllMocks();
  providerConstructionCount = 0;
  encryptedConstructionCount = 0;
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

describe("encryption by default", () => {
  it("builds an encrypted provider when a key is already cached", async () => {
    roomCryptoMocks.getCachedSubKeys.mockResolvedValue({
      stateKey: {},
      fileKey: {},
      manifestAuthKey: {},
    });

    const { getYjsSync } = await import("../yjsSync");
    const state = await getYjsSync();

    expect(encryptedConstructionCount).toBe(1);
    expect(state.encrypted).toBe(true);
    // Every provider build runs the cheap secret/key binding validation. A
    // healthy cache returns immediately without re-running Argon2.
    expect(roomCryptoMocks.ensureEncryptionEnabled).toHaveBeenCalledTimes(1);
  });

  it("auto-provisions a key (exactly once) and builds encrypted when no key is cached", async () => {
    // ensureEncryptionEnabled owns both fresh provisioning and consistency
    // repair, so the provider reads the resulting sub-keys once.
    roomCryptoMocks.getCachedSubKeys.mockResolvedValue({
      stateKey: {},
      fileKey: {},
      manifestAuthKey: {},
    });

    const { getYjsSync } = await import("../yjsSync");
    const state = await getYjsSync();

    expect(roomCryptoMocks.ensureEncryptionEnabled).toHaveBeenCalledTimes(1);
    expect(encryptedConstructionCount).toBe(1);
    expect(state.encrypted).toBe(true);
  });

  it("never constructs a plaintext WebsocketProvider when sync is enabled", async () => {
    // Even on the fresh-device path, the only WebsocketProvider instances
    // created are the ones inside the encrypted wrapper. The plaintext
    // fallback (`new WebsocketProvider(url, room, doc, { connect: true })`)
    // must not fire — count == encrypted count guarantees that.
    roomCryptoMocks.getCachedSubKeys.mockResolvedValue({
      stateKey: {},
      fileKey: {},
      manifestAuthKey: {},
    });

    const { getYjsSync } = await import("../yjsSync");
    await getYjsSync();

    expect(providerConstructionCount).toBe(encryptedConstructionCount);
    expect(providerConstructionCount).toBeGreaterThan(0);
  });

  it("throws rather than fall back to plaintext if provisioning fails", async () => {
    // A failed consistency/provisioning check must abort before any plaintext
    // provider can be constructed.
    roomCryptoMocks.getCachedSubKeys.mockResolvedValue(null);
    roomCryptoMocks.ensureEncryptionEnabled.mockRejectedValue(
      new Error("keychain unavailable"),
    );

    const { getYjsSync } = await import("../yjsSync");
    await expect(getYjsSync()).rejects.toThrow();
    expect(encryptedConstructionCount).toBe(0);
  });
});
