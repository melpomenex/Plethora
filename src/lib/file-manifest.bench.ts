/**
 * File-manifest hot path — the sync path adds/merges file-manifest entries and
 * answers availability lookups over the whole collection (see
 * src/lib/file-manifest.ts). Same operations the wave5 performance test used
 * to guard with a wall-clock threshold; here they are measured properly.
 *
 * Determinism: ~1000 synthetic entries built once from `seededRandom`; a fresh
 * Y.Doc + FileManifest is created inside the measured call so each iteration
 * performs identical work, and no clock is read for input sizing.
 */
import { bench } from "vitest";
import * as Y from "yjs";
import { seededRandom } from "../test/bench-support";
import { FileManifest, type FileManifestEntry } from "./file-manifest";

const rng = seededRandom(0xf1e);

const ENTRY_COUNT = 1000;
const entries: FileManifestEntry[] = Array.from({ length: ENTRY_COUNT }, (_, i) => ({
  id: `file-${i}`,
  room: "room-a",
  filename: `file-${i}.pdf`,
  contentType: "application/pdf",
  sizeBytes: 1024 + Math.floor(rng() * 100_000),
  contentHash: `hash-${i}-${Math.floor(rng() * 1_000_000)}`,
  uploadedAt: "2024-01-01T00:00:00.000Z",
  uploadedBy: "device-a",
}));

// Consumed result sink: bench bodies must return void for tsc, so the fold is
// written here to keep the work live (the engine cannot elide the manifest ops).
let sink = 0;

bench("file-manifest/add-1000-entries", () => {
  const doc = new Y.Doc();
  const manifest = new FileManifest(doc);
  for (const entry of entries) {
    manifest.addFile(entry);
  }
  const all = manifest.getAllFiles();
  const available = manifest.isFileAvailable("file-0");
  sink ^= all.length + (available ? 1 : 0);
});
