#!/usr/bin/env node
/** Build/package the same portable native provider on the current desktop host. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, writeFile, stat, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function run(command, args) {
  const result = spawnSync(command, args, { cwd: repo, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}
function output(command, args) {
  const result = spawnSync(command, args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} failed`);
  return result.stdout;
}
export function isRuntimeFile(name) {
  return /(?:\.dll|\.dylib|\.metallib|\.so(?:\.\d+)*)$/i.test(name);
}
export async function stageRuntime(source, destination, include = () => true) {
  await mkdir(destination, { recursive: true });
  const names = await readdir(source);
  for (const name of names) {
    if (!isRuntimeFile(name) || !include(name)) continue;
    // Linux consumers need the SONAME (.so.<major>), not three copies of
    // each large CUDA library under linker/development/version aliases.
    const version = name.match(/^(.*\.so)\.(\d+)(?:\.\d+)+$/);
    if (version && names.includes(`${version[1]}.${version[2]}`)) continue;
    if (name.endsWith(".so") && names.some((entry) => entry.startsWith(`${name}.`))) continue;
    // Dereference build-tree aliases, so no installed link can escape into a build directory.
    await cp(join(source, name), join(destination, name), { dereference: true });
  }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: node scripts/build-lfm3-host.mjs [--cuda] [--ensure]\nBuilds the portable desktop TTS host and stages runtime files for Tauri. CUDA requires its development toolkit only on the build machine."
    );
    return;
  }
  const unknown = args.find((arg) => !["--cuda", "--ensure"].includes(arg));
  if (unknown) throw new Error(`Unknown argument ${unknown}; use --help`);
  if (["android", "ios"].includes(process.env.TAURI_ENV_PLATFORM)) return;
  if (!["linux", "darwin", "win32"].includes(process.platform))
    throw new Error("LFM3 sidecars require a desktop build host");
  const host = output("rustc", ["-vV"]).match(/^host: (.+)$/m)?.[1];
  const target = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET || host;
  if (process.env.PLETHORA_ANDROID_BUILD === "1" || /android|ios/.test(target || "")) return;
  if (!target) throw new Error("Could not determine the native Rust target");
  const sourceHash = createHash("sha256");
  for (const file of [
    "native/lfm3-host/main.cpp",
    "native/lfm3-host/CMakeLists.txt",
    "scripts/build-lfm3-host.mjs",
  ])
    sourceHash.update(await readFile(join(repo, file)));
  const buildSourceHash = sourceHash.digest("hex");
  if (args.includes("--ensure")) {
    const staged = join(
      repo,
      "src-tauri/bin",
      `lfm3-host-${target}${target.includes("windows") ? ".exe" : ""}`
    );
    const manifest = await readFile(join(repo, "src-tauri/bin/lfm3-runtime/manifest.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    if (
      manifest?.target === target &&
      manifest.buildSourceHash === buildSourceHash &&
      (await stat(staged)
        .then((s) => s.size > 1024)
        .catch(() => false))
    )
      return;
  }
  if (target !== host)
    throw new Error(
      `Stage the LFM3 runtime for ${target} from a native build host before cross-packaging`
    );
  if (args.includes("--cuda") && !process.env.CUDAToolkit_ROOT)
    throw new Error("Set CUDAToolkit_ROOT to package CUDA's redistributable libraries and license.");
  const build = resolve(
    process.env.LFM3_BUILD_DIR ||
      join(repo, ".cache", `lfm3-host-${target}${args.includes("--cuda") ? "-cuda" : ""}`)
  );
  const flags = [
    "-S",
    "native/lfm3-host",
    "-B",
    build,
    "-DCMAKE_BUILD_TYPE=Release",
    `-DGGML_CUDA=${args.includes("--cuda") ? "ON" : "OFF"}`,
  ];
  if (process.env.CUDAToolkit_ROOT)
    flags.push(`-DCUDAToolkit_ROOT=${process.env.CUDAToolkit_ROOT}`);
  if (process.env.LFM3_CUDA_ARCHITECTURES)
    flags.push(`-DCMAKE_CUDA_ARCHITECTURES=${process.env.LFM3_CUDA_ARCHITECTURES}`);
  if (process.env.CUDACXX) flags.push(`-DCMAKE_CUDA_COMPILER=${process.env.CUDACXX}`);
  run("cmake", flags);
  run("cmake", [
    "--build",
    build,
    "--config",
    "Release",
    "--target",
    "lfm3-host",
    "--parallel",
    "4",
  ]);
  const suffix = process.platform === "win32" ? ".exe" : "";
  const name = `lfm3-host${suffix}`;
  const candidates = [join(build, name), join(build, "Release", name), join(build, "bin", name)];
  let binary;
  for (const path of candidates) {
    if (
      await stat(path)
        .then((s) => s.isFile())
        .catch(() => false)
    ) {
      binary = path;
      break;
    }
  }
  if (!binary) throw new Error("CMake did not produce lfm3-host");
  const bin = join(repo, "src-tauri", "bin");
  const runtime = join(bin, "lfm3-runtime");
  await mkdir(bin, { recursive: true });
  await cp(binary, join(bin, `lfm3-host-${target}${suffix}`));
  await rm(runtime, { recursive: true, force: true });
  await stageRuntime(join(build, "bin"), runtime);
  const toolkit = process.env.CUDAToolkit_ROOT;
  if (args.includes("--cuda") && toolkit) {
    // Only redistribution libraries; never compiler binaries or model weights.
    const cudaLib = process.platform === "win32" ? join(toolkit, "bin") : join(toolkit, "lib64");
    await stageRuntime(cudaLib, runtime, (name) =>
      /^(?:lib)?(?:cudart|cublas|cublasLt)[\w.-]*\.(?:so(?:\.\d+)*|dll)$/i.test(name)
    );
    const cudaLicense = ["LICENSE", "LICENSE.txt", "EULA.txt", "doc/EULA.txt"];
    const license = await Promise.all(
      cudaLicense.map(async (name) => {
        const path = join(toolkit, name);
        return await stat(path)
          .then((s) => (s.isFile() ? path : null))
          .catch(() => null);
      })
    );
    const found = license.find(Boolean);
    if (!found) throw new Error("CUDA redistribution license not found in the toolkit");
    await cp(found, join(runtime, "CUDA-LICENSE.txt"));
  }
  const source = join(build, "_deps", "llama-src");
  const cache = await readFile(join(build, "CMakeCache.txt"), "utf8");
  const override = cache.match(/^FETCHCONTENT_SOURCE_DIR_LLAMA:[^=]*=(.+)$/m)?.[1];
  const upstream = override || source;
  const notices = join(runtime, "notices");
  await mkdir(notices, { recursive: true });
  for (const path of [
    "LICENSE",
    "licenses/LICENSE-jsonhpp",
    "vendor/cpp-httplib/LICENSE",
    "vendor/hash/xxhash/LICENSE",
    "vendor/hash/sha256/LICENSE",
    "vendor/hash/rotate-bits/LICENSE.md",
    "vendor/hash/sha1/sha1.c",
    "common/base64.hpp",
  ]) {
    await cp(join(upstream, path), join(notices, path.replaceAll("/", "-")));
  }
  for (const [path, marker] of [
    ["vendor/miniaudio/miniaudio.h", "This software is available as a choice"],
    ["vendor/stb/stb_image.h", "This software is available under 2 licenses"],
    ["vendor/sheredom/subprocess.h", "This is free and unencumbered software"],
  ]) {
    const text = await readFile(join(upstream, path), "utf8");
    const start = text.lastIndexOf(marker);
    if (start < 0) throw new Error(`Missing license notice in ${path}`);
    const end = text.indexOf("*/", start);
    await writeFile(
      join(notices, path.replaceAll("/", "-") + ".txt"),
      text.slice(start, end < 0 ? undefined : end) + "\n"
    );
  }
  const files = {};
  for (const path of await readdir(runtime)) {
    if (!isRuntimeFile(path)) continue;
    files[path] = createHash("sha256")
      .update(await readFile(join(runtime, path)))
      .digest("hex");
  }
  await writeFile(
    join(runtime, "manifest.json"),
    JSON.stringify(
      {
        protocol: 1,
        runtimeCommit: "ac8e1694d837b11ed0aab944a6a2eee34b9c4d80",
        target,
        buildSourceHash,
        cuda: args.includes("--cuda"),
        files,
      },
      null,
      2
    ) + "\n"
  );
  console.log(
    `LFM3 host ready for ${target}; runtime resources staged in src-tauri/bin/lfm3-runtime`
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
