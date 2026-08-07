/**
 * Bench-only environment shims (loaded by vitest.bench.config.ts).
 *
 * This is deliberately NOT the jsdom test setup (`src/test/setup.ts`): benches
 * run in plain Node with no DOM and no Tauri runtime. Several measured modules
 * (markdown → mathOcr → ocrCommands, ankiImport, file-manifest, and the sync
 * modules they pull in) import the Tauri bridge `src/lib/tauri.ts`, which
 * loads a heavy browser-only graph (pdfjs-dist, epubjs, zustand stores,
 * youtubeTranscriptBrowser) at module-evaluation time — even though no bench
 * ever calls the bridge. So the bridge is stubbed at the import boundary:
 * benches measure the pure TypeScript around it, exactly as the jsdom test
 * setup mocks `@tauri-apps/api`.
 */
import { vi } from "vitest";

vi.mock("../lib/tauri", () => {
  const never = (name: string) => () => {
    throw new Error(`[bench] Tauri bridge "${name}" must not be called from a benchmark`);
  };
  return {
    invokeCommand: never("invokeCommand"),
    isTauri: () => false,
    listen: never("listen"),
    openFilePicker: never("openFilePicker"),
    openFolderPicker: never("openFolderPicker"),
    openExternal: never("openExternal"),
    openInWebviewWindow: never("openInWebviewWindow"),
    convertFileSrc: never("convertFileSrc"),
    isNativeMobile: () => false,
    isNativePhone: () => false,
    isPWA: () => false,
    isMac: () => false,
    getPlatform: () => "unknown",
    nativePlatform: () => null,
    getFormFactor: () => "desktop",
    resetFormFactorCache: () => {},
  };
});

// Safety net: if any transitive import still pulls in pdfjs-dist, its module
// scope constructs a DOMMatrix; provide the smallest shim that lets it load.
if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === "undefined") {
  class DOMMatrix {
    // pdfjs only constructs it at module scope; bench code never calls it.
  }
  (globalThis as Record<string, unknown>).DOMMatrix = DOMMatrix;
}
