/**
 * Guard: the article-pipeline engine libraries must never be reachable from
 * a static (top-level) import — app startup must not execute `defuddle`,
 * `@mozilla/readability`, or the pipeline's DOMPurify use (design D12).
 *
 * They load exclusively through cached dynamic `import()` in
 * `src/utils/articleImport/engineLoader.ts`; the PWA build additionally
 * isolates them in the `article-vendor` manual chunk. This source-level grep
 * is the executable half of that contract (the bundle-size accounting in
 * scripts/bundle-budgets.json is the other half).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcDir = join(repoRoot, "src");

const ENGINE_PACKAGES = ["defuddle", "@mozilla/readability"];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function isStaticImportOf(source, pkg) {
  // Static forms: import ... from 'pkg'; import 'pkg'; require('pkg');
  // export ... from 'pkg'. Dynamic (allowed): import('pkg').
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const staticForms = [
    // `import type` is erased at compile time and never executes.
    new RegExp(`^\\s*import\\s+(?!type\\b)[^'"]*from\\s+['"]${escaped}['"]`, "m"),
    new RegExp(`^\\s*import\\s+['"]${escaped}['"]`, "m"),
    new RegExp(`^\\s*export\\s+[^'"]*from\\s+['"]${escaped}['"]`, "m"),
    new RegExp(`require\\(\\s*['"]${escaped}['"]\\s*\\)`),
  ];
  return staticForms.some((rx) => rx.test(source));
}

test("no static imports of the engine libraries anywhere in src/", () => {
  const offenders = [];
  for (const file of walk(srcDir)) {
    const source = readFileSync(file, "utf8");
    for (const pkg of ENGINE_PACKAGES) {
      if (isStaticImportOf(source, pkg)) {
        offenders.push(`${file} statically imports ${pkg}`);
      }
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `Engine libraries must load only via dynamic import() in engineLoader.ts. Offenders:\n${offenders.join("\n")}`
  );
});

test("engineLoader references the engines only through dynamic import()", () => {
  const loader = readFileSync(
    join(srcDir, "utils", "articleImport", "engineLoader.ts"),
    "utf8"
  );
  for (const pkg of ENGINE_PACKAGES) {
    assert.match(loader, new RegExp(`import\\('${pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'\\)`), `engineLoader must dynamic-import ${pkg}`);
  }
});

test("runtime import() call sites for the engines live only in engineLoader.ts", () => {
  // Type-position references (`import type X`, `typeof import('x')`) are
  // erased at compile time; only the dynamic import() CALL loads code.
  const callers = [];
  for (const file of walk(srcDir)) {
    // Erase type-position usages first: `typeof import('x')` and
    // `: import('x')` never load code at runtime.
    const source = readFileSync(file, "utf8")
      .replace(/typeof\s+import\([^)]*\)/g, "TYPE")
      .replace(/:\s*import\([^)]*\)/g, "TYPE");
    for (const pkg of ENGINE_PACKAGES) {
      const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const dynamicCall = new RegExp(`(?<!typeof\\s)import\\(\\s*['"]${escaped}['"]\\s*\\)`);
      if (dynamicCall.test(source)) {
        callers.push(file);
      }
    }
  }
  const unique = [...new Set(callers)];
  assert.equal(
    unique.length,
    1,
    `Only engineLoader.ts may call import() on the engine packages; found: ${unique.join(", ")}`
  );
  assert.ok(
    unique[0].endsWith(join("articleImport", "engineLoader.ts")),
    "the single caller must be engineLoader.ts"
  );
});

test("vite config pins the article-vendor manual chunk for PWA builds", () => {
  const vite = readFileSync(join(repoRoot, "vite.config.ts"), "utf8");
  assert.match(vite, /node_modules\/defuddle/, "article-vendor chunk must include defuddle");
  assert.match(vite, /node_modules\/@mozilla\/readability/, "article-vendor chunk must include @mozilla/readability");
  assert.match(vite, /return "article-vendor"/, "the chunk must be named article-vendor");
});

// Keep `statSync` import honest (used by future walker filters).
void statSync;
