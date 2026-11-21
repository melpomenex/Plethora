#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "dataset.json"), "utf8"));

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
}

/** Deterministic heuristic baseline matching Plethora's local_goal_alignment + structural tier rules. */
function runHeuristicDecision(item) {
  const ready = item.lengthChars >= 40 && !/^loading\b/i.test(item.text.trim());
  let loadTier = "surface-skim";
  if (item.lengthChars >= 25_000 || item.outline.length >= 4) {
    loadTier = "deep-foundational";
  } else if (item.lengthChars >= 2_000 || item.outline.length >= 2) {
    loadTier = "medium-analysis";
  }

  const goalTokens = new Set(tokenize(item.goal));
  const docTokens = new Set(tokenize(`${item.text} ${item.outline.join(" ")}`));
  let hits = 0;
  for (const t of goalTokens) {
    if (docTokens.has(t)) hits += 1;
  }
  const ratio = goalTokens.size > 0 ? hits / goalTokens.size : 0;
  // Quantize to the 5-level System One score scale {0, 0.25, 0.5, 0.75, 1.0}
  const goalAlignment = Math.round(Math.min(1, ratio * 1.5) * 4) / 4;

  return { load_tier: loadTier, goal_alignment: goalAlignment, ready_to_review: ready };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

function evaluateModel(name, predictor, items) {
  const latencies = [];
  let tierCorrect = 0;
  let readyCorrect = 0;
  let goalMaeSum = 0;

  for (const item of items) {
    const t0 = performance.now();
    const pred = predictor(item);
    const dt = performance.now() - t0;
    latencies.push(dt);
    if (pred.load_tier === item.expected.load_tier) tierCorrect += 1;
    if (pred.ready_to_review === item.expected.ready_to_review) readyCorrect += 1;
    goalMaeSum += Math.abs(pred.goal_alignment - item.expected.goal_alignment);
  }

  latencies.sort((a, b) => a - b);
  return {
    model: name,
    samples: items.length,
    loadTierAccuracy: Number((tierCorrect / items.length).toFixed(4)),
    readyToReviewAccuracy: Number((readyCorrect / items.length).toFixed(4)),
    goalAlignmentMae: Number((goalMaeSum / items.length).toFixed(4)),
    p50LatencyMs: Number(percentile(latencies, 0.5).toFixed(4)),
    p95LatencyMs: Number(percentile(latencies, 0.95).toFixed(4)),
    rssMemoryMb: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2)),
  };
}

const results = [
  evaluateModel("deterministic-heuristic-baseline", runHeuristicDecision, dataset.items),
];

const report = {
  datasetVersion: dataset.version,
  hardware: {
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    cpuCores: os.cpus().length,
    totalMemGb: Number((os.totalmem() / (1024 ** 3)).toFixed(2)),
  },
  results,
  unavailableRuntimes: [
    "laya-serve (external HTTP binary not installed in this environment)",
    "transformers / onnxruntime / torch (not installed in this environment)",
  ],
};

console.log(JSON.stringify(report, null, 2));
