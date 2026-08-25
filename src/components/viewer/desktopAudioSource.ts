/**
 * Desktop audio source resolution (eliminate-long-running-memory-growth,
 * task 5.5).
 *
 * Desktop (incl. macOS) audiobook/podcast playback used to read the ENTIRE
 * file via `readDocumentFile` into an ArrayBuffer → Blob → object URL
 * (incident finding 6: a single long audiobook held hundreds of MB live in
 * the WebContent process). Mobile already streamed through the native media
 * server; desktop now does the same:
 *
 *   1. Preferred: `get_media_stream_url` — the local media server streams
 *      with HTTP Range support; the WebView fetches only the bytes it needs.
 *   2. Bounded fallback (stream unavailable): one whole-file read whose size
 *      is checked BEFORE materialization by the backend —
 *      `read_document_file` refuses files above 256 MiB
 *      (MAX_DESKTOP_INLINED_BYTES, src-tauri/src/commands/document.rs) with
 *      an attributed error. The blob URL is registry-owned
 *      ("desktop-audio-fallback") so its lifetime is observable and revocable.
 */

import { invokeCommand } from "../../lib/tauri";
import { readDocumentFile } from "../../api/documents";
import { createOwnedObjectUrl } from "../../diagnostics/ownedObjectUrl";

export interface DesktopAudioDeps {
  getStreamUrl?: (filePath: string) => Promise<string>;
  readFile?: (filePath: string) => Promise<Uint8Array>;
  mimeTypeOf?: (path: string) => string;
}

function audioMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "wav":
      return "audio/wav";
    case "m4a":
    case "m4b":
      return "audio/mp4";
    case "aac":
      return "audio/aac";
    case "ogg":
      return "audio/ogg";
    case "flac":
      return "audio/flac";
    case "opus":
      return "audio/opus";
    default:
      return "audio/mpeg";
  }
}

/**
 * Resolve a playable source URL for a local audio file on desktop.
 * Throws when neither streaming nor the bounded fallback can produce one.
 */
export async function loadDesktopAudioSource(
  filePath: string,
  deps: DesktopAudioDeps = {},
): Promise<string> {
  const getStreamUrl = deps.getStreamUrl ?? ((p: string) => invokeCommand<string>("get_media_stream_url", { filePath: p }));
  const readFile = deps.readFile ?? ((p: string) => readDocumentFile(p));
  const mimeTypeOf = deps.mimeTypeOf ?? audioMimeType;

  // 1. Streaming is the desktop default.
  try {
    const streamUrl = await getStreamUrl(filePath);
    if (streamUrl) return streamUrl;
  } catch (error) {
    console.warn("[desktopAudioSource] stream unavailable, trying bounded fallback:", error);
  }

  // 2. Bounded whole-file fallback: the backend refuses >256 MiB files
  // before transferring a single byte, so the WebView heap is never handed
  // an unbounded payload.
  const bytes = await readFile(filePath);
  if (bytes.byteLength === 0) {
    throw new Error("Empty file data");
  }
  return createOwnedObjectUrl(new Blob([bytes], { type: mimeTypeOf(filePath) }), {
    owner: "desktop-audio-fallback",
  });
}
