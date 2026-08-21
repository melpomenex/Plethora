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
