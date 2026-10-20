#!/usr/bin/env node
/**
 * Validate the AI Learning release-evidence manifest.
 *
 * Mirrors `src/test/aiLearning/evidence.ts` for CI/operator use without a
 * TypeScript loader. Exit codes: 0 valid, 1 invalid manifest, 2 unreadable.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_STAGES = {
  "learn-this": ["generation", "validation", "preview", "persistence"],
  "library-rag": ["retrieval", "generation", "validation", "navigation"],
  "socratic-tutor": ["generation", "validation", "preview"],
  "occlusion-assist": ["preflight", "generation", "validation", "preview"],
  "semantic-index": ["preflight", "retrieval", "persistence"],
  "answer-assessment": ["generation", "validation", "persistence"],
  "knowledge-relationships": ["retrieval", "generation", "validation", "preview", "persistence"],
  "extract-worthiness": ["preflight", "generation", "validation", "preview"],
  "learning-agent": ["preflight", "retrieval", "generation", "validation", "persistence"],
  "active-recall": ["generation", "validation", "preview"],
};

const LAYERS = new Set([
  "unit",
  "mock-integration",
  "emulator",
  "physical-device",
  "desktop-real-provider",
]);

const path = resolve(
  process.argv[2] ?? "docs/ai-learning-readiness/evidence/manifest.json",
);

let manifest;
try {
  manifest = JSON.parse(readFileSync(path, "utf8"));
} catch (error) {
  console.error(`Cannot read evidence manifest at ${path}: ${error.message}`);
  process.exit(2);
}

const problems = [];

if (manifest.schemaVersion !== "ai-learning-evidence-v1") {
  problems.push(`unknown schemaVersion: ${manifest.schemaVersion}`);
}
if (!Array.isArray(manifest.records)) {
  problems.push("records must be an array");
}

const records = Array.isArray(manifest.records) ? manifest.records : [];
if (records.length > 0) {
  if (!manifest.releaseCommit || manifest.releaseCommit === "PENDING") {
    problems.push("records exist but releaseCommit is PENDING");
  }
  if (!manifest.capabilityRevision || manifest.capabilityRevision === "PENDING") {
    problems.push("records exist but capabilityRevision is PENDING");
  }
}

const seen = new Set();
for (const record of records) {
  const id = record.id ?? "<missing id>";
  if (seen.has(id)) problems.push(`${id}: duplicate evidence id`);
  seen.add(id);

  for (const field of ["cellId", "feature", "platform", "commit", "owner", "command", "host"]) {
    if (typeof record[field] !== "string" || record[field].trim() === "") {
      problems.push(`${id}: missing ${field}`);
    }
  }
  if (!LAYERS.has(record.layer)) problems.push(`${id}: invalid layer ${record.layer}`);
  if (!record.redactedEvidencePath) problems.push(`${id}: missing redacted evidence path`);
  if (!Array.isArray(record.fixtureHashes) || record.fixtureHashes.length === 0) {
    problems.push(`${id}: missing fixture hashes`);
  }

  if (record.outcome === "pass") {
    if (record.commit !== manifest.releaseCommit) {
      problems.push(`${id}: commit is not the manifest release commit`);
    }
    if (record.capabilityRevision !== manifest.capabilityRevision) {
      problems.push(`${id}: stale capability revision`);
    }
    const required = REQUIRED_STAGES[record.feature] ?? [];
    const exercised = Array.isArray(record.exercisedStages) ? record.exercisedStages : [];
    const missing = required.filter((stage) => !exercised.includes(stage));
    if (missing.length > 0) {
      problems.push(`${id}: missing required stages ${missing.join(", ")}`);
    }
    for (const metric of record.metrics ?? []) {
      if (!metric.unit) problems.push(`${id}: metric ${metric.name} has no unit`);
      if (!Number.isFinite(metric.value)) problems.push(`${id}: metric ${metric.name} is not finite`);
    }
  } else if (record.outcome === "fail" || record.outcome === "unsupported") {
    if (!record.blockerId) problems.push(`${id}: missing blockerId`);
  } else {
    problems.push(`${id}: invalid outcome ${record.outcome}`);
  }
}

if (problems.length > 0) {
  console.error("AI Learning evidence manifest is NOT valid:");
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}

const passed = records.filter((record) => record.outcome === "pass").length;
const byLayer = records.reduce((acc, record) => {
  acc[record.layer] = (acc[record.layer] ?? 0) + 1;
  return acc;
}, {});
console.log(
  `AI Learning evidence manifest OK: ${records.length} record(s), ${passed} pass, layers ${JSON.stringify(byLayer)}.`,
);
if (records.length === 0) {
  console.log("No qualification evidence recorded yet; every advertised cell remains pending.");
}
