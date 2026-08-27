import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const libSource = readFileSync(
  new URL("../../src-tauri/src/lib.rs", import.meta.url),
  "utf8",
);
const mainSource = readFileSync(
  new URL("../../src-tauri/src/main.rs", import.meta.url),
  "utf8",
);
const cargoSource = readFileSync(
  new URL("../../src-tauri/Cargo.toml", import.meta.url),
  "utf8",
);

test("Tauri dev/release runtime gates do not depend on debug assertions", () => {
  assert.match(
    cargoSource,
    /\[profile\.dev\][\s\S]*?debug-assertions\s*=\s*false/,
    "the large-ACL dev profile must keep debug assertions disabled",
  );
  assert.doesNotMatch(
    `${libSource}\n${mainSource}`,
    /debug_assertions/,
    "debug assertions are disabled in dev and cannot distinguish tauri dev from production",
  );
});

test("production localhost navigation is excluded from tauri dev", () => {
  assert.match(
    libSource,
    /#\[cfg\(all\(\s*not\(dev\),[\s\S]*?tauri_plugin_localhost::Builder/,
    "the production localhost plugin must be gated with Tauri's cfg(dev)",
  );
  assert.match(
    libSource,
    /#\[cfg\(all\(\s*not\(dev\),[\s\S]*?window\.navigate\(url\)/,
    "the production localhost redirect must be gated with Tauri's cfg(dev)",
  );
});
