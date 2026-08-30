import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cargoBuildEnv = fileURLToPath(
  new URL("../cargo-build-env.sh", import.meta.url),
);
const nativePackageScript = fileURLToPath(
  new URL("../tauri-native-package.sh", import.meta.url),
);
const wrapperSource = readFileSync(
  new URL("../tauri-wrapper.sh", import.meta.url),
  "utf8",
);
const packageSource = readFileSync(
  new URL("../../package.json", import.meta.url),
  "utf8",
);

function sourceCargoEnv(extraEnv = {}) {
  const envPairs = Object.entries(extraEnv)
    .map(([key, value]) => `export ${key}=${JSON.stringify(value)};`)
    .join(" ");
  return execFileSync(
    "bash",
    [
      "-c",
      envPairs +
        ' source "$1"; printf "%s %s" "$CARGO_BUILD_JOBS" "${CARGO_PROFILE_RELEASE_CODEGEN_UNITS:-unset}"',
      "cargo-build-env-test",
      cargoBuildEnv,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

test("cargo build environment respects explicit CARGO_BUILD_JOBS", () => {
  const output = sourceCargoEnv({ CARGO_BUILD_JOBS: "6" });
  assert.equal(output, "6 unset");
});

test("cargo build environment guards codegen-units=1 only", () => {
  const output = execFileSync(
    "bash",
    [
      "-c",
      'export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1; source "$1"; printf "%s" "$CARGO_PROFILE_RELEASE_CODEGEN_UNITS"',
      "cargo-build-env-test",
      cargoBuildEnv,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(output, "4");
});

test("cargo build environment computes a default job count when unset", () => {
  const output = sourceCargoEnv();
  const jobs = Number.parseInt(output.split(" ")[0], 10);
  assert.ok(jobs >= 1 && jobs <= 8, `expected 1-8 local default jobs, got ${jobs}`);
});

test("android builds use a lower default job cap", () => {
  const output = sourceCargoEnv({ PLETHORA_ANDROID_BUILD: "1" });
  const jobs = Number.parseInt(output.split(" ")[0], 10);
  assert.ok(jobs >= 1 && jobs <= 2, `expected 1-2 android default jobs, got ${jobs}`);
});

test("production and fast native package scripts exist for all desktop/mobile targets", () => {
  const scripts = JSON.parse(packageSource).scripts;
  assert.match(scripts["tauri:build:linux:deb"], /tauri-linux-package\.sh release deb/);
  assert.match(scripts["tauri:build:windows:nsis"], /tauri-native-package\.sh windows release nsis/);
  assert.match(scripts["tauri:build:windows:nsis:fast"], /tauri-native-package\.sh windows fast nsis/);
  assert.match(scripts["tauri:build:macos:dmg"], /tauri-native-package\.sh macos release dmg/);
  assert.match(scripts["tauri:build:macos:dmg:fast"], /tauri-native-package\.sh macos fast dmg/);
  assert.match(scripts["tauri:build:android:apk"], /tauri-native-package\.sh android release apk/);
  assert.match(scripts["tauri:build:android:apk:fast"], /tauri-native-package\.sh android fast apk/);
});

test("tauri wrapper sources shared cargo build env on all native builds", () => {
  assert.match(wrapperSource, /source scripts\/cargo-build-env\.sh/);
  assert.match(wrapperSource, /source scripts\/cargo-build-accelerators\.sh/);
  assert.match(wrapperSource, /PLETHORA_ANDROID_BUILD=1/);
});

test("tauri:build routes through the guarded wrapper", () => {
  const scripts = JSON.parse(packageSource).scripts;
  assert.match(scripts["tauri:build"], /scripts\/tauri-wrapper\.sh build/);
});

test("tauri-native-package.sh supports multi-platform bundle staging", () => {
  const source = readFileSync(nativePackageScript, "utf8");
  assert.match(source, /^#!\/usr\/bin\/env bash/);
  assert.match(source, /FAST LOCAL PACKAGE/);
  assert.match(source, /PRODUCTION RELEASE PACKAGE/);
  assert.match(source, /stage_profile_binary_for_bundle/);
  assert.match(source, /PLETHORA_ANDROID_BUILD/);
});
