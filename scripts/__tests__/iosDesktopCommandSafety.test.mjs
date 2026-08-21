/**
 * Change A task 6.2 — desktop-only commands must be unreachable or error
 * safely on iOS (native layer only; Proposal D owns user-facing copy).
 *
 * Static invariants over the native sources:
 *   - install_apk (folder-import plugin): typed error on every non-Android
 *     target — never attempts an install on iOS.
 *   - capture_rendered_dom: typed "UNAVAILABLE" error on any mobile target.
 *   - tauri-plugin-updater / tauri-plugin-process: registered inside a
 *     cfg(not(any(ios, android))) block, so their commands do not exist at
 *     all on iOS.
 *   - download_update_apk: registered cross-platform but is a plain file
 *     download into the app cache with no installer invocation (inert on
 *     iOS); asserted here so a future installer call fails this test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const LIB_RS = readFileSync(join(REPO_ROOT, "src-tauri", "src", "lib.rs"), "utf8");
const ARTICLE_CAPTURE_RS = readFileSync(
  join(REPO_ROOT, "src-tauri", "src", "commands", "article_capture.rs"),
  "utf8"
);
const FOLDER_IMPORT_RS = readFileSync(
  join(REPO_ROOT, "src-tauri", "plugins", "plethora-folder-import", "src", "lib.rs"),
  "utf8"
);

test("updater + process plugins are compiled out of iOS builds", () => {
  // The registration block must sit behind a cfg that excludes both mobile
  // targets; otherwise updater commands would exist on iOS.
  const blockRe =
    /#\[cfg\(not\(any\(target_os = "ios", target_os = "android"\)\)\)\]\s*\{\s*builder = builder\.plugin\(tauri_plugin_updater::Builder::new\(\)\.build\(\)\);\s*builder = builder\.plugin\(tauri_plugin_process::init\(\)\);\s*\}/;
  assert.match(LIB_RS, blockRe, "updater/process registration lost its ios/android cfg gate");
});

test("capture_rendered_dom returns a typed UNAVAILABLE error on mobile", () => {
  const gateIdx = ARTICLE_CAPTURE_RS.indexOf("#[cfg(any(target_os = \"android\", target_os = \"ios\"))]");
  assert.ok(gateIdx !== -1, "mobile cfg gate missing from article_capture.rs");
  const afterGate = ARTICLE_CAPTURE_RS.slice(gateIdx, gateIdx + 500);
  assert.match(afterGate, /return Err\(/, "mobile gate no longer returns Err early");
  assert.match(afterGate, /UNAVAILABLE/, "mobile gate should carry an explicit UNAVAILABLE marker");
});

test("install_apk errors safely on every non-Android target (including iOS)", () => {
  const fnIdx = FOLDER_IMPORT_RS.indexOf("pub async fn install_apk(");
  assert.ok(fnIdx !== -1, "install_apk command missing from folder-import plugin");
  const body = FOLDER_IMPORT_RS.slice(fnIdx, fnIdx + 1200);
  assert.match(body, /#\[cfg\(not\(target_os = "android"\)\)\]/, "non-Android cfg arm missing");
  assert.match(body, /Err\(Error::Message\(/, "non-Android arm must return a typed error");
  assert.match(body, /only supported on Android/);
});

test("download_update_apk stays inert on iOS (cache write only, no installer)", () => {
  const fnIdx = LIB_RS.indexOf("async fn download_update_apk(");
  assert.ok(fnIdx !== -1);
  const body = LIB_RS.slice(fnIdx, LIB_RS.indexOf("/// Consume and return any pending one-shot"));
  assert.doesNotMatch(body, /run_mobile_plugin|installApk|Intent|process::Command|std::process/, 
    "download_update_apk gained installer behavior — it must not execute anything on iOS");
  assert.match(body, /latest_update\.apk/, "download destination anchor changed; re-audit this command");
});
