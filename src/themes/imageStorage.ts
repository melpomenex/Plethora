/**
 * IndexedDB storage + client-side resizing for custom theme backdrop images.
 *
 * Images are kept out of localStorage (`plethora-custom-themes`) to avoid
 * hitting the ~5 MB quota. Only the lightweight `imageId` and a tiny 48px
 * thumbnail data URL are stored on the Theme object.
 */

const DB_NAME = "plethora-theme-images";
const STORE_NAME = "images";
const DB_VERSION = 1;

const MAX_BACKDROP_EDGE = 1920;
const THUMBNAIL_EDGE = 48;

/** In-memory cache for instant repeat reads and test environments without IDB. */
const memoryCache = new Map<string, string>();

function openImageDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveBackdropImage(imageId: string, dataUrl: string): Promise<void> {
  memoryCache.set(imageId, dataUrl);
  const db = await openImageDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(dataUrl, imageId);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export async function loadBackdropImage(imageId: string): Promise<string | null> {
  const cached = memoryCache.get(imageId);
  if (cached) return cached;

  const db = await openImageDb();
  if (!db) return null;

  return new Promise<string | null>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(imageId);
      req.onsuccess = () => {
        const result = typeof req.result === "string" ? req.result : null;
        if (result) memoryCache.set(imageId, result);
        db.close();
        resolve(result);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function deleteBackdropImage(imageId: string): Promise<void> {
  memoryCache.delete(imageId);
  const db = await openImageDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(imageId);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}

export interface PreparedBackdropImage {
  imageId: string;
  dataUrl: string;
  thumbnailDataUrl: string;
  width: number;
  height: number;
  /** Sampled RGBA pixels (at most 96x96) for OKLCH palette extraction. */
  samplePixels: Uint8ClampedArray;
  sampleWidth: number;
  sampleHeight: number;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = src;
  });
}

function encodeCanvas(canvas: HTMLCanvasElement, quality: number): string {
  const webp = canvas.toDataURL("image/webp", quality);
  if (webp.startsWith("data:image/webp")) return webp;
  return canvas.toDataURL("image/jpeg", quality);
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read image data"));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(blob);
  });
}

async function loadImageFromBlob(file: Blob): Promise<HTMLImageElement> {
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    const objectUrl = URL.createObjectURL(file);
    try {
      return await loadImageElement(objectUrl);
    } catch {
      // Android WebView / SAF-backed File objects can fail with blob: URLs;
      // fall back to FileReader data URL below.
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
  const dataUrl = await readBlobAsDataUrl(file);
  return loadImageElement(dataUrl);
}

/**
 * Decode an uploaded image file, produce a bounded-size backdrop data URL,
 * a tiny thumbnail data URL, and a 96px RGBA sample buffer for palette extraction.
 */
export async function prepareBackdropImage(file: Blob): Promise<PreparedBackdropImage> {
  const img = await loadImageFromBlob(file);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) {
    throw new Error("Image has zero dimensions");
  }

  // 1. Full backdrop (capped at MAX_BACKDROP_EDGE on longest side)
  const scale = Math.min(1, MAX_BACKDROP_EDGE / Math.max(srcW, srcH));
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));
  const mainCanvas = document.createElement("canvas");
  mainCanvas.width = dstW;
  mainCanvas.height = dstH;
  const mainCtx = mainCanvas.getContext("2d");
  if (!mainCtx) throw new Error("Canvas 2D context unavailable");
  mainCtx.drawImage(img, 0, 0, dstW, dstH);
  const dataUrl = encodeCanvas(mainCanvas, 0.86);

  // 2. Tiny 48px thumbnail for swatches
  const thumbScale = Math.min(1, THUMBNAIL_EDGE / Math.max(srcW, srcH));
  const thumbW = Math.max(1, Math.round(srcW * thumbScale));
  const thumbH = Math.max(1, Math.round(srcH * thumbScale));
  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = thumbW;
  thumbCanvas.height = thumbH;
  const thumbCtx = thumbCanvas.getContext("2d");
  if (!thumbCtx) throw new Error("Canvas 2D context unavailable");
  thumbCtx.drawImage(img, 0, 0, thumbW, thumbH);
  const thumbnailDataUrl = encodeCanvas(thumbCanvas, 0.72);

  // 3. 96px sample grid for OKLCH palette extraction
  const sampleScale = Math.min(1, 96 / Math.max(srcW, srcH));
  const sampleWidth = Math.max(1, Math.round(srcW * sampleScale));
  const sampleHeight = Math.max(1, Math.round(srcH * sampleScale));
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = sampleWidth;
  sampleCanvas.height = sampleHeight;
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
  if (!sampleCtx) throw new Error("Canvas 2D context unavailable");
  sampleCtx.drawImage(img, 0, 0, sampleWidth, sampleHeight);
  const samplePixels = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;

  const imageId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    imageId,
    dataUrl,
    thumbnailDataUrl,
    width: dstW,
    height: dstH,
    samplePixels,
    sampleWidth,
    sampleHeight,
  };
}
