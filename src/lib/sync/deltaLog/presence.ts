/**

 Encrypted device-presence payload for the delta-log server's device roster
 (task 5.6). `devicePresence` (FileManifest's hasFiles list) is ephemeral
 P2P file-availability state, not sync history — it never belonged in a
 monotonically-growing Yjs document, and moves here instead: reported
 alongside the sync cursor (POST /rooms/{room}/cursor's presenceBlob field)
 and read back from the same roster (GET /rooms/{room}/head).

 Sealed under the room's fileKey — the same key used for file manifest
 entries — via the existing encryptMetadata/decryptMetadata helpers, so the
 server holds ciphertext only, identical to every other opaque blob it
 stores.

*/

import { encryptMetadata, decryptMetadata, type SubKeys } from "../encryption";

export interface DevicePresencePayload {
  /** Plaintext device id (FileManifest's DevicePresence.deviceId). The wire-level deviceTag is opaque, so the id must travel inside the encrypted payload for a reader to recover it. */
  deviceId: string;
  hasFiles: string[];
  lastSeen: string;
}

export async function encodePresenceBlob(
  payload: DevicePresencePayload,
  fileKey: SubKeys["fileKey"],
): Promise<string> {
  return encryptMetadata(payload, fileKey);
}

/** Returns null on decrypt/parse failure (wrong key, corrupt blob) rather than throwing — one bad device's presence must not break reading the whole roster. */
export async function decodePresenceBlob(
  blobB64: string,
  fileKey: SubKeys["fileKey"],
): Promise<DevicePresencePayload | null> {
  try {
    const parsed = (await decryptMetadata(blobB64, fileKey)) as Partial<DevicePresencePayload>;
    if (
      !parsed ||
      typeof parsed.deviceId !== "string" ||
      !Array.isArray(parsed.hasFiles) ||
      typeof parsed.lastSeen !== "string"
    ) {
      return null;
    }
    return { deviceId: parsed.deviceId, hasFiles: parsed.hasFiles, lastSeen: parsed.lastSeen };
  } catch {
    return null;
  }
}
