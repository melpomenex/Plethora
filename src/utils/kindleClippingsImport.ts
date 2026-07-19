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
