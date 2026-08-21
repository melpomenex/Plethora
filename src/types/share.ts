/**
 * Native Mobile Share Target Types
 */

export type SharedItemType = 'url' | 'text' | 'file';

export interface SharedItem {
  /** Discriminator for shared item kind. */
  type: SharedItemType;
  /** Web URL if shared. */
  url?: string;
  /** Shared text snippet or attached user note. */
  text?: string;
  /** Shared document title or subject line from the sender app. */
  title?: string;
  /** Absolute staged filesystem path on device (e.g. /data/user/0/.../files/imports/foo.pdf). */
  filePath?: string;
  /** File display name (e.g. paper.pdf). */
  fileName?: string;
  /** MIME type (e.g. application/pdf, image/png). */
  mimeType?: string;
  /** File size in bytes if known. */
  fileSize?: number;
}

export interface SharedBatch {
  /** Stable id for staged/claimed batches (iOS App Group manifests); absent
   *  for ephemeral warm-start batches. Used for exactly-once acknowledgement. */
  id?: string;
  /** Timestamp when the share intent was captured. */
  timestamp: number;
  /** Array of shared items in this intent. */
  items: SharedItem[];
}

export interface ShareTargetResult {
  /** Legacy single-URL response for backward compatibility. */
  url?: string | null;
  /** List of structured shared batches. */
  batches?: SharedBatch[];
}

// ──────────────────────────────────────────────────────────────────────────
// Staged share-extension manifest contract
//
// The iOS Share Extension stages each share into the App Group container as
// `<container>/shares/.ready/<uuid>/manifest.json` (+ payload files), then
// atomically renames the directory into place. The folder-import Rust plugin
// claims those manifests and maps them into `SharedBatch` via
// `stagedManifestToBatch` (shareTarget.ts) / `staged_shares.rs`. Both sides
// share this exact camelCase schema:
//
//   { id, receivedAt, sourceApp?, attempts,
//     items: [{ kind: "url", urlString, title? }
//            |{ kind: "text", text, title? }
//            |{ kind: "file", filename, mimeType? }] }
//
// `attempts` is managed by the Rust reader (bounded-retry counter); the
// extension always writes 0.
// ──────────────────────────────────────────────────────────────────────────

/** One item of a staged manifest (`kind` mirrors `SharedItem.type`). */
export type StagedShareItem =
  | { kind: "url"; urlString: string; title?: string }
  | { kind: "text"; text: string; title?: string }
  | { kind: "file"; filename: string; mimeType?: string };

/** Manifest JSON written by the extension's ShareStagingWriter. */
export interface StagedShareManifest {
  /** Stable batch id (= staged directory name). */
  id: string;
  /** Unix epoch ms when the share was captured. */
  receivedAt: number;
  /** Bundle id of the sharing app (e.g. com.apple.Safari), if resolvable. */
  sourceApp?: string;
  /** Bounded-retry counter maintained by the Rust reader. */
  attempts?: number;
  items: StagedShareItem[];
}

/** Provenance recorded on `DocumentMetadata` for share-extension captures. */
export interface ShareCaptureProvenance {
  source: "share_extension" | "android_share";
  /** Sharing app bundle id, if the platform reported one. */
  sourceApp?: string;
  /** Unix epoch ms captured by the sharer. */
  receivedAt: number;
  /** Staged batch id (iOS) for traceability. */
  batchId?: string;
  schemaVersion: 1;
}
