import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { en } from "../locales/en";
import { de } from "../locales/de";
import { es } from "../locales/es";
import { fr } from "../locales/fr";
import { ja } from "../locales/ja";
import { zh } from "../locales/zh";
import { literalTranslateKeys } from "./literalKeys";

const locales: Record<string, Record<string, string>> = { en, de, es, fr, ja, zh };

const FEATURES_DIR = path.resolve(__dirname, "..", "..", "ai", "features");
const ASSISTANT_PANEL = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "components",
  "assistant",
  "AssistantPanel.tsx"
);

/**
 * Any readiness string a row can carry: blocking reasons AND limitations.
 * Both are rendered through `t()`, so both must exist in `en`.
 */
const READINESS_KEY = /["'](ai\.(?:reason|limitation)\.[A-Za-z0-9_.]+)["']/g;

/** Files that mint readiness keys for the registry/probes. */
const READINESS_SOURCES = [
  "registry.ts",
  "probe.ts",
  "destinations.ts",
  "readinessCopy.ts",
] as const;

function readinessKeys(): string[] {
  const keys = new Set<string>();
  for (const file of READINESS_SOURCES) {
    const source = readFileSync(path.join(FEATURES_DIR, file), "utf8");
    for (const match of source.matchAll(READINESS_KEY)) keys.add(match[1]);
  }
  return [...keys];
}

describe("readiness copy keys", () => {
  const keys = readinessKeys();

  it("scans the sources that mint readiness keys", () => {
    expect(keys.length).toBeGreaterThan(20);
  });

  it("every readiness reason/limitation key resolves in en", () => {
    // A readiness key is interpolated into user-facing copy (readiness panel,
    // diagnostics, Assistant mode notice). `t()` echoes an unknown key, so a
    // key that never reached `en` would ship as a raw dotted string.
    const missing = keys.filter((key) => !(key in en) || !en[key].trim());
    expect(missing).toEqual([]);
  });

  it("every readiness key has localized copy in every locale", () => {
    // Non-English dictionaries spread `...en`, so an untranslated key inherits
    // the English copy. Guard against the other failure mode: a dictionary
    // mapping a key back to itself (which renders the raw key).
    const errors: string[] = [];
    for (const [loc, dict] of Object.entries(locales)) {
      for (const key of keys) {
        const value = dict[key] ?? en[key];
        if (!value || value === key) errors.push(`${loc}.${key}`);
      }
    }
    expect(errors).toEqual([]);
  });

  it("blocked-mode Assistant copy resolves and keeps the {reason} placeholder", () => {
    // Keys the Assistant passes to `t()` while explaining a blocked mode. The
    // fallback lives in the readiness helper after the derivation fix, so both
    // call sites are scanned.
    const literalKeys = [
      ...literalTranslateKeys(readFileSync(ASSISTANT_PANEL, "utf8")),
      ...literalTranslateKeys(readFileSync(path.join(FEATURES_DIR, "readinessCopy.ts"), "utf8")),
    ];
    expect(literalKeys).toContain("assistant.mode.unavailable");
    expect(literalKeys).toContain("assistant.agent.modeBlocked");

    const missing = literalKeys.filter((key) => !(key in en) || !en[key].trim());
    expect(missing).toEqual([]);

    for (const [loc, dict] of Object.entries(locales)) {
      // Locales inherit `en` through the spread; assert the effective template
      // still carries the single `{reason}` placeholder.
      const template = dict["assistant.mode.unavailable"] ?? en["assistant.mode.unavailable"];
      expect(template, `${loc} must keep the {reason} placeholder`).toContain("{reason}");
      expect(template.match(/\{reason\}/g), `${loc} must substitute exactly one reason`).toHaveLength(1);
    }
  });
});
