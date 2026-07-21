/**
 * Kindle Clippings Import Utility
 *
 * Handles importing `My Clippings.txt` files from Kindle e-readers
 * into Incrementum Documents + Extracts with content-hash deduplication.
 */

import { invokeCommand, openFilePicker, isNativeMobile } from "../lib/tauri";
import { getBrowserFile } from "../lib/browser-file-store";

export interface KindleBookGroup {
  title: string;
  author: string | null;
  normalizedTitle: string;
  highlightsCount: number;
  notesCount: number;
  bookmarksCount: number;
}

export interface KindleValidationResult {
  books: KindleBookGroup[];
  totalClippings: number;
  totalHighlights: number;
  totalNotes: number;
  totalBookmarks: number;
  warnings: string[];
}

export interface KindleBookPreview {
  title: string;
  author: string | null;
  newHighlights: number;
  existingHighlights: number;
  newNotes: number;
  existingNotes: number;
  skippedBookmarks: number;
  isNewBook: boolean;
}

export interface KindlePreviewResult {
  books: KindleBookPreview[];
  totalNewExtracts: number;
  totalExistingExtracts: number;
  warnings: string[];
}

export interface KindleImportResult {
  newDocuments: number;
  newExtracts: number;
  updatedDocuments: number;
  warnings: string[];
  /**
   * IDs of all documents (newly created or pre-existing) touched by this
   * import. One per book. Populated by the Rust side; older builds omit it.
   */
  documentIds?: string[];
}

/**
 * Filename sniff for Kindle `My Clippings.txt`. Returns true iff the file's
 * basename (without extension) normalizes to `my clippings` —
 * case-insensitive, with runs of whitespace, `_`, and `-` collapsed to a
 * single space, so `my_clippings.txt`, `My-Clippings.txt`, and
 * `MY  CLIPPINGS.txt` all match.
 *
 * Filename-only sniff is acceptable here because the authoritative content
 * sniff happens in the Rust detector (`is_kindle_clippings_path`) before any
 * documents are written. If the file turns out not to be Kindle clippings,
 * the import dialog reports that and the caller can fall back to the generic
 * plain-text import.
 */
export function isKindleClippingsFilename(path: string): boolean {
  // Handle both POSIX (`/`) and Windows (`\`) path separators, plus the
  // bare filename case (no separators).
  const baseWithExt = path.split(/[\\/]/).pop() ?? path;
  // Require a `.txt` extension — the canonical Kindle filename is
  // `My Clippings.txt`, and matching a dot-less file (e.g. literally
  // "My Clippings") would produce false positives. The Rust detector
  // gates the same way via the `file_stem` basename check.
  const dot = baseWithExt.lastIndexOf(".");
  if (dot <= 0) return false;
  const ext = baseWithExt.slice(dot + 1).toLowerCase();
  if (ext !== "txt") return false;
  const stem = baseWithExt.slice(0, dot);
  const normalized = stem
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
  return normalized === "my clippings";
}

/**
 * Read the picked Kindle clippings file as a plain byte array.
 *
 * On native mobile the Tauri dialog returns unreadable `content://` URIs, so
 * `openFilePicker` stores the picked File in the browser-file store and hands
 * back a `browser-file://...` virtual path. This resolves that path back to
 * the File and reads its bytes. Returns `null` on desktop (where `filePath` is
 * a real filesystem path the Rust side reads directly).
 *
 * The byte array is a plain `number[]` (not a `Uint8Array`) because Tauri's
 * IPC JSON-deserializes Rust `Vec<u8>` from a JSON array of numbers.
 */
async function readClippingsBytesForMobile(
  filePath: string,
): Promise<number[] | null> {
  if (!isNativeMobile()) return null;
  const file = getBrowserFile(filePath);
  if (!file) {
    throw new Error(
      "Kindle clippings file not found. Please close the dialog and select the file again.",
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return Array.from(bytes);
}

/**
 * Parse a Kindle clippings file (format check, no DB involved).
 *
 * On mobile, sends the picked file's bytes over IPC (the `*_bytes` command)
 * because the Tauri dialog returns unreadable `content://` URIs on Android.
 */
export async function parseKindleClippings(filePath: string): Promise<KindleValidationResult> {
  const mobileBytes = await readClippingsBytesForMobile(filePath);
  if (mobileBytes !== null) {
    return invokeCommand<KindleValidationResult>("parse_kindle_clippings_file_bytes", {
      fileBytes: mobileBytes,
    });
  }
  return invokeCommand<KindleValidationResult>("parse_kindle_clippings_file", {
    filePath,
  });
}

/**
 * Validate a Kindle clippings file against the existing database (dedup check).
 *
 * On mobile, sends the picked file's bytes over IPC (the `*_bytes` command)
 * because the Tauri dialog returns unreadable `content://` URIs on Android.
 */
export async function validateKindleClippings(filePath: string): Promise<KindlePreviewResult> {
  const mobileBytes = await readClippingsBytesForMobile(filePath);
  if (mobileBytes !== null) {
    return invokeCommand<KindlePreviewResult>("validate_kindle_clippings_bytes", {
      fileBytes: mobileBytes,
    });
  }
  return invokeCommand<KindlePreviewResult>("validate_kindle_clippings", {
    filePath,
  });
}

/**
 * Import a Kindle clippings file into the database.
 *
 * On mobile, sends the picked file's bytes over IPC (the `*_bytes` command)
 * because the Tauri dialog returns unreadable `content://` URIs on Android.
 */
export async function importKindleClippings(filePath: string, collectionId?: string): Promise<KindleImportResult> {
  const mobileBytes = await readClippingsBytesForMobile(filePath);
  if (mobileBytes !== null) {
    return invokeCommand<KindleImportResult>("import_kindle_clippings_file_bytes", {
      fileBytes: mobileBytes,
      collectionId: collectionId ?? null,
    });
  }
  return invokeCommand<KindleImportResult>("import_kindle_clippings_file", {
    filePath,
    collectionId: collectionId ?? null,
  });
}

/**
 * Open a file picker filtered to .txt files for Kindle clippings.
 */
export async function selectKindleClippingsFile(): Promise<string | null> {
  const files = await openFilePicker({
    multiple: false,
    filters: [
      {
        name: "Kindle Clippings",
        extensions: ["txt"],
      },
    ],
  });
  if (!files || files.length === 0) return null;
  return files[0];
}
