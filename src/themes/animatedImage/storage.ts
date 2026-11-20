import { openThemeImageDatabase, THEME_IMAGE_STORE_NAME } from "../imageDatabase";
import {
  ANIMATED_IMAGE_LIMITS,
  AnimatedImagePreparationError,
  isAnimatedImagePack,
  type AnimatedImageFailureCode,
  type AnimatedImagePack,
} from "./contracts";

const MEDIA_KEY_PREFIX = "media:v1:";
const MEDIA_ID_PATTERN = /^anim-[a-z0-9-]{8,64}$/;
const POSTER_MIME = "image/png";
const MAX_POSTER_BYTES = ANIMATED_IMAGE_LIMITS.desktop.outputBytes;

export interface AnimatedImagePosterRead {
  readonly poster: Blob | null;
  readonly failure?: AnimatedImageFailureCode;
}

export interface AnimatedImagePackRead {
  readonly pack: AnimatedImagePack | null;
  readonly failure?: AnimatedImageFailureCode;
}

export function createAnimatedImageMediaId(): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new AnimatedImagePreparationError(
      "storage-unavailable",
      "This device cannot create a secure local media identifier."
    );
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  const uuid = `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  return `anim-${uuid}`;
}

export function animatedImagePosterKey(mediaId: string): string {
  assertMediaId(mediaId);
  return `${MEDIA_KEY_PREFIX}${mediaId}:poster`;
}

export function animatedImagePackKey(mediaId: string): string {
  assertMediaId(mediaId);
  return `${MEDIA_KEY_PREFIX}${mediaId}:pack`;
}

/**
 * Persist poster and optional frame pack atomically in the legacy v1 `images`
 * store. Resolves only after IndexedDB confirms transaction completion.
 */
export async function saveAnimatedImageAssets(
  mediaId: string,
  poster: Blob,
  pack?: AnimatedImagePack,
  tier: "desktop" | "mobile" = "desktop"
): Promise<void> {
  assertMediaId(mediaId);
  const outputLimit = ANIMATED_IMAGE_LIMITS[tier].outputBytes;
  await assertStillBlob(poster, POSTER_MIME, outputLimit, "poster-encode-failed");

  if (pack) {
    if (!isAnimatedImagePack(pack, tier, mediaId)) {
      throw new AnimatedImagePreparationError("invalid-pack", "The prepared animation is invalid.");
    }
    for (const frame of pack.frames) {
      await assertStillBlob(
        frame.still,
        frame.still.type,
        outputLimit,
        "pack-encode-failed"
      );
    }
    if (pack.byteLength + poster.size > outputLimit) {
      throw new AnimatedImagePreparationError(
        "output-too-large",
        "The prepared animation exceeds the local storage limit."
      );
    }
  }

  await withWriteTransaction((store) => {
    store.put(poster, animatedImagePosterKey(mediaId));
    const packKey = animatedImagePackKey(mediaId);
    if (pack) store.put(pack, packKey);
    else store.delete(packKey);
  });
}

/** Poster reads are independent from pack reads so damaged animation stays usable. */
export async function loadAnimatedImagePoster(mediaId: string): Promise<AnimatedImagePosterRead> {
  assertMediaId(mediaId);
  let value: unknown;
  try {
    value = await readRecord(animatedImagePosterKey(mediaId));
  } catch (error) {
    return { poster: null, failure: storageReadFailure(error) };
  }
  if (value === null) return { poster: null, failure: "asset-missing" };
  if (!(typeof Blob !== "undefined" && value instanceof Blob)) {
    return { poster: null, failure: "asset-corrupt" };
  }
  if (
    value.type !== POSTER_MIME ||
    value.size > MAX_POSTER_BYTES ||
    !(await hasSignature(value, POSTER_MIME))
  ) {
    return { poster: null, failure: "asset-corrupt" };
  }
  return { poster: value };
}

/** Unknown, missing, oversized, or damaged packs resolve as poster-only fallback. */
export async function loadAnimatedImagePack(
  mediaId: string,
  tier: "desktop" | "mobile" = "desktop"
): Promise<AnimatedImagePackRead> {
  assertMediaId(mediaId);
  let value: unknown;
  try {
    value = await readRecord(animatedImagePackKey(mediaId));
  } catch (error) {
    return { pack: null, failure: storageReadFailure(error) };
  }

  if (value === null) return { pack: null, failure: "asset-missing" };
  if (!isAnimatedImagePack(value, tier, mediaId)) {
    return { pack: null, failure: "invalid-pack" };
  }
  try {
    for (const frame of value.frames) {
      if (!(await hasSignature(frame.still, frame.still.type))) {
        return { pack: null, failure: "asset-corrupt" };
      }
    }
  } catch {
    return { pack: null, failure: "asset-corrupt" };
  }
  return { pack: value };
}

/** Remove only keys owned by this feature; legacy image IDs are untouched. */
export async function deleteAnimatedImageAssets(mediaId: string): Promise<void> {
  assertMediaId(mediaId);
  await withWriteTransaction((store) => {
    store.delete(animatedImagePosterKey(mediaId));
    store.delete(animatedImagePackKey(mediaId));
  });
}

function assertMediaId(mediaId: string): void {
  if (!MEDIA_ID_PATTERN.test(mediaId)) {
    throw new AnimatedImagePreparationError("invalid-pack", "The local media identity is invalid.");
  }
}

async function assertStillBlob(
  blob: Blob,
  expectedMime: string,
  maxBytes: number,
  failure: "poster-encode-failed" | "pack-encode-failed"
): Promise<void> {
  if (
    typeof Blob === "undefined" ||
    !(blob instanceof Blob) ||
    !isAllowedStillMime(expectedMime) ||
    blob.type !== expectedMime ||
    blob.size <= 0 ||
    blob.size > maxBytes ||
    !(await hasSignature(blob, expectedMime))
  ) {
    throw new AnimatedImagePreparationError(
      failure,
      "The prepared image data could not be validated."
    );
  }
}

function isAllowedStillMime(mime: string): boolean {
  return mime === "image/png" || mime === "image/webp" || mime === "image/jpeg";
}

async function hasSignature(blob: Blob, expectedMime: string): Promise<boolean> {
  if (typeof Blob === "undefined" || !(blob instanceof Blob) || !isAllowedStillMime(expectedMime)) {
    return false;
  }
  try {
    const bytes = await readPrefix(blob, 12);
    if (expectedMime === "image/png") {
      return (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      );
    }
    if (expectedMime === "image/jpeg") {
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    }
    return (
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    );
  } catch {
    return false;
  }
}

function readPrefix(blob: Blob, length: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === "undefined") {
      reject(new Error("FileReader unavailable"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
      } else {
        reject(new Error("Image header read returned an unsupported value"));
      }
    };
    reader.onerror = () => reject(new Error("Image header read failed"));
    reader.readAsArrayBuffer(blob.slice(0, length));
  });
}

function storageReadFailure(error: unknown): AnimatedImageFailureCode {
  return error instanceof AnimatedImagePreparationError ? error.code : "storage-unavailable";
}

async function readRecord(key: string): Promise<unknown | null> {
  const database = await openThemeImageDatabase();
  if (!database) {
    throw new AnimatedImagePreparationError(
      "storage-unavailable",
      "Local image storage is unavailable."
    );
  }

  return new Promise((resolve, reject) => {
    let value: unknown = null;
    let requestFailed = false;
    try {
      const transaction = database.transaction(THEME_IMAGE_STORE_NAME, "readonly");
      const request = transaction.objectStore(THEME_IMAGE_STORE_NAME).get(key);
      request.onsuccess = () => {
        value = request.result ?? null;
      };
      request.onerror = () => {
        requestFailed = true;
      };
      transaction.oncomplete = () => {
        database.close();
        if (requestFailed) {
          reject(new AnimatedImagePreparationError("asset-corrupt", "The saved image could not be read."));
        } else {
          resolve(value);
        }
      };
      transaction.onerror = () => {
        database.close();
        reject(new AnimatedImagePreparationError("asset-corrupt", "The saved image could not be read."));
      };
      transaction.onabort = () => {
        database.close();
        reject(new AnimatedImagePreparationError("asset-corrupt", "The saved image could not be read."));
      };
    } catch (cause) {
      database.close();
      reject(
        new AnimatedImagePreparationError("asset-corrupt", "The saved image could not be read.", {
          cause,
        })
      );
    }
  });
}

async function withWriteTransaction(
  schedule: (store: IDBObjectStore) => void
): Promise<void> {
  const database = await openThemeImageDatabase();
  if (!database) {
    throw new AnimatedImagePreparationError(
      "storage-unavailable",
      "Local image storage is unavailable."
    );
  }

  await new Promise<void>((resolve, reject) => {
    try {
      const transaction = database.transaction(THEME_IMAGE_STORE_NAME, "readwrite");
      const store = transaction.objectStore(THEME_IMAGE_STORE_NAME);
      schedule(store);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(
          new AnimatedImagePreparationError(
            "storage-write-failed",
            "The image could not be saved to local storage.",
            { cause: transaction.error }
          )
        );
      };
      transaction.onabort = () => {
        database.close();
        reject(
          new AnimatedImagePreparationError(
            "storage-write-failed",
            "The image save was interrupted before it completed.",
            { cause: transaction.error }
          )
        );
      };
    } catch (cause) {
      database.close();
      reject(
        new AnimatedImagePreparationError("storage-write-failed", "The image could not be saved.", {
          cause,
        })
      );
    }
  });
}
