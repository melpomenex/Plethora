#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(
  fs.readFileSync(path.join(__dirname, "smart-feeds-dataset.json"), "utf8"),
);
const LAYA_URL = process.env.LAYA_URL || "http://127.0.0.1:8000";

const feedMap = new Map(dataset.feeds.map((f) => [f.id, f]));

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
}

function fastLocalPredict(feed, item) {
  const posTerms = new Set(
    tokenize(`${feed.name} ${feed.description} ${feed.inclusion_criteria}`),
  );
  const negTerms = new Set(tokenize(feed.exclusion_criteria));
  const titleSet = new Set(tokenize(item.title));
  const bodySet = new Set(tokenize(`${item.summary} ${item.body}`));
  let pos = 0;
  for (const t of posTerms) {
    if (titleSet.has(t)) pos += 1.2;
    else if (bodySet.has(t)) pos += 0.6;
  }
  let neg = 0;
  for (const t of negTerms) {
    if (titleSet.has(t) || bodySet.has(t)) neg += 1.0;
  }
  const score = Math.max(0, Math.min(1, 1 - Math.exp(-pos / 3.4) - 0.35 * (1 - Math.exp(-neg / 2.0))));
  return score >= 0.46 ? "INCLUDE" : "EXCLUDE";
}

function splitPassages(text, maxChars = 700) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const passages = [];
  let cur = "";
  for (const s of sentences) {
    if (cur.length > 0 && cur.length + s.length + 1 > maxChars) {
      passages.push(cur);
      cur = s;
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur) passages.push(cur);
  return passages.length > 0 ? passages : [text];
}

async function callLaya(state, questions) {
  const resp = await fetch(`${LAYA_URL}/v1/systemone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "typed-decisions",
      max_len: 1024,
      head_max_len: 256,
      state,
      questions,
    }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

function buildCompactQuestions(feed, withCentrality) {
  const ctx = `Feed: ${feed.name}. Include: ${feed.inclusion_criteria.slice(0, 140)}. Exclude: ${feed.exclusion_criteria.slice(0, 140)}.`;
  const q = {
    decision: {
      type: "choice",
      instructions: `Classify whether this article belongs in '${feed.name}'. ${ctx}`,
      criteria: {
        INCLUDE: "Matches topic and inclusion criteria without hitting exclusions.",
        UNCERTAIN: "Borderline or insufficient evidence.",
        EXCLUDE: "Off-topic or matches exclusion criteria.",
      },
    },
    relevance: {
      type: "score",
      instructions: `Rate relevance to '${feed.name}'. ${ctx}`,
      criteria: ["off-topic", "incidental mention", "related", "on topic", "primary focus"],
    },
  };
  if (withCentrality) {
    q.centrality = {
      type: "choice",
      instructions: `Is '${feed.name}' the primary subject or an incidental mention? ${ctx}`,
      criteria: {
        PRIMARY: "Substantive primary focus.",
        SECONDARY: "Significant supporting section.",
        INCIDENTAL: "Brief or passing mention only.",
        OFF_TOPIC: "Unrelated to topic.",
      },
    };
  }
  return q;
}

async function layaSinglePass(feed, item) {
  const q = buildCompactQuestions(feed, false);
  const res = await callLaya(
    { title: item.title, content: item.summary || item.body.slice(0, 350) },
    q,
  );
  return {
    decision: res.answers.decision.choice,
    truncated: Boolean(res.usage?.truncated),
    calls: 1,
  };
}

async function layaAdaptiveMultiPassage(feed, item) {
  const passages = splitPassages(item.body, 500);
  const q = buildCompactQuestions(feed, true);
  let calls = 0;
  let truncated = false;
  const judgments = [];
  for (let i = 0; i < Math.min(passages.length, 3); i++) {
    const res = await callLaya(
      { title: item.title, passage: `${i + 1}/${passages.length}`, content: passages[i] },
      q,
    );
    calls += 1;
    if (res.usage?.truncated) truncated = true;
    const dec = res.answers.decision.choice;
    const rel = (res.answers.relevance?.score ?? 2) / 4;
    const cent = res.answers.centrality?.choice ?? "SECONDARY";
    judgments.push({ dec, rel, cent });
  }
  const hasSubstantive = judgments.some((j) => j.cent === "PRIMARY" || j.cent === "SECONDARY");
  const incCount = judgments.filter((j) => j.dec === "INCLUDE").length;
  const meanRel = judgments.reduce((s, j) => s + j.rel, 0) / judgments.length;
  let decision = "EXCLUDE";
  if (hasSubstantive && incCount > 0 && meanRel >= 0.48) decision = "INCLUDE";
  else if (!hasSubstantive && judgments.some((j) => j.cent === "INCIDENTAL")) decision = "EXCLUDE";
  else if (meanRel >= 0.36) decision = "UNCERTAIN";
  return { decision, truncated, calls };
}

function scoreMetrics(name, rows) {
  let tp = 0, fp = 0, tn = 0, fn = 0, unc = 0, truncs = 0, calls = 0;
  const latencies = [];
  for (const r of rows) {
    latencies.push(r.ms);
    if (r.truncated) truncs += 1;
    calls += r.calls;
    if (r.pred === "UNCERTAIN") {
      unc += 1;
      if (r.expected === "INCLUDE") fn += 1;
      else tn += 1;
    } else if (r.pred === "INCLUDE" && r.expected === "INCLUDE") tp += 1;
    else if (r.pred === "INCLUDE" && r.expected === "EXCLUDE") fp += 1;
    else if (r.pred === "EXCLUDE" && r.expected === "EXCLUDE") tn += 1;
    else if (r.pred === "EXCLUDE" && r.expected === "INCLUDE") fn += 1;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  latencies.sort((a, b) => a - b);
  return {
    pipeline: name,
    samples: rows.length,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
    fp,
    fn,
    uncertain: unc,
    unexpectedTruncations: truncs,
    avgCalls: Number((calls / rows.length).toFixed(2)),
    p50Ms: Number(latencies[Math.floor(latencies.length * 0.5)].toFixed(2)),
  };
}

const fastRows = [];
for (const item of dataset.cases) {
  const feed = feedMap.get(item.feed_id);
  const t0 = performance.now();
  const pred = fastLocalPredict(feed, item);
  fastRows.push({ pred, expected: item.expected, ms: performance.now() - t0, truncated: false, calls: 0 });
}

const results = [scoreMetrics("fast-local-baseline", fastRows)];

let layaAvailable = false;
try {
  const h = await fetch(`${LAYA_URL}/health`);
  layaAvailable = h.ok;
} catch {
  layaAvailable = false;
}

if (layaAvailable) {
  const singleRows = [];
  const adaptiveRows = [];
  for (const item of dataset.cases) {
    const feed = feedMap.get(item.feed_id);
    const t0 = performance.now();
    const s = await layaSinglePass(feed, item);
    singleRows.push({ pred: s.decision, expected: item.expected, ms: performance.now() - t0, truncated: s.truncated, calls: s.calls });

    const t1 = performance.now();
    const a = await layaAdaptiveMultiPassage(feed, item);
    adaptiveRows.push({ pred: a.decision, expected: item.expected, ms: performance.now() - t1, truncated: a.truncated, calls: a.calls });
  }
  results.push(scoreMetrics("laya-single-pass-summary", singleRows));
  results.push(scoreMetrics("laya-adaptive-multi-passage", adaptiveRows));
}

console.log(JSON.stringify({ datasetVersion: dataset.version, layaAvailable, results }, null, 2));
