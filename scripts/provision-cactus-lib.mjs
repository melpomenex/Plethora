#!/usr/bin/env node
/**
 * Provision `libcactus.so` for Linux x86_64 (`src-tauri/bin/libcactus.so`)
 * and Android arm64-v8a (`src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/libcactus.so`)
 * by linking Cactus Compute's published `libcactus.a` static archive into a shared library.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CACTUS_VERSION = "4.1.1";
const BASE_URL = `https://huggingface.co/Cactus-Compute/cactus/resolve/main/releases/${CACTUS_VERSION}`;
const ROOT = path.resolve(import.meta.dirname, "..");

function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execFileSync("curl", ["-fL", "--retry", "3", url, "-o", dest], { stdio: "inherit" });
}

function buildLinux() {
  const out = path.join(ROOT, "src-tauri", "bin", "libcactus.so");
  const tmpA = path.join(os.tmpdir(), "libcactus-linux.a");
  download(`${BASE_URL}/linux-x86_64/libcactus.a`, tmpA);
  execFileSync(
    "zig",
    ["c++", "-target", "x86_64-linux-gnu", "-shared", "-Wl,--whole-archive", tmpA, "-Wl,--no-whole-archive", "-o", out],
    { stdio: "inherit" }
  );
  fs.rmSync(tmpA, { force: true });
  console.log(`Provisioned ${out}`);
}

function buildAndroidArm64() {
  const ndkHome = process.env.NDK_HOME || process.env.ANDROID_NDK_HOME;
  if (!ndkHome) {
    console.warn("Skipping Android arm64 libcactus.so: set NDK_HOME to your Android NDK path.");
    return;
  }
  const hostTag = process.platform === "darwin" ? "darwin-x86_64" : "linux-x86_64";
  const clang = path.join(ndkHome, "toolchains", "llvm", "prebuilt", hostTag, "bin", "aarch64-linux-android24-clang++");
  if (!fs.existsSync(clang)) {
    throw new Error(`Android NDK compiler not found at ${clang}`);
  }
  const out = path.join(
    ROOT,
    "src-tauri",
    "gen",
    "android",
    "app",
    "src",
    "main",
    "jniLibs",
    "arm64-v8a",
    "libcactus.so"
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmpA = path.join(os.tmpdir(), "libcactus-android-arm64.a");
  download(`${BASE_URL}/android-arm64/libcactus.a`, tmpA);
  execFileSync(
    clang,
    ["-shared", "-Wl,--whole-archive", tmpA, "-Wl,--no-whole-archive", "-llog", "-lm", "-o", out],
    { stdio: "inherit" }
  );
  fs.rmSync(tmpA, { force: true });
  console.log(`Provisioned ${out}`);
}

const target = process.argv[2] || "all";
if (target === "linux" || target === "all") buildLinux();
if (target === "android" || target === "all") buildAndroidArm64();
