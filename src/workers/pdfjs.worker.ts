/**
 * PDF.js worker bootstrap for bundled (Tauri / PWA) environments.
 *
 * Background — why this file exists:
 *
 *   `src/components/viewer/PDFViewer.tsx` used to configure the PDF.js worker
 *   with a `workerSrc` string:
 *
 *     GlobalWorkerOptions.workerSrc = new URL(
 *       "pdfjs-dist/build/pdf.worker.min.mjs",
 *       import.meta.url
 *     ).toString();
 *
 *   Vite rewrites that `new URL(..., import.meta.url)` at build time, but the
 *   emitted reference is an *absolute* path (e.g. "/assets/pdf.worker.min-<hash>.mjs").
 *   On Tauri Android (origin `http://asset.localhost`) — and specifically on
 *   older Android WebViews like the Boox Palma's — spawning a module worker
 *   from that absolute path fails. PDF.js then falls back to its fake worker,
 *   which re-reads `PDFWorker.workerSrc`; because the real worker never
 *   initialized, the getter throws:
 *
 *       No "GlobalWorkerOptions.workerSrc" specified.
 *
 *   and the app surfaces it as `Failed to load PDF: …`.
 *
 * Fix:
 *
 *   Instead of handing PDF.js a URL string and letting it build the Worker
 *   internally, we build the Worker ourselves and pass it via
 *   `GlobalWorkerOptions.workerPort`. PDF.js honors `workerPort` directly and
 *   never touches the throwing `workerSrc` getter. The `new Worker(new URL(...))`
 *   form makes Vite emit a *relative* asset reference (the same pattern already
 *   used by `src/lib/sync/argon2id.worker.ts` and `src/workers/alignment.worker.ts`,
 *   both of which work on mobile), so resolution works under Tauri's custom
 *   protocol.
 *
 *   This file also installs the same runtime polyfills that `main.tsx` installs
 *   on `window` (`Promise.try`, `Promise.withResolvers`, `Uint8Array.prototype.toHex`,
 *   `Map.prototype.getOrInsertComputed`). PDF.js v5's worker code uses these, and
 *   they are missing in the Boox Palma's older WebView — without them the worker
 *   throws on the first message even when the script loads.
 */

/// <reference lib="webworker" />

import { installPromiseCompat } from "../utils/promiseCompat";
import { installUint8ArrayCompat } from "../utils/uint8ArrayCompat";

// Polyfills must be installed before pdf.js's worker code runs. Both helpers
// are idempotent and cheap, so calling them at module-eval time is safe.
installPromiseCompat(self as unknown as typeof globalThis);
installUint8ArrayCompat(self as unknown as typeof globalThis);

// Re-export the worker entry. Its top-level `static { … initializeFromPort(self) }`
// block self-bootstraps the message handler when loaded inside a Worker global.
export * from "pdfjs-dist/build/pdf.worker.min.mjs";
