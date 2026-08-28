import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const packageSource = readFileSync(
  new URL("../../package.json", import.meta.url),
  "utf8",
);

test("local macOS package builds seal the generated app bundle", () => {
  const scripts = JSON.parse(packageSource).scripts;

  for (const scriptName of [
    "tauri:build:macos",
    "tauri:build:macos:dmg",
    "tauri:build:local:macos",
  ]) {
    assert.match(
      scripts[scriptName],
      /TAURI_SIGNING_IDENTITY=-/,
      `${scriptName} must ask Tauri to seal the complete app bundle`,
    );
    assert.match(
      scripts[scriptName],
      /APPLE_SIGNING_IDENTITY=-/,
      `${scriptName} must propagate the ad-hoc identity to macOS codesign`,
    );
  }
});
