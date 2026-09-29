import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The `update_document` Tauri command deserializes its `updates` argument into
 * a whole `Document`, so every required field — `id` first — must be present.
 * A partial payload never reaches the command: it fails argument validation
 * with "invalid args `updates` for command `update_document`: missing field
 * `id`", which is how archiving a watched video from the review queue silently
 * failed (the failure was only visible as a toast, or swallowed by a `catch`).
 *
 * TypeScript already rejects a partial here, so the only way to reintroduce
 * the bug is to silence the compiler. This guard bans `as any` on an inline
 * object literal passed to a document-update call. Single-flag changes belong
 * on their own narrow command (`dismiss_document`, `archive_document`,
 * `update_document_priority`), which is the pattern the backend already uses
 * for exactly this reason.
 */

const ROOT = path.resolve(__dirname, "../..");

const PARTIAL_WITH_AS_ANY = /\bupdate\w*Document\w*\(\s*\{[^}]*\}\s*as\s+any\b/;

function listSourceFiles(): string[] {
  return execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx'", { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .filter((f) => !/\.test\.(ts|tsx)$/.test(f))
    .filter((f) => !f.endsWith(".bench.ts"))
    .filter((f) => fs.existsSync(path.join(ROOT, f)));
}

describe("update_document payload guard", () => {
  const files = listSourceFiles();
  expect(files.length).toBeGreaterThan(100);

  it("never passes an `as any` partial object to a document update", () => {
    const offenders: string[] = [];
    for (const rel of files) {
      const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
      if (PARTIAL_WITH_AS_ANY.test(code)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("the narrow lifecycle commands exist in the API layer", () => {
    const api = fs.readFileSync(path.join(ROOT, "src/api/documents.ts"), "utf8");
    expect(api).toContain('invokeCommand<Document>("archive_document"');
    expect(api).toContain('invokeCommand<Document>("dismiss_document"');
  });

  it("the archive command is registered on the Tauri invoke handler", () => {
    const lib = fs.readFileSync(path.join(ROOT, "src-tauri/src/lib.rs"), "utf8");
    expect(lib).toContain("commands::archive_document");
  });
});
