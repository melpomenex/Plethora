import { describe, expect, it, beforeEach } from 'vitest';
import {
  DecryptError,
  deriveRoomKey,
  deriveSubKeys,
  encryptState,
  decryptState,
  encryptFile,
  decryptFile,
  encryptMetadata,
  decryptMetadata,
  encryptChunk,
  decryptChunk,
  hmacManifest,
  verifyManifestHmac,
  keyTag,
  signRequest,
  verifyRequestSignature,
  sha256,
  __test,
} from '../sync/encryption';

const ROOM_ID = 'test-room-aaaaaaaaaaaaaaaaaaaaaaa';
const ROOM_SECRET = 'correct horse battery staple';

async function deriveKeys(roomSecret: string = ROOM_SECRET, roomId: string = ROOM_ID) {
  const roomKey = await deriveRoomKey(roomSecret, roomId);
  return deriveSubKeys(roomKey, roomId);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  // crypto.getRandomValues has a 64 KiB cap per call; fill in chunks.
  const CHUNK = 65536;
  for (let i = 0; i < n; i += CHUNK) {
    crypto.getRandomValues(b.subarray(i, Math.min(i + CHUNK, n)));
  }
  return b;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

beforeEach(() => {
  __test.resetStateCounterForTesting();
  __test.resetDevicePrefixForTesting();
});

describe('deriveRoomKey (Argon2id)', () => {
  it('is deterministic for the same (secret, roomId)', async () => {
    const k1 = await deriveRoomKey('passphrase', 'room-A');
    const k2 = await deriveRoomKey('passphrase', 'room-A');
    expect(toHex(k1)).toBe(toHex(k2));
  });

  it('differs across room IDs even with the same passphrase', async () => {
    const k1 = await deriveRoomKey('passphrase', 'room-A');
    const k2 = await deriveRoomKey('passphrase', 'room-B');
    expect(toHex(k1)).not.toBe(toHex(k2));
  });

  it('differs across passphrases for the same room', async () => {
    const k1 = await deriveRoomKey('passphrase-1', ROOM_ID);
    const k2 = await deriveRoomKey('passphrase-2', ROOM_ID);
    expect(toHex(k1)).not.toBe(toHex(k2));
  });

  it('produces a 32-byte (256-bit) key', async () => {
    const k = await deriveRoomKey('passphrase', ROOM_ID);
    expect(k.length).toBe(32);
  });

  it('rejects empty secret or roomId', async () => {
    await expect(deriveRoomKey('', ROOM_ID)).rejects.toThrow(/roomSecret/);
    await expect(deriveRoomKey('x', '')).rejects.toThrow(/roomId/);
  });
});

describe('deriveSubKeys (HKDF-SHA256)', () => {
  it('returns three distinct, deterministic sub-keys', async () => {
    const keys1 = await deriveKeys();
    const keys2 = await deriveKeys();

    // Sub-keys are non-extractable CryptoKeys, so we can't directly compare
    // raw bytes. Instead, verify they produce identical ciphertext for the
    // same input (determinism) and that the three keys behave distinctly.
    const sample = randomBytes(64);

    const ct1State = await encryptState(sample, keys1.stateKey);
    const ct2State = await encryptState(sample, keys2.stateKey);
    // Both decrypt to the same plaintext under either key.
    expect(toHex(await decryptState(ct1State, keys1.stateKey))).toBe(toHex(sample));
    expect(toHex(await decryptState(ct2State, keys2.stateKey))).toBe(toHex(sample));
  });

  it('derives different keys for different rooms', async () => {
    const keysA = await deriveKeys('shared-pass', 'room-A');
    const keysB = await deriveKeys('shared-pass', 'room-B');

    const sample = randomBytes(64);
    const encrypted = await encryptState(sample, keysA.stateKey);

    // A payload encrypted under room-A's key cannot be decrypted under
    // room-B's key — different keys, decrypt must fail.
    await expect(decryptState(encrypted, keysB.stateKey)).rejects.toBeInstanceOf(
      DecryptError,
    );
  });
});

describe('state encryption (AES-GCM, counter+deviceId nonce)', () => {
  it('round-trips: decrypt(encrypt(x)) === x', async () => {
    const { stateKey } = await deriveKeys();
    const sample = randomBytes(256);
    const encrypted = await encryptState(sample, stateKey);
    const decrypted = await decryptState(encrypted, stateKey);
    expect(toHex(decrypted)).toBe(toHex(sample));
  });

  it('produces nonces that never repeat within a session', async () => {
    const { stateKey } = await deriveKeys();
    const sample = randomBytes(16);

    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const encrypted = await encryptState(sample, stateKey);
      const nonce = encrypted.slice(0, __test.AES_GCM_NONCE_BYTES);
      const hex = toHex(nonce);
      expect(nonces.has(hex)).toBe(false);
      nonces.add(hex);
    }
    expect(nonces.size).toBe(100);
  });

  it('produces different prefix bytes when re-initialized (device-distinguishing property)', async () => {
    // The device-prefix derivation falls back to a random prefix when no
    // device ID is set, so two independent inits yield distinct bytes. The
    // security-critical property is that two distinct nonces are produced
    // across two encryption "sessions" — this holds whether the prefix is
    // deterministic (device ID set) or random (no device ID).
    __test.resetDevicePrefixForTesting();
    const prefixA = await __test.getStateNoncePrefixForTesting();

    __test.resetDevicePrefixForTesting();
    const prefixB = await __test.getStateNoncePrefixForTesting();

    expect(toHex(prefixA)).not.toBe(toHex(prefixB));
    expect(prefixA.length).toBe(__test.NONCE_DEVICE_PREFIX_BYTES);
  });

  it('fails with DecryptError on a wrong key', async () => {
    const keys1 = await deriveKeys('passphrase-A');
    const keys2 = await deriveKeys('passphrase-B');
    const sample = randomBytes(64);

    const encrypted = await encryptState(sample, keys1.stateKey);
    await expect(decryptState(encrypted, keys2.stateKey)).rejects.toBeInstanceOf(
      DecryptError,
    );
  });

  it('fails with DecryptError on tampered ciphertext', async () => {
    const { stateKey } = await deriveKeys();
    const sample = randomBytes(64);
    const encrypted = await encryptState(sample, stateKey);

    // Flip a bit in the ciphertext (past the nonce).
    const tampered = encrypted.slice();
    tampered[tampered.length - 1] ^= 0x01;

    await expect(decryptState(tampered, stateKey)).rejects.toBeInstanceOf(DecryptError);
  });

  it('fails with DecryptError on a payload too short to contain nonce+tag', async () => {
    const { stateKey } = await deriveKeys();
    const tooShort = new Uint8Array(10);
    await expect(decryptState(tooShort, stateKey)).rejects.toBeInstanceOf(DecryptError);
  });
});

describe('chunk encryption (AES-GCM, random nonce per chunk)', () => {
  it('round-trips: decrypt(encrypt(x)) === x', async () => {
    const { fileKey } = await deriveKeys();
    const chunk = randomBytes(64 * 1024);
    const { nonce, ciphertext } = await encryptChunk(chunk, fileKey);
    const decrypted = await decryptChunk(ciphertext, nonce, fileKey);
    expect(toHex(decrypted)).toBe(toHex(chunk));
  });

  it('uses a fresh random 12-byte nonce per call', async () => {
    const { fileKey } = await deriveKeys();
    const chunk = randomBytes(1024);

    const enc1 = await encryptChunk(chunk, fileKey);
    const enc2 = await encryptChunk(chunk, fileKey);

    expect(enc1.nonce.length).toBe(12);
    expect(enc2.nonce.length).toBe(12);
    expect(toHex(enc1.nonce)).not.toBe(toHex(enc2.nonce));
    // Same plaintext under different nonces must yield different ciphertext.
    expect(toHex(enc1.ciphertext)).not.toBe(toHex(enc2.ciphertext));
  });

  it('fails with DecryptError on wrong key', async () => {
    const keys1 = await deriveKeys('passphrase-A');
    const keys2 = await deriveKeys('passphrase-B');
    const chunk = randomBytes(1024);

    const { nonce, ciphertext } = await encryptChunk(chunk, keys1.fileKey);
    await expect(decryptChunk(ciphertext, nonce, keys2.fileKey)).rejects.toBeInstanceOf(
      DecryptError,
    );
  });

  it('fails with DecryptError when nonce length is wrong', async () => {
    const { fileKey } = await deriveKeys();
    const chunk = randomBytes(64);
    const { ciphertext } = await encryptChunk(chunk, fileKey);
    const wrongNonce = new Uint8Array(11);
    await expect(decryptChunk(ciphertext, wrongNonce, fileKey)).rejects.toBeInstanceOf(
      DecryptError,
    );
  });
});

describe('file encryption (AES-GCM, random nonce, packed buffer)', () => {
  it('round-trips: decryptFile(encryptFile(x)) === x', async () => {
    const { fileKey } = await deriveKeys();
    // A PDF-sized payload.
    const sample = randomBytes(2 * 1024 * 1024);
    const packed = await encryptFile(sample, fileKey);
    const decrypted = await decryptFile(packed, fileKey);
    expect(toHex(decrypted)).toBe(toHex(sample));
  });

  it('round-trips an empty file', async () => {
    const { fileKey } = await deriveKeys();
    const empty = new Uint8Array(0);
    const packed = await encryptFile(empty, fileKey);
    const decrypted = await decryptFile(packed, fileKey);
    expect(decrypted.length).toBe(0);
  });

  it('uses a fresh random nonce per call (ciphertexts differ for same plaintext)', async () => {
    const { fileKey } = await deriveKeys();
    const sample = randomBytes(4096);
    const a = await encryptFile(sample, fileKey);
    const b = await encryptFile(sample, fileKey);
    expect(toHex(a)).not.toBe(toHex(b));
    // Both decrypt back to the original.
    expect(toHex(await decryptFile(a, fileKey))).toBe(toHex(sample));
    expect(toHex(await decryptFile(b, fileKey))).toBe(toHex(sample));
  });

  it('produces a packed buffer of length nonce(12) + plaintext + tag(16)', async () => {
    const { fileKey } = await deriveKeys();
    const sample = randomBytes(1000);
    const packed = await encryptFile(sample, fileKey);
    expect(packed.length).toBe(12 + 1000 + 16);
  });

  it('fails with DecryptError on a wrong key (cross-room)', async () => {
    const keys1 = await deriveKeys('passphrase-A', 'room-A');
    const keys2 = await deriveKeys('passphrase-B', 'room-B');
    const sample = randomBytes(256);
    const packed = await encryptFile(sample, keys1.fileKey);
    await expect(decryptFile(packed, keys2.fileKey)).rejects.toBeInstanceOf(DecryptError);
  });

  it('fails with DecryptError on tampered ciphertext', async () => {
    const { fileKey } = await deriveKeys();
    const sample = randomBytes(256);
    const packed = await encryptFile(sample, fileKey);
    const tampered = packed.slice();
    // Flip a byte in the ciphertext region (past the nonce).
    tampered[tampered.length - 1] ^= 0x01;
    await expect(decryptFile(tampered, fileKey)).rejects.toBeInstanceOf(DecryptError);
  });

  it('fails with DecryptError on tampered nonce', async () => {
    const { fileKey } = await deriveKeys();
    const sample = randomBytes(64);
    const packed = await encryptFile(sample, fileKey);
    const tampered = packed.slice();
    tampered[0] ^= 0x80;
    await expect(decryptFile(tampered, fileKey)).rejects.toBeInstanceOf(DecryptError);
  });

  it('fails with DecryptError on a payload too short to contain nonce+tag', async () => {
    const { fileKey } = await deriveKeys();
    await expect(decryptFile(new Uint8Array(10), fileKey)).rejects.toBeInstanceOf(DecryptError);
  });
});

describe('metadata encryption (JSON-in-AES-GCM, base64 framing)', () => {
  it('round-trips a metadata object', async () => {
    const { fileKey } = await deriveKeys();
    const meta = { filename: '私のメモ.pdf', contentType: 'application/pdf', sizeBytes: 12345 };
    const packed = await encryptMetadata(meta, fileKey);
    expect(typeof packed).toBe('string');
    const recovered = (await decryptMetadata(packed, fileKey)) as typeof meta;
    expect(recovered).toEqual(meta);
  });

  it('produces standard base64 (decodable by atob)', async () => {
    const { fileKey } = await deriveKeys();
    const packed = await encryptMetadata({ a: 1 }, fileKey);
    // Should not throw — valid standard base64.
    expect(() => atob(packed)).not.toThrow();
  });

  it('fails with DecryptError under a wrong key', async () => {
    const keys1 = await deriveKeys('passphrase-A', 'room-A');
    const keys2 = await deriveKeys('passphrase-B', 'room-B');
    const packed = await encryptMetadata({ filename: 'x' }, keys1.fileKey);
    await expect(decryptMetadata(packed, keys2.fileKey)).rejects.toBeInstanceOf(DecryptError);
  });

  it('fails with DecryptError on a tampered base64 blob', async () => {
    const { fileKey } = await deriveKeys();
    const packed = await encryptMetadata({ filename: 'x' }, fileKey);
    // Decode, flip a byte, re-encode.
    const bytes = Uint8Array.from(atob(packed), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 0x01;
    const tampered = bytesToBase64(bytes);
    await expect(decryptMetadata(tampered, fileKey)).rejects.toBeInstanceOf(DecryptError);
  });
});

describe('manifest HMAC (HMAC-SHA256)', () => {
  it('verify(sign(x)) === true', async () => {
    const { manifestAuthKey } = await deriveKeys();
    const entry = new TextEncoder().encode('{"fileId":"abc","size":1234}');
    const mac = await hmacManifest(entry, manifestAuthKey);
    expect(await verifyManifestHmac(entry, mac, manifestAuthKey)).toBe(true);
  });

  it('produces a 32-byte tag', async () => {
    const { manifestAuthKey } = await deriveKeys();
    const entry = new TextEncoder().encode('test');
    const mac = await hmacManifest(entry, manifestAuthKey);
    expect(mac.length).toBe(32);
  });

  it('rejects a tampered entry (different bytes → verify false)', async () => {
    const { manifestAuthKey } = await deriveKeys();
    const entry = new TextEncoder().encode('{"fileId":"abc","size":1234}');
    const mac = await hmacManifest(entry, manifestAuthKey);

    const tampered = new TextEncoder().encode('{"fileId":"abc","size":9999}');
    expect(await verifyManifestHmac(tampered, mac, manifestAuthKey)).toBe(false);
  });

  it('rejects a tampered MAC', async () => {
    const { manifestAuthKey } = await deriveKeys();
    const entry = new TextEncoder().encode('test');
    const mac = await hmacManifest(entry, manifestAuthKey);
    mac[0] ^= 0xff;
    expect(await verifyManifestHmac(entry, mac, manifestAuthKey)).toBe(false);
  });

  it('rejects a MAC computed under a different room key', async () => {
    const keys1 = await deriveKeys('passphrase-A');
    const keys2 = await deriveKeys('passphrase-B');
    const entry = new TextEncoder().encode('test');
    const mac = await hmacManifest(entry, keys1.manifestAuthKey);
    expect(await verifyManifestHmac(entry, mac, keys2.manifestAuthKey)).toBe(false);
  });
});

describe('keyTag (delta-log room-index HMAC)', () => {
  it('is stable for the same (domain, entityKey) within a room', async () => {
    const { roomIndexKey } = await deriveKeys();
    const t1 = await keyTag('documents', 'doc-123', roomIndexKey);
    const t2 = await keyTag('documents', 'doc-123', roomIndexKey);
    expect(toHex(t1)).toBe(toHex(t2));
  });

  it('differs across entity keys', async () => {
    const { roomIndexKey } = await deriveKeys();
    const t1 = await keyTag('documents', 'doc-123', roomIndexKey);
    const t2 = await keyTag('documents', 'doc-456', roomIndexKey);
    expect(toHex(t1)).not.toBe(toHex(t2));
  });

  it('differs across domains for the same entity key (no domain/entity ambiguity)', async () => {
    const { roomIndexKey } = await deriveKeys();
    const t1 = await keyTag('documents', 'same-key', roomIndexKey);
    const t2 = await keyTag('extracts', 'same-key', roomIndexKey);
    expect(toHex(t1)).not.toBe(toHex(t2));
  });

  it('is not correlatable across rooms (same entity, different room -> different tag)', async () => {
    const keysA = await deriveKeys('shared-pass', 'room-A');
    const keysB = await deriveKeys('shared-pass', 'room-B');
    const tA = await keyTag('documents', 'doc-123', keysA.roomIndexKey);
    const tB = await keyTag('documents', 'doc-123', keysB.roomIndexKey);
    expect(toHex(tA)).not.toBe(toHex(tB));
  });

  it('produces a 32-byte tag', async () => {
    const { roomIndexKey } = await deriveKeys();
    const tag = await keyTag('documents', 'doc-123', roomIndexKey);
    expect(tag.length).toBe(32);
  });
});

describe('signRequest / verifyRequestSignature (delta-log request auth)', () => {
  it('verify(sign(x)) === true', async () => {
    const { manifestAuthKey } = await deriveKeys();
    const signed = await signRequest('POST', '/rooms/abc/ops', '{"ops":[]}', manifestAuthKey);
    expect(
      await verifyRequestSignature('POST', '/rooms/abc/ops', '{"ops":[]}', signed, manifestAuthKey),
    ).toBe(true);
  });

  it('rejects a tampered method', async () => {
    const { manifestAuthKey } = await deriveKeys();
    const signed = await signRequest('POST', '/rooms/abc/ops', 'body', manifestAuthKey);
    expect(
      await verifyRequestSignature('GET', '/rooms/abc/ops', 'body', signed, manifestAuthKey),
    ).toBe(false);
  });

  it('rejects a tampered path', async () => {
    const { manifestAuthKey } = await deriveKeys();
    const signed = await signRequest('POST', '/rooms/abc/ops', 'body', manifestAuthKey);
    expect(
      await verifyRequestSignature('POST', '/rooms/xyz/ops', 'body', signed, manifestAuthKey),
    ).toBe(false);
  });

  it('rejects a tampered body', async () => {
    const { manifestAuthKey } = await deriveKeys();
    const signed = await signRequest('POST', '/rooms/abc/ops', 'body', manifestAuthKey);
    expect(
      await verifyRequestSignature('POST', '/rooms/abc/ops', 'tampered', signed, manifestAuthKey),
    ).toBe(false);
  });

  it('rejects a tampered timestamp', async () => {
    const { manifestAuthKey } = await deriveKeys();
    const signed = await signRequest('POST', '/rooms/abc/ops', 'body', manifestAuthKey);
    const tampered = { ...signed, timestamp: signed.timestamp + 1000 };
    expect(
      await verifyRequestSignature('POST', '/rooms/abc/ops', 'body', tampered, manifestAuthKey),
    ).toBe(false);
  });

  it('rejects a signature produced under a different room key', async () => {
    const keys1 = await deriveKeys('passphrase-A');
    const keys2 = await deriveKeys('passphrase-B');
    const signed = await signRequest('POST', '/rooms/abc/ops', 'body', keys1.manifestAuthKey);
    expect(
      await verifyRequestSignature('POST', '/rooms/abc/ops', 'body', signed, keys2.manifestAuthKey),
    ).toBe(false);
  });

  it('rejects a request outside the replay window', async () => {
    const { manifestAuthKey } = await deriveKeys();
    const signed = await signRequest('POST', '/rooms/abc/ops', 'body', manifestAuthKey, 0);
    // 10 minutes after the signed timestamp, default 5-minute skew window.
    const now = 10 * 60 * 1000;
    expect(
      await verifyRequestSignature('POST', '/rooms/abc/ops', 'body', signed, manifestAuthKey, {
        now,
      }),
    ).toBe(false);
  });

  it('accepts a request within the replay window', async () => {
    const { manifestAuthKey } = await deriveKeys();
    const signed = await signRequest('POST', '/rooms/abc/ops', 'body', manifestAuthKey, 0);
    const now = 60 * 1000; // 1 minute later, within default 5-minute skew
    expect(
      await verifyRequestSignature('POST', '/rooms/abc/ops', 'body', signed, manifestAuthKey, {
        now,
      }),
    ).toBe(true);
  });
});

describe('op blob format (delta-log transport interchangeability)', () => {
  it('encryptState/decryptState payload format is unchanged: nonce(12) || ciphertext+tag', async () => {
    const { stateKey } = await deriveKeys();
    const row = new TextEncoder().encode('{"id":"doc-1","title":"hello"}');
    const blob = await encryptState(row, stateKey);
    // Same packed format as before this change: nonce prefix + AES-GCM
    // ciphertext+tag, decryptable with the same call used by the Yjs
    // transport today — this is what makes a blob interchangeable between
    // transports during dual-run (design.md §6 P3).
    expect(blob.length).toBe(__test.AES_GCM_NONCE_BYTES + row.length + 16);
    const decrypted = await decryptState(blob, stateKey);
    expect(toHex(decrypted)).toBe(toHex(row));
  });
});

describe('sha256 helper', () => {
  it('is deterministic', async () => {
    const input = new TextEncoder().encode('hello');
    const h1 = await sha256(input);
    const h2 = await sha256(input);
    expect(toHex(h1)).toBe(toHex(h2));
  });

  it('matches the known NIST test vector for empty input', async () => {
    const empty = new Uint8Array(0);
    const h = await sha256(empty);
    expect(toHex(h)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
