import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const linuxBuildEnv = fileURLToPath(
  new URL("../tauri-linux-build-env.sh", import.meta.url),
);
const wrapperSource = readFileSync(
  new URL("../tauri-wrapper.sh", import.meta.url),
  "utf8",
);
const packageSource = readFileSync(
  new URL("../../package.json", import.meta.url),
  "utf8",
);

test("Linux build environment overrides memory-unsafe caller settings", () => {
  const output = execFileSync(
    "bash",
    [
      "-c",
      'export CARGO_BUILD_JOBS=32 CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1; source "$1"; printf "%s %s" "$CARGO_BUILD_JOBS" "$CARGO_PROFILE_RELEASE_CODEGEN_UNITS"',
      "tauri-linux-build-env-test",
      linuxBuildEnv,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );

  assert.equal(output, "1 4");
});

test("all repository Linux package builds use the guarded wrapper", () => {
  assert.match(
    wrapperSource,
    /source scripts\/tauri-linux-build-env\.sh/,
    "npm run tauri build must source the Linux release memory envelope",
  );

  const scripts = JSON.parse(packageSource).scripts;
  assert.match(scripts["tauri:build:linux"], /scripts\/tauri-wrapper\.sh build/);
  assert.match(scripts["tauri:build:linux:deb"], /scripts\/tauri-wrapper\.sh build/);
  assert.match(scripts["tauri:build:linux:appimage"], /ci-build-appimage\.sh/);
});
