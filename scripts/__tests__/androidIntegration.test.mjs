import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAndroidIntegration } from "../check-android-integration.mjs";

test("current Android host integration passes the APK preflight", () => checkAndroidIntegration());

test("regenerating the Activity or build config fails with reapplication instructions", () => {
  const root = mkdtempSync(join(tmpdir(), "plethora-android-integration-"));
  const files = ["build.gradle.kts", "src/main/AndroidManifest.xml", "src/main/java/com/plethora/app/MainActivity.kt"];
  try {
    for (const file of files) {
      const destination = join(root, "src-tauri/gen/android/app", file);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, readFileSync(join("src-tauri/gen/android/app", file)));
    }
    checkAndroidIntegration(root);
    writeFileSync(join(root, "src-tauri/gen/android/app", files[2]), "class MainActivity : TauriActivity()");
    assert.throws(() => checkAndroidIntegration(root), /integration was lost:.*docs\/android-build-notes.md/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
