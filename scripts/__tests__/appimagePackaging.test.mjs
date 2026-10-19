import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = readFileSync(
  fileURLToPath(new URL("../ci-build-appimage.sh", import.meta.url)),
  "utf8",
);

test("AppImage build cannot package an AppDir from before the Tauri build", () => {
  const movePreviousAppDir = script.indexOf('mv "$APPDIR" "$APPDIR_BACKUP_DIR/Plethora.AppDir"');
  const invokeTauri = script.indexOf("npm run tauri -- build --bundles appimage");
  assert.ok(movePreviousAppDir >= 0, "previous AppDir is moved aside");
  assert.ok(invokeTauri > movePreviousAppDir, "Tauri build runs after the old AppDir is moved");
  assert.match(script, /if \[\[ ! -d "\$APPDIR" \]\]/);
});

test("AppImage packages a validated GStreamer plugin manifest and required assets", () => {
  for (const plugin of [
    "libgstcoreelements.so",
    "libgstplayback.so",
    "libgstlibav.so",
    "libgstisomp4.so",
    "libgsttypefindfunctions.so",
  ]) {
    assert.ok(script.includes(`"${plugin}"`), `required plugin listed: ${plugin}`);
  }
  assert.match(script, /Required GStreamer plugin missing/);
  assert.match(script, /gstreamer-plugin-set-id/);
  assert.match(script, /Tauri build did not produce the executable AppDir binary/);
});

test("AppImage builder reports its local output without writing to /opt", () => {
  assert.match(script, /AppImage path: \$ROOT_DIR\/\$EXPECTED_APPIMAGE/);
  assert.doesNotMatch(script, /\/opt\/plethora\/Plethora\.AppImage/);
});
