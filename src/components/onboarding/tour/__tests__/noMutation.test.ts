import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Spec: "Tour never blocks or mutates user data". The tour module must not
 * import document, extract, queue, or scheduling write APIs.
 *
 * This test scans the onboarding/tour source files for forbidden import paths.
 * It is deliberately conservative: it greps for the names of stores and APIs
 * that perform writes, not their types — so reading-only access to a store
 * is still flagged. The tour is a presentational overlay; if it needs any of
 * this state, it gets it from the host via the navigation adapter, never by
 * importing the store directly.
 */

const TOUR_DIR = path.resolve(__dirname, "..");
const FORBIDDEN_PATTERNS = [
  // Document / extract / queue write stores.
  /from\s+["'][^"']*stores\/documentStore["']/,
  /from\s+["'][^"']*stores\/queueStore["']/,
  /from\s+["'][^"']*stores\/reviewStore["']/,
  /from\s+["'][^"']*stores\/studyDeckStore["']/,
  /from\s+["'][^"']*stores\/extractStore["']/,
  // Tauri write commands.
  /invokeCommand\s*\(\s*["']add_document["']/,
  /invokeCommand\s*\(\s*["']delete_document["']/,
  /invokeCommand\s*\(\s*["']update_extract["']/,
  /invokeCommand\s*\(\s*["']create_extract["']/,
  /invokeCommand\s*\(\s*["']enqueue_item["']/,
  /invokeCommand\s*\(\s*["']submit_review["']/,
  /invokeCommand\s*\(\s*["']update_schedule["']/,
  // Demo / seeding content.
  /from\s+["'][^"']*lib\/demoContent["']/,
];

function listTourSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTourSourceFiles(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("tour module — no data mutation", () => {
  test("no tour source file imports document/extract/queue/scheduling write APIs", () => {
    const files = listTourSourceFiles(TOUR_DIR);
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      // Skip the test directory itself.
      if (file.includes("__tests__")) continue;
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(src)) {
          violations.push(`${path.relative(TOUR_DIR, file)}: ${pattern}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
