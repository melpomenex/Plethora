#!/usr/bin/env bash
# scripts/ios-test/crash-detect.sh — Analyze logs and classify test failures

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ -n "${1:-}" ]; then
  ARTIFACT_DIR="$1"
elif [ -f /tmp/plethora_last_artifact_dir ]; then
  ARTIFACT_DIR=$(cat /tmp/plethora_last_artifact_dir)
else
  echo "❌ Error: Artifact directory must be specified."
  exit 1
fi

node -e '
  const fs = require("fs");
  const path = require("path");

  const artifactDir = process.argv[1];
  const testExitCode = parseInt(process.argv[2] || "0", 10);
  const failureReason = process.argv[3] || "";

  let classification = "unknown";
  let status = testExitCode === 0 ? "PASSED" : "FAILED";
  let failureDetail = failureReason;

  const readLog = (name) => {
    const p = path.join(artifactDir, name);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  };

  const stderr = readLog("stderr.log");
  const stdout = readLog("stdout.log");
  const unified = readLog("unified.log");
  const jsErrors = readLog("javascript-errors.log");
  const hasIps = fs.existsSync(path.join(artifactDir, "crash.ips"));

  if (status === "PASSED") {
    classification = "none";
  } else if (hasIps) {
    classification = "native_crash";
    failureDetail = failureDetail || "Native crash log (.ips) was produced during test execution.";
  } else if (stderr.includes("panicked at") || stdout.includes("panicked at") || stderr.includes("fatal runtime error")) {
    classification = "rust_panic";
    failureDetail = failureDetail || "Rust panic detected in process stderr/stdout.";
  } else if (unified.includes("Terminating app due to uncaught exception") || unified.includes("Fatal error:")) {
    classification = "swift_exception";
    failureDetail = failureDetail || "Uncaught Swift/ObjC exception detected in system log.";
  } else if (jsErrors.length > 0 || unified.includes("[Global Error]") || unified.includes("Startup Error")) {
    classification = "javascript_exception";
    failureDetail = failureDetail || "Uncaught JavaScript error or React ErrorBoundary crash.";
  } else if (failureReason.includes("startup_timeout") || failureReason.includes("timed out waiting for readiness")) {
    classification = "startup_timeout";
  } else if (failureReason.includes("ui_hang") || failureReason.includes("heartbeat")) {
    classification = "ui_hang";
  } else if (failureReason.includes("ipc_timeout")) {
    classification = "ipc_timeout";
  } else if (unified.includes("0x8badf00d") || stderr.includes("0x8badf00d")) {
    classification = "watchdog_termination";
  } else if (unified.includes("Memorystatus") || unified.includes("Jetsam")) {
    classification = "memory_pressure_or_oom";
  } else {
    classification = "unexpected_process_exit";
  }

  let metadata = {};
  const metaPath = path.join(artifactDir, "metadata.json");
  if (fs.existsSync(metaPath)) {
    try { metadata = JSON.parse(fs.readFileSync(metaPath, "utf8")); } catch {}
  }

  const result = {
    runId: metadata.runId || path.basename(artifactDir),
    timestamp: metadata.timestamp || new Date().toISOString(),
    status,
    classification,
    exitCode: testExitCode,
    commit: metadata.commit || "unknown",
    branch: metadata.branch || "unknown",
    dirty: metadata.dirty || false,
    failureDetail: failureDetail || null,
    artifacts: {
      screenshot: fs.existsSync(path.join(artifactDir, "screenshot.png")) ? "screenshot.png" : null,
      unifiedLog: fs.existsSync(path.join(artifactDir, "unified.log")) ? "unified.log" : null,
      stdout: fs.existsSync(path.join(artifactDir, "stdout.log")) ? "stdout.log" : null,
      stderr: fs.existsSync(path.join(artifactDir, "stderr.log")) ? "stderr.log" : null,
      crashIps: hasIps ? "crash.ips" : null
    }
  };

  fs.writeFileSync(path.join(artifactDir, "test-result.json"), JSON.stringify(result, null, 2));

  console.log("--------------------------------------------------");
  console.log(`Test Verdict: ${status}`);
  console.log(`Classification: ${classification}`);
  if (failureDetail) console.log(`Detail: ${failureDetail}`);
  console.log("--------------------------------------------------");
' "$ARTIFACT_DIR" "${2:-0}" "${3:-}"
