import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBackdropImage, saveBackdropImage } from "../../imageStorage";
import {
  AnimatedImagePreparationError,
  type AnimatedImagePack,
} from "../contracts";
import {
  animatedImagePackKey,
  animatedImagePosterKey,
  deleteAnimatedImageAssets,
  loadAnimatedImagePack,
  loadAnimatedImagePoster,
  saveAnimatedImageAssets,
} from "../storage";

const MEDIA_ID = "anim-00000000-0000-4000-8000-000000000001";
const LEGACY_DATA_URL = "data:image/jpeg;base64,/9j/2Q==";

function pngBlob(): Blob {
  return new Blob(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])],
    { type: "image/png" }
  );
}

function makePack(mediaId = MEDIA_ID): AnimatedImagePack {
  const first = pngBlob();
  const second = pngBlob();
  return {
    version: 1,
    mediaId,
    sourceFormat: "gif",
    sourceWidth: 4,
    sourceHeight: 4,
    width: 4,
    height: 4,
    durationMs: 200,
    plays: "infinite",
    frames: [
      { startMs: 0, durationMs: 100, still: first, width: 4, height: 4 },
      { startMs: 100, durationMs: 100, still: second, width: 4, height: 4 },
    ],
    byteLength: first.size + second.size,
    droppedTransitions: false,
  };
}

function installThemeImageDb() {
  const values = new Map<string, unknown>();
  let storeCreated = false;
  let abortNextWrite = false;
  const database = {
    objectStoreNames: { contains: () => storeCreated },
    createObjectStore: () => {
      storeCreated = true;
      return {};
    },
    close: () => undefined,
    transaction: () => {
      const snapshot = new Map(values);
      const shouldAbort = abortNextWrite;
      abortNextWrite = false;
      const tx: Record<string, unknown> = {
        error: shouldAbort ? new DOMException("Quota exceeded", "QuotaExceededError") : null,
        objectStore: () => ({
          put(value: unknown, key: string) {
            values.set(key, value);
            return {};
          },
          get(key: string) {
            const request: { result?: unknown; onsuccess?: (event: unknown) => void } = {};
            queueMicrotask(() => {
              request.result = values.get(key);
              request.onsuccess?.({});
            });
            return request;
          },
          delete(key: string) {
            values.delete(key);
            return {};
          },
        }),
      };
      Object.defineProperty(tx, "oncomplete", {
        set(handler: ((event: unknown) => void) | null) {
          queueMicrotask(() => queueMicrotask(() => {
            if (shouldAbort) {
              values.clear();
              snapshot.forEach((value, key) => values.set(key, value));
              (tx.onabort as ((event: unknown) => void) | null)?.({});
            } else {
              handler?.({});
            }
          }));
        },
      });
      Object.defineProperty(tx, "onerror", {
        set(handler: ((event: unknown) => void) | null) {
          if (shouldAbort) queueMicrotask(() => handler?.({}));
        },
      });
      let abortHandler: ((event: unknown) => void) | null = null;
      Object.defineProperty(tx, "onabort", {
        get: () => abortHandler,
        set: (handler: ((event: unknown) => void) | null) => {
          abortHandler = handler;
        },
      });
      return tx;
    },
  };

  const indexedDb = {
    open: () => {
      const request: Record<string, unknown> = { result: database };
      queueMicrotask(() => {
        if (!storeCreated) (request.onupgradeneeded as (() => void) | null)?.();
        queueMicrotask(() => (request.onsuccess as (() => void) | null)?.());
      });
      return request;
    },
  };

  vi.stubGlobal("indexedDB", indexedDb);
  return {
    values,
    failNextWrite: () => {
      abortNextWrite = true;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("animated image storage", () => {
  it("commits poster and pack together and reads them independently of legacy string images", async () => {
    const db = installThemeImageDb();
    db.values.set("legacy-image", LEGACY_DATA_URL);
    const poster = pngBlob();
    const pack = makePack();

    await saveAnimatedImageAssets(MEDIA_ID, poster, pack);
    await saveBackdropImage("still-image", LEGACY_DATA_URL);

    expect(await loadBackdropImage("legacy-image")).toBe(LEGACY_DATA_URL);
    expect(db.values.get("still-image")).toBe(LEGACY_DATA_URL);
    expect((await loadAnimatedImagePoster(MEDIA_ID)).poster).toEqual(poster);
    expect((await loadAnimatedImagePack(MEDIA_ID)).pack).toEqual(pack);
  });

  it("keeps a valid poster usable when the pack is missing or has an unknown version", async () => {
    const db = installThemeImageDb();
    const poster = pngBlob();
    await saveAnimatedImageAssets(MEDIA_ID, poster);

    expect((await loadAnimatedImagePoster(MEDIA_ID)).poster).toEqual(poster);
    expect((await loadAnimatedImagePack(MEDIA_ID)).failure).toBe("asset-missing");

    const missingPosterId = "anim-00000000-0000-4000-8000-000000000002";
    expect((await loadAnimatedImagePoster(missingPosterId)).failure).toBe("asset-missing");

    db.values.set(animatedImagePackKey(MEDIA_ID), { version: 2, mediaId: MEDIA_ID });
    expect((await loadAnimatedImagePack(MEDIA_ID)).failure).toBe("invalid-pack");
    expect((await loadAnimatedImagePoster(MEDIA_ID)).poster).toEqual(poster);
  });

  it("rejects mismatched metadata and does not report an aborted quota write as saved", async () => {
    const db = installThemeImageDb();
    await expect(saveAnimatedImageAssets(MEDIA_ID, pngBlob(), makePack("anim-other-00000000")))
      .rejects.toMatchObject({ code: "invalid-pack" });

    db.failNextWrite();
    await expect(saveAnimatedImageAssets(MEDIA_ID, pngBlob()))
      .rejects.toMatchObject({ code: "storage-write-failed" });
    expect(db.values.has(animatedImagePosterKey(MEDIA_ID))).toBe(false);
  });

  it("rejects external or signature-mismatched poster data before writing", async () => {
    const db = installThemeImageDb();
    const fakeJpeg = new Blob([new Uint8Array([0x00, 0x11, 0x22])], { type: "image/jpeg" });
    await expect(saveAnimatedImageAssets(MEDIA_ID, fakeJpeg))
      .rejects.toBeInstanceOf(AnimatedImagePreparationError);
    expect(db.values.has(animatedImagePosterKey(MEDIA_ID))).toBe(false);
  });

  it("surfaces an unavailable store and removes only generated media keys", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(saveAnimatedImageAssets(MEDIA_ID, pngBlob()))
      .rejects.toMatchObject({ code: "storage-unavailable" });

    const db = installThemeImageDb();
    db.values.set("legacy-image", LEGACY_DATA_URL);
    await saveAnimatedImageAssets(MEDIA_ID, pngBlob(), makePack());
    await deleteAnimatedImageAssets(MEDIA_ID);
    expect(db.values.has(animatedImagePosterKey(MEDIA_ID))).toBe(false);
    expect(db.values.has(animatedImagePackKey(MEDIA_ID))).toBe(false);
    expect(db.values.get("legacy-image")).toBe(LEGACY_DATA_URL);
  });
});
