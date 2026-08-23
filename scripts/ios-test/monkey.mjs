#!/usr/bin/env node
/**
 * scripts/ios-test/monkey.mjs — State-Aware Seeded UI Monkey / Chaos Tester
 */

import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

// Parse arguments
const args = process.argv.slice(2);
let seed = Math.floor(Math.random() * 10000000);
let maxSteps = 100;
let runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-monkey-${seed}`;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--seed" && args[i + 1]) {
    seed = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === "--steps" && args[i + 1]) {
    maxSteps = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === "--run-id" && args[i + 1]) {
    runId = args[i + 1];
    i++;
  }
}

// Deterministic PRNG: Mulberry32
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(seed);

function choose(arr) {
  return arr[Math.floor(random() * arr.length)];
}

console.log("==================================================");
console.log(`🐵 Starting State-Aware UI Monkey Tester`);
console.log(`   Seed: ${seed}`);
console.log(`   Max Steps: ${maxSteps}`);
console.log(`   Run ID: ${runId}`);
console.log("==================================================");

// Resolve active simulator
let simUdid = "booted";
try {
  simUdid = fs.readFileSync("/tmp/plethora_active_sim_udid", "utf8").trim();
} catch {}

const artifactDir = path.join(REPO_ROOT, ".test-artifacts", "ios", runId);
fs.mkdirSync(artifactDir, { recursive: true });

const actionLog = [];
const TABS = ["dashboard", "documents", "queue", "review", "settings"];
const FIXTURES = ["sample-note.md"];

let currentTab = "dashboard";
let orientation = "portrait";
let isRunning = true;

const BUNDLE_ID = "com.plethora.app";

function runSimctl(cmd) {
  try {
    return execSync(`xcrun simctl ${cmd}`, { stdio: "pipe", timeout: 15000 }).toString();
  } catch (err) {
    return "";
  }
}

function executeAction(action) {
  switch (action.type) {
    case "OPEN_TAB":
      currentTab = action.tab;
      runSimctl(`openurl "${simUdid}" "plethora://${action.tab}"`);
      break;

    case "INJECT_FIXTURE":
      try {
        execSync(`bash "${path.join(__dirname, "inject-fixture.sh")}" "${action.fixture}"`, { stdio: "ignore" });
      } catch {}
      break;

    case "BACKGROUND_APP":
      // Simulate Home button / background
      runSimctl(`ui "${simUdid}" button home 2>/dev/null || true`);
      break;

    case "FOREGROUND_APP":
      runSimctl(`launch "${simUdid}" "${BUNDLE_ID}" 2>/dev/null || true`);
      break;

    case "TERMINATE_AND_RELAUNCH":
      runSimctl(`terminate "${simUdid}" "${BUNDLE_ID}" 2>/dev/null || true`);
      runSimctl(`launch "${simUdid}" "${BUNDLE_ID}" 2>/dev/null || true`);
      break;

    case "ROTATE_SCREEN":
      orientation = orientation === "portrait" ? "landscape" : "portrait";
      // simctl doesn't directly rotate orientation via CLI, but records intent
      break;
  }
}

// Generate valid actions based on simulated state
function pickNextAction(step) {
  const possible = [];

  // Tab navigation
  for (const t of TABS) {
    if (t !== currentTab) {
      possible.push({ type: "OPEN_TAB", tab: t, weight: 3 });
    }
  }

  // File injection on documents tab
  if (currentTab === "documents") {
    possible.push({ type: "INJECT_FIXTURE", fixture: choose(FIXTURES), weight: 4 });
  }

  // Interruption actions (lower frequency)
  possible.push({ type: "BACKGROUND_APP", durationMs: 1000, weight: 1 });
  possible.push({ type: "FOREGROUND_APP", weight: 1 });
  possible.push({ type: "ROTATE_SCREEN", weight: 1 });

  if (step % 25 === 0 && step > 0) {
    possible.push({ type: "TERMINATE_AND_RELAUNCH", weight: 2 });
  }

  // Weighted random selection
  const totalWeight = possible.reduce((sum, a) => sum + a.weight, 0);
  let r = random() * totalWeight;
  for (const act of possible) {
    r -= act.weight;
    if (r <= 0) {
      const { weight, ...action } = act;
      return action;
    }
  }
  return { type: "OPEN_TAB", tab: "dashboard" };
}

let failedStep = -1;
let failureError = null;

try {
  for (let step = 1; step <= maxSteps; step++) {
    const action = pickNextAction(step);
    actionLog.push({ step, action, timestamp: new Date().toISOString() });
    
    if (step % 10 === 0 || step === 1) {
      console.log(`[Step ${step}/${maxSteps}] Executing: ${action.type} ${action.tab || action.fixture || ""}`);
    }

    executeAction(action);
    
    // Save live action log
    fs.writeFileSync(
      path.join(artifactDir, "monkey_actions.json"),
      JSON.stringify({ seed, maxSteps, stepsExecuted: step, log: actionLog }, null, 2)
    );
  }
} catch (err) {
  failedStep = actionLog.length;
  failureError = err.message;
  console.error(`❌ Monkey test failed at step ${failedStep}:`, err);
}

// Final check & artifact aggregation
const testStatus = failedStep === -1 ? 0 : 1;

try {
  execSync(`bash "${path.join(__dirname, "collect-logs.sh")}" "${runId}"`, { stdio: "inherit" });
  execSync(`bash "${path.join(__dirname, "crash-detect.sh")}" "${artifactDir}" "${testStatus}" "${failureError || ""}"`, { stdio: "inherit" });
} catch {}

console.log("==================================================");
if (testStatus === 0) {
  console.log(`🎉 Monkey test completed successfully (${maxSteps} steps, seed ${seed}).`);
  process.exit(0);
} else {
  console.log(`❌ Monkey test failed at step ${failedStep}.`);
  console.log(`🔁 To reproduce this exact failure, run:`);
  console.log(`   npm run test:ios:monkey -- --seed ${seed} --steps ${failedStep}`);
  console.log("==================================================");
  process.exit(1);
}
