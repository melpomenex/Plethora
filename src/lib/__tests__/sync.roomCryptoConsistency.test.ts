import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  secret: null as string | null,
  key: null as Uint8Array | null,
  binding: null as Uint8Array | null,
  setKey: vi.fn(async (value: Uint8Array) => {
    storage.key = value.slice();
  }),
  setSecret: vi.fn(async (value: string) => {
    storage.secret = value;
  }),
  setBinding: vi.fn(async (value: Uint8Array) => {
    storage.binding = value.slice();
  }),
  clearBinding: vi.fn(async () => {
    storage.binding = null;
  }),
}));

const cryptoMocks = vi.hoisted(() => ({
  deriveRoomKey: vi.fn(async (secret: string, roomId: string) => {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${roomId}\0${secret}`),
    );
    return new Uint8Array(digest);
  }),
}));

vi.mock('../sync/secureStorage', () => ({
  setCachedRoomKey: storage.setKey,
  getCachedRoomKey: vi.fn(async () => storage.key?.slice() ?? null),
  clearAllCachedSyncCrypto: vi.fn(async () => {
    storage.secret = null;
    storage.key = null;
    storage.binding = null;
  }),
  setCachedRoomSecret: storage.setSecret,
  getCachedRoomSecret: vi.fn(async () => storage.secret),
  setCachedRoomBinding: storage.setBinding,
  getCachedRoomBinding: vi.fn(async () => storage.binding?.slice() ?? null),
  clearCachedRoomBinding: storage.clearBinding,
}));

vi.mock('../sync/encryption', () => ({
  deriveRoomKey: cryptoMocks.deriveRoomKey,
  deriveSubKeys: vi.fn(),
}));

import {
  enableEncryptionWithSecret,
  ensureEncryptionEnabled,
} from '../sync/roomCrypto';

beforeEach(() => {
  storage.secret = null;
  storage.key = null;
  storage.binding = null;
  vi.clearAllMocks();
});

describe('room crypto cache consistency', () => {
  it('writes the binding marker after the secret and derived key', async () => {
    await enableEncryptionWithSecret('room-a', 'shared-secret');

    expect(storage.secret).toBe('shared-secret');
    expect(storage.key).toHaveLength(32);
    expect(storage.binding).toHaveLength(32);
    expect(storage.clearBinding).toHaveBeenCalledTimes(1);
  });

  it('accepts a valid binding without repeating Argon2 derivation', async () => {
    await enableEncryptionWithSecret('room-a', 'shared-secret');
    cryptoMocks.deriveRoomKey.mockClear();
    storage.setKey.mockClear();
    storage.setSecret.mockClear();
    storage.setBinding.mockClear();
    storage.clearBinding.mockClear();

    await expect(ensureEncryptionEnabled('room-a')).resolves.toBe('shared-secret');

    expect(cryptoMocks.deriveRoomKey).not.toHaveBeenCalled();
    expect(storage.setKey).not.toHaveBeenCalled();
  });

  it('repairs a legacy secret/key pair with no binding marker', async () => {
    storage.secret = 'shared-secret';
    storage.key = new Uint8Array(32).fill(7);

    await expect(ensureEncryptionEnabled('room-a')).resolves.toBe('shared-secret');

    expect(cryptoMocks.deriveRoomKey).toHaveBeenCalledWith('shared-secret', 'room-a');
    expect(storage.binding).toHaveLength(32);
    expect(storage.key).not.toEqual(new Uint8Array(32).fill(7));
  });

  it('repairs a mismatched secret and derived key even when a stale binding exists', async () => {
    await enableEncryptionWithSecret('room-a', 'old-secret');
    storage.secret = 'new-secret';
    cryptoMocks.deriveRoomKey.mockClear();

    await expect(ensureEncryptionEnabled('room-a')).resolves.toBe('new-secret');

    expect(cryptoMocks.deriveRoomKey).toHaveBeenCalledWith('new-secret', 'room-a');
    const expected = await cryptoMocks.deriveRoomKey('new-secret', 'room-a');
    expect(Array.from(storage.key ?? [])).toEqual(Array.from(expected));
  });
});
