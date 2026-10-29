import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isRuntimeFile, stageRuntime } from "../build-lfm3-host.mjs";

test("LFM3 packaging includes native libraries but excludes model weights and compilers", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfm3-package-"));
  try {
    const source = join(root, "build");
    const destination = join(root, "runtime");
    await mkdir(source);
    for (const name of ["libggml.so.0", "ggml-metal.metallib", "model.gguf", "nvcc", "libstatic.a"])
      await writeFile(join(source, name), "fixture");
    await stageRuntime(source, destination);
    assert.deepEqual((await readdir(destination)).sort(), ["ggml-metal.metallib", "libggml.so.0"]);
    assert.equal(isRuntimeFile("ggml-cpu.dll"), true);
    assert.equal(isRuntimeFile("libggml.dylib"), true);
    assert.equal(isRuntimeFile("model.safetensors"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("LFM3 packaging retains runtime SONAMEs without duplicating large version aliases", async () => {
  const root = await mkdtemp(join(tmpdir(), "lfm3-alias-"));
  try {
    const source = join(root, "build");
    await mkdir(source);
    for (const name of ["libcublas.so", "libcublas.so.13", "libcublas.so.13.7.0", "libggml-cpu-x64.so"])
      await writeFile(join(source, name), "fixture");
    await stageRuntime(source, join(root, "runtime"));
    assert.deepEqual((await readdir(join(root, "runtime"))).sort(), ["libcublas.so.13", "libggml-cpu-x64.so"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
