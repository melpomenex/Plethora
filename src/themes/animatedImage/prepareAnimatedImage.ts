import {
  ANIMATED_IMAGE_LIMITS,
  AnimatedImagePreparationError,
  type AnimatedImageProgress,
  type PreparedAnimatedImage,
} from "./contracts";
import { createAnimatedImageMediaId } from "./storage";

export interface PrepareAnimatedImageOptions {
  readonly tier: "desktop" | "mobile";
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: AnimatedImageProgress) => void;
}

type WorkerMessage =
  | { readonly type: "progress"; readonly generation: number; readonly stage: AnimatedImageProgress["stage"]; readonly fraction: number }
  | { readonly type: "result"; readonly generation: number; readonly prepared: PreparedAnimatedImage }
  | { readonly type: "error"; readonly generation: number; readonly code: string; readonly message: string; readonly capability?: string };

let generation = 0;
let activeWorker: Worker | null = null;

/** Return null for a non-GIF so callers can continue the existing still-image path. */
export async function prepareAnimatedImageFile(
  file: File,
  options: PrepareAnimatedImageOptions
): Promise<PreparedAnimatedImage | null> {
  cancelAnimatedImagePreparation();
  const currentGeneration = ++generation;
  const advertisedAsGif = file.type.toLowerCase() === "image/gif" || /\.gif$/i.test(file.name);
  if (file.size === 0 && advertisedAsGif) {
    throw new AnimatedImagePreparationError("empty-input", "The selected GIF is empty.");
  }
  const signature = new Uint8Array(await readBlobArrayBuffer(file.slice(0, 6)));
  const isGifSignature = signature.length === 6 &&
    (ascii(signature) === "GIF87a" || ascii(signature) === "GIF89a");
  if (!isGifSignature) {
    if (advertisedAsGif) {
      throw new AnimatedImagePreparationError("invalid-signature", "This file is labeled as GIF but has an invalid GIF signature.");
    }
    return null;
  }
  if (file.size > ANIMATED_IMAGE_LIMITS.inputBytes) {
    throw new AnimatedImagePreparationError("input-too-large", "This image is larger than the 16 MiB import limit.");
  }
  if (options.signal?.aborted) {
    throw new AnimatedImagePreparationError("cancelled", "Image preparation was cancelled.");
  }
  if (typeof Worker === "undefined") {
    throw new AnimatedImagePreparationError(
      "worker-unavailable",
      "Animated GIF preparation is not available in this WebView.",
      { capability: "module-worker" }
    );
  }

  let worker: Worker;
  try {
    worker = new Worker(new URL("./animatedImage.worker.ts", import.meta.url), {
      type: "module",
      name: "plethora-animated-image-preparation",
    });
  } catch (cause) {
    throw new AnimatedImagePreparationError(
      "worker-unavailable",
      "Animated GIF preparation could not start in this WebView.",
      { capability: "module-worker", cause }
    );
  }
  activeWorker = worker;

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let abortListener: (() => void) | null = null;
  return new Promise<PreparedAnimatedImage>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (abortListener) options.signal?.removeEventListener("abort", abortListener);
      worker.terminate();
      if (activeWorker === worker) activeWorker = null;
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    timeoutId = setTimeout(() => {
      fail(new AnimatedImagePreparationError("deadline-exceeded", "This GIF took too long to prepare."));
    }, ANIMATED_IMAGE_LIMITS.foregroundJobMs);
    abortListener = () => fail(new AnimatedImagePreparationError("cancelled", "Image preparation was cancelled."));
    options.signal?.addEventListener("abort", abortListener, { once: true });

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.generation !== currentGeneration || currentGeneration !== generation || settled) return;
      if (message.type === "progress") {
        options.onProgress?.({
          generation: message.generation,
          stage: message.stage,
          fraction: Math.max(0, Math.min(1, message.fraction)),
        });
      } else if (message.type === "result") {
        settled = true;
        cleanup();
        resolve(message.prepared);
      } else {
        const code = isFailureCode(message.code) ? message.code : "decode-failed";
        fail(new AnimatedImagePreparationError(code, message.message, {
          capability: isCapabilityCode(message.capability) ? message.capability : undefined,
        }));
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail(new AnimatedImagePreparationError(
        "worker-unavailable",
        "Animated GIF preparation failed in this WebView.",
        { capability: "module-worker", cause: event.error }
      ));
    };
    worker.onmessageerror = () => fail(new AnimatedImagePreparationError(
      "decode-failed",
      "The prepared GIF could not be returned to Plethora."
    ));

    void readBlobArrayBuffer(file).then((buffer) => {
      if (settled || currentGeneration !== generation) return;
      worker.postMessage({
        type: "prepare",
        generation: currentGeneration,
        mediaId: createAnimatedImageMediaId(),
        tier: options.tier,
        bytes: buffer,
      }, [buffer]);
    }).catch((cause) => {
      fail(new AnimatedImagePreparationError("decode-failed", "The selected GIF could not be read.", { cause }));
    });
  });
}

export function cancelAnimatedImagePreparation(): void {
  generation += 1;
  activeWorker?.terminate();
  activeWorker = null;
}

function ascii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function readBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("The selected image could not be read."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("The selected image could not be read."));
    reader.onabort = () => reject(new Error("Reading the selected image was cancelled."));
    reader.readAsArrayBuffer(blob);
  });
}

function isFailureCode(value: string): value is ConstructorParameters<typeof AnimatedImagePreparationError>[0] {
  return [
    "cancelled", "empty-input", "invalid-signature", "malformed-container", "unsupported-feature",
    "input-too-large", "dimension-limit", "frame-limit", "timeline-limit", "pixel-work-limit",
    "deadline-exceeded", "worker-unavailable", "decoder-unavailable", "decode-failed",
    "poster-encode-failed", "pack-encode-failed", "output-too-large", "unsafe-flashing",
    "storage-unavailable", "storage-write-failed", "invalid-pack", "asset-missing", "asset-corrupt",
  ].includes(value);
}

function isCapabilityCode(value?: string): value is NonNullable<ConstructorParameters<typeof AnimatedImagePreparationError>[2]>["capability"] {
  return Boolean(value && [
    "module-worker", "worker-canvas-2d", "scratch-canvas-2d", "create-image-bitmap",
    "indexeddb-blob", "png-encode", "webp-encode",
  ].includes(value));
}
