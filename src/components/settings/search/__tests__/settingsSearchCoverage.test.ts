import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { SETTINGS_SEARCH_ENTRIES } from "../settingsSearchCatalog";
import { SETTINGS_SEARCH_COVERAGE } from "../settingsSearchCoverage";
import { SETTINGS_SECTION_METADATA, SettingsTab } from "../../settingsSections";

const SETTINGS_DIR = path.resolve(__dirname, "..", "..");

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      out.push(...sourceFilesUnder(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Stable target ids produced by the row/section/target primitives. */
function registeredTargetIds(): Set<string> {
  const ids = new Set<string>();
  const files = new Set(sourceFilesUnder(SETTINGS_DIR));
  for (const row of SETTINGS_SEARCH_COVERAGE) {
    for (const src of row.sources) {
      const full = path.resolve(SETTINGS_DIR, src);
      if (statSync(full, { throwIfNoEntry: false })?.isFile()) {
        files.add(full);
      }
    }
  }
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bsearchId="([^"]+)"/g)) ids.add(match[1]);
    for (const match of source.matchAll(/<SettingsSearchTarget\s+id="([^"]+)"/g)) ids.add(match[1]);
    for (const match of source.matchAll(/data-settings-search-target="([^"]+)"/g)) ids.add(match[1]);
  }
  // The active section registers a dynamic id (`section.<activeTab>`); every
  // shared section id is therefore reachable without a literal occurrence.
  for (const section of Object.values(SettingsTab)) ids.add(`section.${section}`);
  return ids;
}

describe("Settings search coverage inventory", () => {
  it("has exactly one inventory row per shared Settings section", () => {
    const rows = SETTINGS_SEARCH_COVERAGE.map((row) => row.section);
    expect(new Set(rows).size).toBe(rows.length);
    expect(rows.sort()).toEqual(
      SETTINGS_SECTION_METADATA.map((section) => section.id).sort(),
    );
  });

  it("gives every inventory row real sources, catalog coverage, and exclusions", () => {
    for (const row of SETTINGS_SEARCH_COVERAGE) {
      expect(row.sources.length, row.section).toBeGreaterThan(0);
      expect(row.catalogPrefixes.length, row.section).toBeGreaterThan(0);
      expect(row.exclusions.length, row.section).toBeGreaterThan(0);
      const covered = SETTINGS_SEARCH_ENTRIES.some(
        (entry) =>
          entry.section === row.section &&
          row.catalogPrefixes.some((prefix) => entry.id.startsWith(prefix)),
      );
      expect(covered, `${row.section} has no catalog-backed destination`).toBe(true);
    }
  });

  it("registers a live target for every catalog destination and reveal resolver", () => {
    const registered = registeredTargetIds();
    const missing: string[] = [];
    for (const entry of SETTINGS_SEARCH_ENTRIES) {
      if (!registered.has(entry.targetId)) missing.push(`${entry.id} -> ${entry.targetId}`);
      if (entry.revealTargetId && !registered.has(entry.revealTargetId)) {
        missing.push(`${entry.id} reveal -> ${entry.revealTargetId}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps target ids stable across sections (no cross-section collisions)", () => {
    const bySection = new Map<string, string>();
    for (const entry of SETTINGS_SEARCH_ENTRIES) {
      const owner = bySection.get(entry.targetId);
      if (owner) expect(owner, entry.targetId).toBe(entry.section);
      bySection.set(entry.targetId, entry.section);
    }
  });
});
