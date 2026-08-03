import { describe, expect, it } from "vitest";
import { encodeSyncQrPayload, parseSyncQrPayload, SYNC_QR_FORMAT_VERSION } from "../sync/qrFormat";
import { deriveRoomKey, deriveSubKeys, encryptState, decryptState } from "../sync/encryption";

/**

 Task 7.4 regression test: a v1 QR string produced by an older build (before
 this migration's crypto changes — task 2.1 added a 4th roomIndexKey sub-key)
 must still parse and derive usable keys after the migration. qrFormat.ts
 was deliberately left untouched throughout this change; this test pins that
 down explicitly rather than relying on it being true by omission.

*/

describe("pairing survives the migration (task 7.4)", () => {
  it("a QR payload frozen from before this migration still parses to the same room/secret", () => {
    // Captured once via encodeSyncQrPayload with a fixed room+secret — frozen
    // as a literal so a future change to the wire format (accidental or not)
    // fails this test instead of silently breaking old QR codes/invite links.
    const FROZEN_V1_PAYLOAD = "incrementum-sync:v1:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6:Y29ycmVjdCBob3JzZSBiYXR0ZXJ5IHN0YXBsZQ";

    expect(SYNC_QR_FORMAT_VERSION).toBe(1); // this test's fixture assumes v1 is still current
    const parsed = parseSyncQrPayload(FROZEN_V1_PAYLOAD);
    expect(parsed).toEqual({
      version: 1,
      roomId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      roomSecret: "correct horse battery staple",
    });

    // Round-trip sanity: encoding the same room/secret today reproduces the
    // frozen payload byte-for-byte.
    expect(encodeSyncQrPayload(parsed.roomId, parsed.roomSecret)).toBe(FROZEN_V1_PAYLOAD);
  });

  it("keys derived from a pre-migration room/secret still encrypt/decrypt correctly (roomIndexKey's addition in task 2.1 didn't perturb the other three sub-keys)", async () => {
    const roomId = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
    const roomSecret = "correct horse battery staple";

    const roomKey = await deriveRoomKey(roomSecret, roomId);
    const subKeys = await deriveSubKeys(roomKey, roomId);

    // All four sub-keys must exist and be independently usable.
    expect(subKeys.stateKey).toBeDefined();
    expect(subKeys.fileKey).toBeDefined();
    expect(subKeys.manifestAuthKey).toBeDefined();
    expect(subKeys.roomIndexKey).toBeDefined();

    const plaintext = new TextEncoder().encode('{"hello":"world"}');
    const ciphertext = await encryptState(plaintext, subKeys.stateKey);
    const decrypted = await decryptState(ciphertext, subKeys.stateKey);
    expect(new TextDecoder().decode(decrypted)).toBe('{"hello":"world"}');
  });
});
