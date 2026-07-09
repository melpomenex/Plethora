import { getSyncRoomId } from "./yjsSync";
import { useSettingsStore } from "../stores/settingsStore";
import { encryptFile, decryptFile, encryptMetadata, decryptMetadata, DecryptError } from "./sync/encryption";
import { getCachedSubKeys } from "./sync/roomCrypto";
import { isTauri, invokeCommand } from "../lib/tauri";

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

  // The file bytes to upload and (optionally) the encrypted metadata sidecar.
  let uploadBytes: Uint8Array;
  let contentType: string;
  let filename: string;
  let encMetadata: string | undefined;

  if (fileKey) {
    // Encrypted path: encrypt the file bytes under the room's file sub-key,
    // and encrypt the {filename, contentType} metadata so the server cannot
    // read document titles or infer what the user is reading. The ciphertext
    // is uploaded as application/octet-stream; the multipart field's filename
    // is the opaque id (no leak).
    const plaintext = new Uint8Array(await file.arrayBuffer());
    const ciphertext = await encryptFile(plaintext, fileKey);
    encMetadata = await encryptMetadata(
      { filename: file.name, contentType: file.type, sizeBytes: file.size },
      fileKey,
    );
    uploadBytes = ciphertext;
    contentType = "application/octet-stream";
    // Use the id (or "blob") as the field filename — it's opaque and the
    // server discards it in favor of the ?id= query param anyway.
    filename = id ? `${id}.bin` : "blob.bin";
  } else {
    // Plaintext fallback (encryption not enabled on this room).
    uploadBytes = new Uint8Array(await file.arrayBuffer());
    contentType = file.type || "application/octet-stream";
    filename = file.name;
  }

  if (isTauri()) {
    // Route through the native backend: reqwest is not subject to CORS, whereas
    // a webview `fetch()` on this cross-origin URL is blocked by CORS.
    const meta = await invokeCommand<YjsFileMeta>("yjs_file_upload", {
      url: url.toString(),
      filename,
      contentType,
      bytes: Array.from(uploadBytes),
      encMetadata: encMetadata ?? null,
    });
    return meta;
  }

  const form = new FormData();
  form.append("file", new Blob([uploadBytes], { type: contentType }), filename);
  if (encMetadata) form.append("encMetadata", encMetadata);

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
  const fileUrl = `${base}/files/${encodeURIComponent(room)}/${encodeURIComponent(id)}`;
  const fileKey = await getFileKey();

  // Fetch raw bytes + the encrypted-metadata header. In Tauri we go through the
  // native backend (reqwest, not subject to CORS); in the browser we use
  // webview fetch directly.
  let packed: Uint8Array;
  let encMetadataHeader: string | null;

  if (isTauri()) {
    const dl = await invokeCommand<{ bytes: number[]; encryptedMetadata: string | null }>(
      "yjs_file_download",
      { url: fileUrl },
    );
    packed = Uint8Array.from(dl.bytes);
    encMetadataHeader = dl.encryptedMetadata;
  } else {
    const res = await fetch(fileUrl, { method: "GET" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`yjs file download failed (${res.status}): ${text || res.statusText}`);
    }
    encMetadataHeader = res.headers.get(ENCRYPTED_METADATA_HEADER);
    packed = new Uint8Array(await res.arrayBuffer());
  }

  // Encrypted path: server returned an encMetadata header → decrypt the bytes
  // and recover the original content-type so callers (which key off blob.type)
  // keep working without changes.
  if (fileKey && encMetadataHeader) {
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
        return new Blob([packed], { type: contentType });
      }
      throw err;
    }
    return new Blob([plaintext], { type: contentType });
  }

  // Plaintext path (no key cached, or legacy blob with no encMetadata header).
  return new Blob([packed], { type: "application/octet-stream" });
}

export async function checkRoomFileExists(room: string, id: string): Promise<boolean> {
  try {
    const base = getYjsFileServiceBaseUrl();
    const fileUrl = `${base}/files/${encodeURIComponent(room)}/${encodeURIComponent(id)}`;
    if (isTauri()) {
      // Route through the native backend: reqwest is not subject to CORS.
      return await invokeCommand<boolean>("yjs_file_exists", { url: fileUrl });
    }
    const res = await fetch(fileUrl, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}


