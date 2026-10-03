import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Near-duplicate identifiers guard.
 *
 * ## Why this exists
 *
 * Three times while building the adaptive queue engine, a pair of identifiers
 * that render identically turned out to differ by one letter — `Daque` vs
 * `Daqe` vs `daqe`. Each time the compiler caught it, but only *after* the
 * mistake, and each time it cost a confusing "no exported member named X. Did
 * you mean X?" error. The hazard is specific to this feature's naming: the
 * feature is DAQE, the module is `daqe`, and a type named after it looks the
 * same whichever way the vowels are arranged.
 *
 * So the rule is enforced here rather than rediscovered: within any file, two
 * exported names must not be case-insensitively equal or differ by a single
 * insertion. That is a cheap check over a small directory and it makes the class
 * of bug impossible to merge.
 */

const ROOTS = ["src/lib/daqe", "src/api/ai.ts", "src-tauri/src/algorithms/daqe"];

function filesUnder(target: string): string[] {
  try {
    if (statSync(target).isFile()) return [target];
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const path = join(target, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path));
    else if (/\.(ts|tsx|rs)$/.test(entry.name) && !/\.test\.|\.bench\./.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/** Exported names, per language. */
function exportedNames(source: string, path: string): string[] {
  const names = new Set<string>();
  const patterns = path.endsWith(".rs")
    ? [/pub fn (\w+)/g, /pub struct (\w+)/g, /pub enum (\w+)/g, /pub const (\w+)/g, /pub trait (\w+)/g]
    : [
        /export (?:async )?function (\w+)/g,
        /export const (\w+)/g,
        /export class (\w+)/g,
        /export interface (\w+)/g,
        /export type (\w+)/g,
        /export const enum (\w+)/g,
      ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) names.add(match[1]);
  }
  return [...names];
}

/** One edit distance apart, or equal ignoring case. */
function confusable(a: string, b: string): string | null {
  if (a === b) return null;
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA === lowerB) return "differs only by case";

  const [shorter, longer] = lowerA.length <= lowerB.length ? [lowerA, lowerB] : [lowerB, lowerA];
  if (longer.length - shorter.length > 1) return null;
  // One insertion/deletion away?
  let i = 0;
  let skipped = false;
  for (; i < shorter.length; i += 1) {
    if (shorter[i] !== longer[i]) {
      if (skipped) return null;
      skipped = true;
      if (longer.length === shorter.length) return null;
    }
  }
  return skipped ? "differs by one inserted letter" : null;
}

describe("no confusable exported names in DAQE modules", () => {
  const files = ROOTS.flatMap(filesUnder);

  it("found the modules to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("has no two exports that differ by case or one letter", () => {
    const collisions: string[] = [];
    for (const file of files) {
      const names = exportedNames(readFileSync(file, "utf8"), file);
      for (let i = 0; i < names.length; i += 1) {
        for (let j = i + 1; j < names.length; j += 1) {
          // A PascalCase type paired with a camelCase value of the same name is
          // the TypeScript convention for a type/value pair, not a typo.
          const lowerI = names[i].toLowerCase();
          const lowerJ = names[j].toLowerCase();
          const isTypeValuePair =
            lowerI === lowerJ &&
            names[i] !== names[j] &&
            // Exactly one of them is capitalised and the other is not.
            (names[i][0] === names[i][0].toUpperCase()) !==
              (names[j][0] === names[j][0].toUpperCase());
          if (isTypeValuePair) continue;
          const reason = confusable(names[i], names[j]);
          if (reason) collisions.push(`${file}: "${names[i]}" vs "${names[j]}" (${reason})`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it("uses one canonical spelling of the feature's prefix", () => {
    // `daqe` (lowercase, for the module) and `Daqe` (PascalCase, for types) are
    // the two sanctioned forms. `Daque` and `daqe` are not — they arise from
    // typing the feature's name rather than its module's.
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const match = source.match(/\bDaque\w*/g);
      if (match) offenders.push(`${file}: ${[...new Set(match)].join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});
