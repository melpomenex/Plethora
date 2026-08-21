/**
 * Guard: stale "Incrementum" link symbols must never reappear in iOS plugin
 * native code.
 *
 * The folder-import plugin once exported `init_plugin_incrementum_folder_import`
 * from Swift while Rust expected `init_plugin_plethora_folder_import`, and its
 * SwiftPM package was named `incrementum-folder-import` while the crate (and
 * therefore the static library swift-rs links) is `plethora-folder-import`.
 * Either mismatch breaks the iOS build at link or plugin-registration time.
 *
 * This test fails if `incrementum` appears in any of:
 *   - an iOS `@_cdecl("…")` link symbol across src-tauri/plugins/**\/ios/**
 *   - a SwiftPM package/target/product name in any plugins/**\/ios/Package.swift
 *   - a `tauri::ios_plugin_binding!(…)` macro across plugin Rust sources
 *
 * Run with `npm run test:scripts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(import.meta.url), "..", "..", "..");
const pluginsDir = join(repoRoot, "src-tauri", "plugins");

function walk(dir, filter, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "target" || entry === "build" || entry === ".gradle") continue;
      walk(full, filter, acc);
    } else if (filter(full)) {
      acc.push(full);
    }
  }
  return acc;
}

const swiftFiles = walk(pluginsDir, (f) => f.endsWith(".swift"));
const packageSwiftFiles = walk(
  pluginsDir,
  (f) => f.endsWith("Package.swift") && f.includes(`${sep}ios${sep}`)
);
const rustFiles = walk(pluginsDir, (f) => f.endsWith(".rs"));

test("no incrementum iOS link symbols (@_cdecl) in plugin Swift sources", () => {
  const offenders = [];
  for (const file of swiftFiles) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/@_cdecl\s*\(/.test(line) && /incrementum/i.test(line)) {
        offenders.push(`${relative(repoRoot, file)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});

test("no incrementum SwiftPM package/target/product names in plugins/*/ios", () => {
  const offenders = [];
  for (const file of packageSwiftFiles) {
    const content = readFileSync(file, "utf8");
    // Only name declarations participate in linking; prose comments are
    // tolerated but names are not.
    const nameDecl = /name:\s*"([^"]*)"/g;
    let match;
    while ((match = nameDecl.exec(content)) !== null) {
      if (/incrementum/i.test(match[1])) {
        const line = content.slice(0, match.index).split("\n").length;
        offenders.push(`${relative(repoRoot, file)}:${line}: "${match[1]}"`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("no incrementum ios_plugin_binding! symbols in plugin Rust sources", () => {
  const offenders = [];
  for (const file of rustFiles) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (/ios_plugin_binding!/.test(line) && /incrementum/i.test(line)) {
        offenders.push(`${relative(repoRoot, file)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});

test("folder-import iOS symbol matches the Rust ios_plugin_binding! expectation", () => {
  const swift = readFileSync(
    join(pluginsDir, "plethora-folder-import", "ios", "Sources", "FolderImportPlugin.swift"),
    "utf8"
  );
  const rust = readFileSync(
    join(pluginsDir, "plethora-folder-import", "src", "lib.rs"),
    "utf8"
  );
  const swiftSymbols = [...swift.matchAll(/@_cdecl\s*\("([^"]+)"\)/g)].map((m) => m[1]);
  const rustSymbols = [...rust.matchAll(/ios_plugin_binding!\s*\(\s*(\w+)\s*\)/g)].map(
    (m) => m[1]
  );
  assert.ok(swiftSymbols.length > 0, "expected at least one @_cdecl export");
  assert.ok(rustSymbols.length > 0, "expected at least one ios_plugin_binding!");
  assert.deepEqual(
    swiftSymbols.sort(),
    rustSymbols.sort(),
    "Swift @_cdecl exports and Rust ios_plugin_binding! names must match exactly"
  );
});
