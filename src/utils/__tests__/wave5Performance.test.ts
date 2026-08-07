import { describe, expect, it } from "vitest";
import { createEmptyCard, fsrs, type Grade } from "ts-fsrs";
import * as Y from "yjs";
import { FileManifest, type FileManifestEntry } from "../../lib/file-manifest";

/**
 * Wave5 scheduler + sync-manifest correctness at scale.
 *
 * The absolute wall-clock assertions that used to live here
 * (`expect(duration).toBeLessThan(...)`) are gone: they were set so loose
 * (a 50× slowdown passed) that they caught nothing, and raw-millisecond
 * thresholds flake across machines. Speed is now gated by the benchmark
 * harness (`npm run bench` + scripts/check-perf-budget.mjs) — the AI-grading
 * routing path the timing test nominally guarded is covered by
 * src/utils/semanticGrading.bench.ts, and the scheduler loop is covered by
 * src/lib/sm20.bench.ts. What remains here is pure correctness.
 */
describe("Wave5 scheduler and sync manifest scale checks", () => {
  it("scheduler simulation handles a large review log", () => {
    const scheduler = fsrs({
      request_retention: 0.9,
      maximum_interval: 36500,
      enable_fuzz: false,
    });
    const now = new Date();

    let card = createEmptyCard(now);
    let iterations = 0;

    for (let i = 0; i < 5000; i += 1) {
      const grade = ([1, 2, 3, 4] as Grade[])[i % 4];
      const next = scheduler.next(card, new Date(now.getTime() + i * 60_000), grade);
      card = next.card;
      iterations += 1;
    }

    expect(iterations).toBe(5000);
  });

  it("sync manifest operations scale for batch updates", () => {
    const originalLocalStorage = (globalThis as any).localStorage;
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
        removeItem: (key: string) => data.delete(key),
      },
      configurable: true,
    });

    const doc = new Y.Doc();
    const manifest = new FileManifest(doc);

    const entries: FileManifestEntry[] = Array.from({ length: 3000 }).map((_, i) => ({
      id: `file-${i}`,
      room: "room-a",
      filename: `file-${i}.pdf`,
      contentType: "application/pdf",
      sizeBytes: 1024 + i,
      contentHash: `hash-${i}`,
      uploadedAt: new Date().toISOString(),
      uploadedBy: "device-a",
    }));

    manifest.updateMyPresence(entries.slice(0, 10).map((entry) => entry.id));

    for (const entry of entries) {
      manifest.addFile(entry);
    }
    const all = manifest.getAllFiles();
    const available = manifest.isFileAvailable("file-0");

    expect(all.length).toBe(3000);
    expect(available).toBe(true);

    if (typeof originalLocalStorage === "undefined") {
      delete (globalThis as any).localStorage;
    } else {
      Object.defineProperty(globalThis, "localStorage", {
        value: originalLocalStorage,
        configurable: true,
      });
    }
  });
});
