/**
 * Canonical conversation domain (design D1).
 *
 * Public surface:
 *  - `types` / `serialize`: the versioned contracts and their codecs.
 *  - `repository`: the durable owner contract every adapter implements.
 *  - `core`: the platform-neutral repository logic (browser + tests).
 *  - `store`: storage backends (IndexedDB for browsers, memory for tests).
 *  - `adapters`: platform adapter selection (native Tauri commands vs
 *    browser IndexedDB), with honest capability reporting.
 *  - `projectionStore`: the selector-based read model for React.
 *  - `turnController`: the submit/cancel/retry lifecycle owner.
 *  - `importLegacy`: raw legacy storage import (task 1.5).
 */

export * from "./types";
export * from "./serialize";
export * from "./repository";
export * from "./core";
export * from "./store";
export * from "./adapters";
export * from "./projectionStore";
export * from "./turnController";
export * from "./importLegacy";
export * from "./bridge";
export * from "./historyReader";
