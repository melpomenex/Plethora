import { getSyncRoomId } from "./yjsSync";
import { useSettingsStore } from "../stores/settingsStore";
import { encryptFile, decryptFile, encryptMetadata, decryptMetadata, DecryptError } from "./sync/encryption";
import { getCachedSubKeys } from "./sync/roomCrypto";

export type YjsFileMeta = {
  id: string;
  room: string;
  // filename/contentType are present for legacy plaintext uploads; encrypted
  // uploads store these inside `encMetadata` instead and the server returns
  // them empty here.
  filename?: string;
  contentType?: string;
  sizeBytes: number;
  createdAt: string;
  deletedAt: string | null;
  encMetadata?: string | null;
};

// Response header carrying the base64-encoded encrypted metadata blob. The
// server stores this opaquely in the sidecar and echoes it back on GET so the
// client can recover {filename, contentType} after decrypting — without a
// second round-trip.
const ENCRYPTED_METADATA_HEADER = "X-Encrypted-Metadata";

const DEFAULT_YJS_SYNC_URL = "wss://sync.readsync.org";

function wsUrlToHttpOrigin(wsUrl: string): string {
  const u = new URL(wsUrl);
  if (u.protocol === "wss:") u.protocol = "https:";
  else if (u.protocol === "ws:") u.protocol = "http:";
  return u.origin;
}

export function getYjsFileServiceBaseUrl(): string {
  const state = useSettingsStore.getState();
  const wsUrl = state?.settings?.sync?.yjs?.url || import.meta.env.VITE_YJS_SYNC_URL || DEFAULT_YJS_SYNC_URL;
  return wsUrlToHttpOrigin(wsUrl);
}

export function createYjsFilePath(room: string, id: string, filename?: string): string {
  // File path is used as a stable key for IndexedDB caching.
  const safeName = filename ? encodeURIComponent(filename) : "";
  return `yjs-file://${room}/${id}/${safeName}`;
}

export function parseYjsFilePath(filePath: string): { room: string; id: string; filename: string | null } | null {
  if (!filePath.startsWith("yjs-file://")) return null;
  // yjs-file://<room>/<id>/<filename?>
  const withoutScheme = filePath.slice("yjs-file://".length);
  const parts = withoutScheme.split("/");
  const room = parts[0] || "";
  const id = parts[1] || "";
  const filenameEncoded = parts.slice(2).join("/") || "";
  if (!room || !id) return null;
  const filename = filenameEncoded ? decodeURIComponent(filenameEncoded) : null;
  return { room, id, filename: filename };
}

/**
 * Resolve the file sub-key for the current room, or null if encryption is not
 * enabled. Returns null (rather than throwing) so callers can fall back to the
 * plaintext transport — important during the transition period while some
 * rooms are still on "TLS only" mode.
 */
async function getFileKey(): Promise<CryptoKey | null> {
  try {
    const subKeys = await getCachedSubKeys(getSyncRoomId());
    return subKeys?.fileKey ?? null;
  } catch (err) {
    console.warn("[yjs-file-service] failed to load file key; uploading/downloading plaintext", err);
    return null;
  }
}

export async function uploadRoomFile(file: File, room?: string, id?: string): Promise<YjsFileMeta> {
  const useRoom = room || getSyncRoomId();
  const fileKey = await getFileKey();
  const base = getYjsFileServiceBaseUrl();
  const url = new URL(`${base}/files/${encodeURIComponent(useRoom)}`);
  if (id) {
    url.searchParams.set("id", id);
  }

  const form = new FormData();

  if (fileKey) {
    // Encrypted path: encrypt the file bytes under the room's file sub-key,
    // and encrypt the {filename, contentType} metadata so the server cannot
    // read document titles or infer what the user is reading. The ciphertext
    // is uploaded as application/octet-stream; the multipart field's filename
    // is the opaque id (no leak).
    const plaintext = new Uint8Array(await file.arrayBuffer());
    const ciphertext = await encryptFile(plaintext, fileKey);
    const encMetadata = await encryptMetadata(
      { filename: file.name, contentType: file.type, sizeBytes: file.size },
      fileKey,
    );
    const blob = new Blob([ciphertext], { type: "application/octet-stream" });
    // Use the id (or "blob") as the field filename — it's opaque and the
    // server discards it in favor of the ?id= query param anyway.
    const fieldFilename = id ? `${id}.bin` : "blob.bin";
    form.append("file", blob, fieldFilename);
    form.append("encMetadata", encMetadata);
  } else {
    // Plaintext fallback (encryption not enabled on this room).
    form.append("file", file);
  }

  const res = await fetch(url.toString(), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`yjs file upload failed (${res.status}): ${text || res.statusText}`);
  }
  return (await res.json()) as YjsFileMeta;
}

export async function downloadRoomFile(room: string, id: string): Promise<Blob> {
  const base = getYjsFileServiceBaseUrl();
  const res = await fetch(`${base}/files/${encodeURIComponent(room)}/${encodeURIComponent(id)}`, {
    method: "GET",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`yjs file download failed (${res.status}): ${text || res.statusText}`);
  }

  const fileKey = await getFileKey();
  const encMetadataHeader = res.headers.get(ENCRYPTED_METADATA_HEADER);

  // Encrypted path: server returned an encMetadata header → decrypt the bytes
  // and recover the original content-type so callers (which key off blob.type)
  // keep working without changes.
  if (fileKey && encMetadataHeader) {
    const packed = new Uint8Array(await res.arrayBuffer());
    let plaintext: Uint8Array;
    let contentType = "application/octet-stream";
    try {
      const meta = (await decryptMetadata(encMetadataHeader, fileKey)) as {
        contentType?: string;
      } | null;
      if (meta?.contentType) contentType = meta.contentType;
    } catch (err) {
      // Metadata decrypt failure is non-fatal — fall back to octet-stream.
      console.warn("[yjs-file-service] failed to decrypt file metadata", err);
    }
    try {
      plaintext = await decryptFile(packed, fileKey);
    } catch (err) {
      if (err instanceof DecryptError) {
        // Likely a legacy plaintext blob written before encryption was enabled,
        // or a wrong key. Return the raw bytes so the caller can decide.
        console.warn("[yjs-file-service] file decrypt failed; returning raw bytes (legacy?)", err);
        return await res.blob();
      }
      throw err;
    }
    return new Blob([plaintext], { type: contentType });
  }

  // Plaintext path (no key cached, or legacy blob with no encMetadata header).
  return await res.blob();
}

export async function checkRoomFileExists(room: string, id: string): Promise<boolean> {
  try {
    const base = getYjsFileServiceBaseUrl();
    const res = await fetch(`${base}/files/${encodeURIComponent(room)}/${encodeURIComponent(id)}`, {
      method: "HEAD",
    });
    return res.ok;
  } catch {
    return false;
  }
}


