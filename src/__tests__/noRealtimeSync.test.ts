/**
 * Guards the local-data-plane contract after the real-time sync removal:
 * no Yjs/WebSocket sync subsystem may be reintroduced silently. Plethora Pro
 * v2 delta sync (journal + push/pull) is explicitly allowed.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = join(__dirname, "..");

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("real-time sync removal", () => {
  it("has no Yjs sync subsystem directories", () => {
    expect(existsSync(join(SRC_ROOT, "lib", "sync"))).toBe(false);
    expect(existsSync(join(SRC_ROOT, "components", "sync"))).toBe(false);
    for (const gone of [
      "yjsSync.ts",
      "startSyncSubsystems.ts",
      "documentReplication.ts",
      "fileSyncRegistration.ts",
      "autoFileSyncDownload.ts",
      "file-transfer.ts",
      "localStorageSync.ts",
      "offline-queue.ts",
    ]) {
      expect(existsSync(join(SRC_ROOT, "lib", gone))).toBe(false);
    }
  });

  it("allows v2 delta sync store but forbids Yjs relay transport", () => {
    const forbidden = [
      "sync.readsync.org",
      "lib/sync/entities",
      "lib/yjsSync",
      "startSyncSubsystems",
      "getYjsSync",
      "incrementum:sync-corruption",
    ];
    const offenders: string[] = [];
    for (const file of listSourceFiles(SRC_ROOT)) {
      const content = readFileSync(file, "utf8");
      for (const needle of forbidden) {
        if (content.includes(needle)) offenders.push(`${file}: ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("documents v2 delta sync as the supported cloud sync path", () => {
    const syncStore = readFileSync(join(SRC_ROOT, "stores", "syncStore.ts"), "utf8");
    expect(syncStore).toContain("sync_run");
    expect(syncStore).not.toContain("yjsSync");
  });
});
