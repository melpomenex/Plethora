import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const linuxBuildEnv = fileURLToPath(
  new URL("../tauri-linux-build-env.sh", import.meta.url),
);
const packageScript = fileURLToPath(
  new URL("../tauri-linux-package.sh", import.meta.url),
);
const wrapperSource = readFileSync(
  new URL("../tauri-wrapper.sh", import.meta.url),
  "utf8",
);
const packageSource = readFileSync(
  new URL("../../package.json", import.meta.url),
  "utf8",
);

function sourceLinuxEnv(extraEnv = {}) {
  const envPairs = Object.entries(extraEnv)
    .map(([key, value]) => `export ${key}=${JSON.stringify(value)};`)
    .join(" ");
  return execFileSync(
    "bash",
    [
      "-c",
      envPairs +
        ' source "$1"; printf "%s %s" "$CARGO_BUILD_JOBS" "${CARGO_PROFILE_RELEASE_CODEGEN_UNITS:-unset}"',
      "tauri-linux-build-env-test",
      linuxBuildEnv,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

test("Linux build environment respects explicit CARGO_BUILD_JOBS", () => {
  const output = sourceLinuxEnv({ CARGO_BUILD_JOBS: "6" });
  assert.equal(output, "6 unset");
});

test("Linux build environment guards codegen-units=1 only", () => {
  const output = execFileSync(
    "bash",
    [
      "-c",
      'export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1; source "$1"; printf "%s" "$CARGO_PROFILE_RELEASE_CODEGEN_UNITS"',
      "tauri-linux-build-env-test",
      linuxBuildEnv,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(output, "4");
});

test("Linux build environment computes a default job count when unset", () => {
  const output = sourceLinuxEnv();
  const jobs = Number.parseInt(output.split(" ")[0], 10);
  assert.ok(jobs >= 1 && jobs <= 8, `expected 1-8 local default jobs, got ${jobs}`);
});

test("production and fast Linux deb scripts use tauri-linux-package.sh", () => {
  const scripts = JSON.parse(packageSource).scripts;
  assert.match(scripts["tauri:build:linux:deb"], /tauri-linux-package\.sh release deb/);
  assert.match(scripts["tauri:build:linux:deb:fast"], /tauri-linux-package\.sh fast deb/);
  assert.match(scripts["tauri:build:linux:binary"], /tauri-linux-package\.sh binary/);
  assert.match(scripts["tauri:bundle:linux:deb"], /tauri-linux-package\.sh bundle deb/);
  assert.match(scripts["tauri:build:linux:profile"], /tauri-linux-package\.sh profile deb/);
});

test("tauri wrapper sources Linux build env and accelerators", () => {
  assert.match(wrapperSource, /source scripts\/tauri-linux-build-env\.sh/);
  assert.match(wrapperSource, /source scripts\/linux-build-accelerators\.sh/);
});

test("tauri:build routes through the guarded wrapper", () => {
  const scripts = JSON.parse(packageSource).scripts;
  assert.match(scripts["tauri:build"], /scripts\/tauri-wrapper\.sh build/);
});

test("tauri-linux-package.sh stages non-release binaries for bundle", () => {
  const source = readFileSync(packageScript, "utf8");
  assert.match(source, /^#!\/usr\/bin\/env bash/);
  assert.match(source, /FAST LOCAL PACKAGE/);
  assert.match(source, /PRODUCTION RELEASE PACKAGE/);
  assert.match(source, /stage_profile_binary_for_bundle/);
  assert.match(source, /restore_staged_release_binary/);
  assert.match(source, /sidecar_digest/);
});
