/**
 * Migration test suite for the Incrementum → Plethora rebrand (task 5.1).
 *
 * Covers the one-shot localStorage migrator round-trip, the dual-read
 * window, the PWA IndexedDB migration flag contract, legacy `.incrementum`
 * backup import acceptance, and the retained sync-residue exclusions.
 * (Rust-side coverage — app-data dir migration, db filename adoption,
 * keychain read-through, Obsidian id round-trip — lives in
 * src-tauri/src/{legacy_data.rs, database/connection.rs, cloud/auth_store.rs,
 * commands/ai_key_store.rs, integrations.rs}.)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  migratedGetItem,
  runBrandStorageMigration,
} from "../brandMigration";
import { validateExportFile } from "../../utils/appStateImport";

describe("brand storage migration (task 3.3)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("copies legacy incrementum* keys to plethora* successors and removes the legacy key after a verified round-trip", () => {
    localStorage.setItem("incrementum-settings", JSON.stringify({ state: { settings: { theme: "dark" } } }));
    localStorage.setItem("incrementum-tabs", '[{"id":"t1"}]');
    localStorage.setItem("incrementum.reading-sessions", "[]");
    localStorage.setItem("incrementum_skip_update_version", "2.7.0");

    runBrandStorageMigration();

    expect(localStorage.getItem("plethora-settings")).toBe(
      JSON.stringify({ state: { settings: { theme: "dark" } } })
    );
    expect(localStorage.getItem("plethora-tabs")).toBe('[{"id":"t1"}]');
    expect(localStorage.getItem("plethora.reading-sessions")).toBe("[]");
    expect(localStorage.getItem("plethora_skip_update_version")).toBe("2.7.0");

    // Legacy keys are cleaned up only after the copy verified.
    expect(localStorage.getItem("incrementum-settings")).toBeNull();
    expect(localStorage.getItem("incrementum-tabs")).toBeNull();
    expect(localStorage.getItem("incrementum.reading-sessions")).toBeNull();
    expect(localStorage.getItem("incrementum_skip_update_version")).toBeNull();

    // Completion flag written.
    expect(localStorage.getItem("plethora.brand-storage-migrated")).toBe("1");
  });

  it("preserves the separator style of every key family", () => {
    localStorage.setItem("incrementum-community", "a"); // dash
    localStorage.setItem("incrementum.community.marketplace", "b"); // dot
    localStorage.setItem("incrementum_community_flag", "c"); // underscore

    runBrandStorageMigration();

    expect(localStorage.getItem("plethora-community")).toBe("a");
    expect(localStorage.getItem("plethora.community.marketplace")).toBe("b");
    expect(localStorage.getItem("plethora_community_flag")).toBe("c");
  });

  it("never overwrites an existing plethora* key with legacy data", () => {
    localStorage.setItem("incrementum-settings", "old-value");
    localStorage.setItem("plethora-settings", "newer-value");

    runBrandStorageMigration();

    expect(localStorage.getItem("plethora-settings")).toBe("newer-value");
  });

  it("does not migrate the removed sync subsystem's residue keys", () => {
    localStorage.setItem("incrementum_sync_room", "room");
    localStorage.setItem("incrementum.sync-residue-cleaned", "1");

    runBrandStorageMigration();

    // Those keys keep their legacy names — syncResidueCleanup owns them.
    expect(localStorage.getItem("incrementum_sync_room")).toBe("room");
    expect(localStorage.getItem("incrementum.sync-residue-cleaned")).toBe("1");
    expect(localStorage.getItem("plethora_sync_room")).toBeNull();
  });

  it("is idempotent across boots (flag + no-op re-run)", () => {
    localStorage.setItem("incrementum-settings", "x");
    runBrandStorageMigration();
    const afterFirst = localStorage.getItem("plethora-settings");
    expect(afterFirst).toBe("x");

    // Simulate the app writing newer data, then a second boot.
    localStorage.setItem("plethora-settings", "y");
    runBrandStorageMigration();
    expect(localStorage.getItem("plethora-settings")).toBe("y");
  });

  it("runs at most one migration even when the flag write fails (every step re-runnable)", () => {
    // Storage full simulation: setItem on new keys throws after N bytes.
    const original = Storage.prototype.setItem;
    let calls = 0;
    Storage.prototype.setItem = function (key: string, value: string) {
      calls += 1;
      if (key.startsWith("plethora-") && key !== "plethora.brand-storage-migrated") {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      }
      original.call(this, key, value);
    };
    try {
      localStorage.setItem("incrementum-settings", "payload");
      expect(() => runBrandStorageMigration()).not.toThrow();
      // The legacy key must survive a failed copy.
      expect(localStorage.getItem("incrementum-settings")).toBe("payload");
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe("dual-read window (migratedGetItem)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("reads the plethora* key when present", () => {
    localStorage.setItem("plethora-settings", "new");
    expect(migratedGetItem("plethora-settings")).toBe("new");
  });

  it("falls back to the legacy incrementum* key when the new one is absent", () => {
    localStorage.setItem("incrementum-settings", "legacy");
    expect(migratedGetItem("plethora-settings")).toBe("legacy");
  });

  it("falls back across separator styles", () => {
    localStorage.setItem("incrementum_skip_update_version", "1.2.3");
    expect(migratedGetItem("plethora_skip_update_version")).toBe("1.2.3");
    localStorage.setItem("incrementum.reading-sessions", "[]");
    expect(migratedGetItem("plethora.reading-sessions")).toBe("[]");
  });

  it("returns null when neither key exists", () => {
    expect(migratedGetItem("plethora-nonexistent")).toBeNull();
  });
});

describe("legacy .incrementum backup import stays accepted (task 3.5)", () => {
  const baseExport = (app: string) => ({
    metadata: {
      version: 1,
      app,
      exportedAt: new Date().toISOString(),
      includesFiles: false,
      stats: { documentCount: 0, extractCount: 0, learningItemCount: 0 },
    },
  });

  it("accepts a legacy Incrementum backup", () => {
    expect(validateExportFile(baseExport("Incrementum")).valid).toBe(true);
  });

  it("accepts a current Plethora backup", () => {
    expect(validateExportFile(baseExport("Plethora")).valid).toBe(true);
  });

  it("rejects a foreign export", () => {
    expect(validateExportFile(baseExport("SomethingElse")).valid).toBe(false);
  });
});
