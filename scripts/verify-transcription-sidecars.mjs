import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const MODEL_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-tdnn-yesno.tar.bz2";

function fail(message) {
  throw new Error(`[transcription-sidecar-check] ${message}`);
}

function walk(root) {
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else files.push(fullPath);
    }
  }
  return files;
}

function isNonEmptyFile(filePath) {
  try {
    return statSync(filePath).isFile() && statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function findRequired(files, label, predicate) {
  const matches = files.filter(predicate);
  if (matches.length === 0) fail(`${label} is missing`);
  const usable = matches.find(isNonEmptyFile);
  if (!usable) fail(`${label} is empty: ${matches.join(", ")}`);
  return usable;
}

function run(command, args, env, label, timeout = 120_000) {
  const result = spawnSync(command, args, {
    env,
    encoding: "utf8",
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) fail(`${label} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${label} exited ${result.status}: ${(result.stderr || result.stdout || "no output").trim()}`);
  }
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    fail(`model fixture download failed: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
  if (!isNonEmptyFile(destination)) fail("model fixture archive is empty");
}

const rootIndex = process.argv.indexOf("--root");
const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined;
if (!root || !existsSync(root)) fail("usage: node verify-transcription-sidecars.mjs --root <bundle-root>");

const files = walk(root);
const whisper = findRequired(files, "Whisper sidecar", (file) => {
  const name = basename(file).toLowerCase();
  return name === "whisper" || name === "whisper.exe" || /^whisper-(?!wrapper)/.test(name);
});
const sherpa = findRequired(files, "sherpa-onnx sidecar", (file) => {
  const name = basename(file).toLowerCase();
  return name === "sherpa-onnx" || name === "sherpa-onnx.exe" || name.startsWith("sherpa-onnx-");
});
const onnxRuntime = findRequired(files, "ONNX Runtime library", (file) => {
  const name = basename(file).toLowerCase();
  return name.includes("onnxruntime") && /[.](dll|dylib|so)([.]\d+)*$/.test(name);
});

const runtimeDirs = [...new Set([dirname(whisper), dirname(sherpa), dirname(onnxRuntime)])];
const env = { ...process.env };
if (process.platform === "win32") {
  env.PATH = `${runtimeDirs.join(";")};${env.PATH || ""}`;
} else if (process.platform === "darwin") {
  env.DYLD_LIBRARY_PATH = `${runtimeDirs.join(":")}:${env.DYLD_LIBRARY_PATH || ""}`;
} else {
  env.LD_LIBRARY_PATH = `${runtimeDirs.join(":")}:${env.LD_LIBRARY_PATH || ""}`;
}

run(whisper, ["--help"], env, "Whisper runtime smoke test");
run(sherpa, ["--help"], env, "sherpa runtime smoke test");

const workDir = mkdtempSync(join(tmpdir(), "incrementum-transcription-smoke-"));
try {
  const archive = join(workDir, "sherpa-onnx-tdnn-yesno.tar.bz2");
  await download(MODEL_URL, archive);
  run("tar", ["-xjf", archive, "-C", workDir], env, "model fixture extraction");

  const fixtureFiles = walk(workDir);
  const model = findRequired(fixtureFiles, "smoke-test ONNX model", (file) => basename(file) === "model-epoch-14-avg-2.onnx");
  const tokens = findRequired(fixtureFiles, "smoke-test tokens", (file) => basename(file) === "tokens.txt");
  const wav = findRequired(fixtureFiles, "smoke-test WAV", (file) => file.toLowerCase().endsWith(".wav"));

  run(sherpa, [
    "--sample-rate=8000",
    "--feat-dim=23",
    `--tdnn-model=${model}`,
    `--tokens=${tokens}`,
    wav,
  ], env, "sherpa model-loading smoke test", 300_000);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

console.log(`Transcription sidecars verified: ${whisper}, ${sherpa}, ${onnxRuntime}`);
