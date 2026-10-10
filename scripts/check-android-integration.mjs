import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function checkAndroidIntegration(root = process.cwd()) {
  const read = (path) => readFileSync(resolve(root, "src-tauri/gen/android/app", path), "utf8");
  const activity = read("src/main/java/com/plethora/app/MainActivity.kt");
  const gradle = read("build.gradle.kts");
  const manifest = read("src/main/AndroidManifest.xml");
  const requirements = [
    [activity, /BuildConfig\.NATIVE_BACK_ENABLED/, "Activity Back build switch"],
    [activity, /NavigationBackController\.install\(this\)/, "Activity AndroidX controller installation"],
    [activity, /NavigationBackController\.onResume\(\)/, "Activity resume handshake"],
    [activity, /NavigationBackController\.onPause\(\)/, "Activity pause invalidation"],
    [activity, /NavigationBackController\.uninstall\(\)/, "Activity callback teardown"],
    [activity, /NavigationBackController\.onExternalIntent\(\)[\s\S]*super\.onNewIntent\(intent\)/, "intent invalidation before Tauri delivery"],
    [gradle, /buildConfigField\("boolean", "NATIVE_BACK_ENABLED"/, "Back BuildConfig field"],
    [gradle, /getByName\("debug"\)[\s\S]*plethoraNativeBackEnabled[\s\S]*orElse\("true"\)/, "enabled debug Back default"],
    [gradle, /pre\.\*ReleaseBuild/, "physical acceptance release gate"],
    [manifest, /android:enableOnBackInvokedCallback="true"/, "Android predictive Back routing"],
  ];
  const missing = requirements.filter(([source, pattern]) => !pattern.test(source)).map(([, , description]) => description);
  if (missing.length) throw new Error(`Android native integration was lost: ${missing.join(", ")}. Reapply the recorded edits in docs/android-build-notes.md after tauri android init before building an APK.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { checkAndroidIntegration(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
