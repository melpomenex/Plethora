import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { test } from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const wrapperSource = readFileSync(
  new URL("../tauri-wrapper.sh", import.meta.url),
  "utf8",
);
const mainRsSource = readFileSync(
  new URL("../../src-tauri/src/main.rs", import.meta.url),
  "utf8",
);
const graphicsRsSource = readFileSync(
  new URL("../../src-tauri/src/graphics.rs", import.meta.url),
  "utf8",
);

/** Recursively collect shell scripts under a directory. */
function collectShellScripts(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...collectShellScripts(full));
    } else if (entry.endsWith(".sh") || entry === "AppRun") {
      out.push(full);
    }
  }
  return out;
}

test("dev wrapper never blanket-disables WebKitGTK acceleration", () => {
  // GPU policy is owned by src-tauri/src/graphics.rs; a wrapper-level
  // export of the disabling trio would defeat it for every dev session.
  assert.doesNotMatch(
    wrapperSource,
    /export WEBKIT_DISABLE_(DMABUF_RENDERER|COMPOSITING_MODE|HARDWARE_ACCELERATION)=/,
    "tauri-wrapper.sh must not export the WebKitGTK acceleration-disabling variables",
  );
  // Forcing Mesa software GL would push every dev session onto the
  // software-renderer compatibility path regardless of the real GPU.
  assert.ok(
    !wrapperSource.includes("LIBGL_ALWAYS_SOFTWARE"),
    "tauri-wrapper.sh must not force LIBGL_ALWAYS_SOFTWARE",
  );
});

test("no shell wrapper or launcher blanket-disables WebKitGTK acceleration", () => {
  // The authoritative policy lives in src-tauri/src/graphics.rs; reintroducing
  // an unconditional disable anywhere in scripts/ or src-tauri/ would silently
  // override it for the affected launch path.
  const offenders = [];
  for (const script of [
    ...collectShellScripts(join(repoRoot, "scripts")),
    ...collectShellScripts(join(repoRoot, "src-tauri")),
  ]) {
    const source = readFileSync(script, "utf8");
    if (/export WEBKIT_DISABLE_(DMABUF_RENDERER|COMPOSITING_MODE|HARDWARE_ACCELERATION)=1/.test(source)) {
      offenders.push(script);
    }
  }
  assert.deepEqual(offenders, [], "blanket WebKitGTK disables found in shell scripts");
});

test("dev wrapper defaults PLETHORA_GPU_MODE=auto", () => {
  assert.match(
    wrapperSource,
    /export PLETHORA_GPU_MODE="\$\{PLETHORA_GPU_MODE:-auto\}"/,
    "the Linux dev path must hand GPU policy to the graphics module with mode auto",
  );
});

test("main.rs routes through the graphics policy and keeps the sandbox disable", () => {
  assert.match(
    mainRsSource,
    /graphics::init\(\)/,
    "main.rs Linux env setup must go through the graphics module",
  );
  assert.match(
    mainRsSource,
    /set_var\("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS"/,
    "the sandbox disable must stay unconditional in main.rs",
  );
});

test("graphics policy module classifies software rasterizers and falls back to DRI", () => {
  for (const token of ["llvmpipe", "softpipe", "swrast"]) {
    assert.ok(
      graphicsRsSource.includes(token),
      `graphics.rs must recognize the "${token}" software rasterizer`,
    );
  }
  assert.ok(
    graphicsRsSource.includes("/sys/class/drm"),
    "graphics.rs must scan /sys/class/drm when glxinfo is unavailable",
  );
  assert.ok(
    graphicsRsSource.includes("dri-device-present"),
    "graphics.rs must keep acceleration for a detected DRI device",
  );
});

test("dead blanket-disabling launchers are gone", () => {
  assert.equal(
    existsSync(`${repoRoot}/src-tauri/AppRun`),
    false,
    "src-tauri/AppRun must not exist; the graphics module owns the policy",
  );
  assert.equal(
    existsSync(`${repoRoot}/src-tauri/dev-wrapper.sh`),
    false,
    "src-tauri/dev-wrapper.sh must not exist; the graphics module owns the policy",
  );
});
