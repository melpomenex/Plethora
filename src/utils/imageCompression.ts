/**
 * Image compression utility using Canvas API.
 * Optimized to avoid main-thread blocking:
 * - Uses Web Worker + OffscreenCanvas when available (no layout thrash, no sync base64)
 * - Falls back to async toBlob path (not toDataURL) on main thread
 * - Downscales to max 1280px on longest side, JPEG 0.8 -> 0.5
 */

const MAX_DIMENSION = 1280;
const MAX_BYTES = 5 * 1024 * 1024;

let worker: Worker | null = null;
let workerId = 0;
const pending = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    if (typeof Worker === 'undefined') return null;
    if (typeof OffscreenCanvas === 'undefined') return null;
    worker = new Worker(new URL('../workers/imageCompress.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const { id, success, dataUrl, error } = e.data as { id: number; success: boolean; dataUrl?: string; error?: string };
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (success && dataUrl) p.resolve(dataUrl);
      else p.reject(new Error(error || 'Worker compression failed'));
    };
    worker.onerror = () => {
      for (const [, p] of pending) p.reject(new Error('Worker error'));
      pending.clear();
      try { worker?.terminate(); } catch {}
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

function compressViaWorker(dataUrl: string, maxDimension: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    if (!w) {
      reject(new Error('No worker'));
      return;
    }
    const id = ++workerId;
    pending.set(id, { resolve, reject });
    w.postMessage({ id, dataUrl, maxDimension, quality });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('Worker timeout'));
      }
    }, 15000);
  });
}

async function compressMainThread(dataUrl: string, maxDimension: number, maxBytes: number, quality: number): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  let { width, height } = bitmap;
  if (width > maxDimension || height > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  let outBlob: Blob;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('OffscreenCanvas context failed');
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas context failed');
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    outBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', quality);
    });
  }

  if (outBlob.size <= maxBytes) {
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(new Error('FileReader failed'));
      r.readAsDataURL(outBlob);
    });
  }

  if (quality > 0.5) {
    return compressMainThread(dataUrl, maxDimension, maxBytes, 0.5);
  }

  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('FileReader failed'));
    r.readAsDataURL(outBlob);
  });
}

export async function compressImage(
  dataUrl: string,
  maxDimension: number = MAX_DIMENSION,
  maxBytes: number = MAX_BYTES,
): Promise<string> {
  try {
    const result = await compressViaWorker(dataUrl, maxDimension, 0.8);
    if (result.length <= maxBytes) return result;
    const low = await compressViaWorker(dataUrl, maxDimension, 0.5);
    return low;
  } catch {
    // Fallback to main-thread async path (toBlob, not toDataURL)
    try {
      const result = await compressMainThread(dataUrl, maxDimension, maxBytes, 0.8);
      if (result.length <= maxBytes) return result;
      return await compressMainThread(dataUrl, maxDimension, maxBytes, 0.5);
    } catch {
      // Last fallback: original sync path (should rarely happen)
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onerror = () => reject(new Error("Failed to load image for compression"));
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            const scale = maxDimension / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) { reject(new Error("Failed to get canvas 2D context")); return; }
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            if (!blob) { reject(new Error("toBlob failed")); return; }
            const r = new FileReader();
            r.onload = () => resolve(r.result as string);
            r.onerror = () => reject(new Error("FileReader failed"));
            r.readAsDataURL(blob);
          }, 'image/jpeg', 0.8);
        };
        img.src = dataUrl;
      });
    }
  }
}

/**
 * Read a File as a data URL string.
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("FileReader did not return a string"));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
