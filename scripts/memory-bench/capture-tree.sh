#!/usr/bin/env bash
# One-command incident capture for the Plethora process tree (macOS incident,
# Phase 0 task 1.2 of eliminate-long-running-memory-growth).
#
# This is a MANUAL DIAGNOSTIC ARTIFACT, not a collector: it exists so that the
# next occurrence of the ~74 GB class incident leaves behind per-process
# evidence (which process, which role, growth shape) instead of a single
# unattributed number. Run it FIRST if the incident recurs:
#
#   bash scripts/memory-bench/capture-tree.sh            # auto-find the app pid
#   bash scripts/memory-bench/capture-tree.sh <rootPid>  # explicit root pid
#
# Captures, timestamped under .bench/tree-captures/<UTC-timestamp>/:
#   - ps table of the whole tree (pid, ppid, %cpu, rss, vsz, etime, command)
#   - per-pid vmmap -summary, leaks, and a 10 s sample profile
#
# Never kills or otherwise disturbs the processes; read-only. Safe to run
# repeatedly (each run gets its own directory) — a pair of captures an hour
# apart shows the growth shape directly.

set -euo pipefail

ROOT_PID="${1:-}"

if [[ -z "$ROOT_PID" ]]; then
  # Find the Plethora app process: prefer the packaged app, fall back to a
  # debug-build binary, else the newest process whose command matches.
  ROOT_PID="$(ps -axo pid,command | grep -E "Plethora\.app/Contents/MacOS|target/debug/plethora-tauri" | grep -v grep | tail -1 | awk '{print $1}')"
  if [[ -z "$ROOT_PID" ]]; then
    echo "usage: $0 <rootPid>   (no Plethora process found to auto-detect)" >&2
    exit 2
  fi
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="$(pwd)/.bench/tree-captures/${STAMP}"
mkdir -p "${OUT_DIR}"

echo "[capture-tree] root pid ${ROOT_PID} -> ${OUT_DIR}"

# Process tree: the root, its descendants by PPID walk (re-resolved per line
# so late-appearing children are seen), role-identifiable by command.
ps -axo pid,ppid,%cpu,rss,vsz,etime,command > "${OUT_DIR}/ps-full.txt"

collect_descendants() {
  local parent="$1"
  ps -axo pid=,ppid= | awk -v root="${parent}" '$2 == root { print $1 }'
}

TREE_PIDS=("${ROOT_PID}")
FRONTIER=("${ROOT_PID}")
while ((${#FRONTIER[@]})); do
  NEXT=()
  for pid in "${FRONTIER[@]}"; do
    while read -r child; do
      [[ -n "${child}" ]] || continue
      TREE_PIDS+=("${child}")
      NEXT+=("${child}")
    done < <(collect_descendants "${pid}")
  done
  FRONTIER=("${NEXT[@]+"${NEXT[@]}"}")
done

ps -axo pid,ppid,%cpu,rss,vsz,etime,command | (head -1; grep -E "^($(IFS='|'; echo "${TREE_PIDS[*]}")) " ) > "${OUT_DIR}/ps-tree.txt" || true
printf '%s\n' "${TREE_PIDS[@]}" > "${OUT_DIR}/tree-pids.txt"

for pid in "${TREE_PIDS[@]}"; do
  echo "[capture-tree] pid ${pid}: vmmap / leaks / sample"
  # Each artifact is best-effort: a pid that exits mid-capture (or a macOS
  # restriction on inspecting it) must not abort the rest of the capture.
  vmmap -summary "${pid}" > "${OUT_DIR}/vmmap-${pid}.txt" 2>&1 || true
  leaks "${pid}" > "${OUT_DIR}/leaks-${pid}.txt" 2>&1 || true
  sample "${pid}" 10 -file "${OUT_DIR}/sample-${pid}.txt" >/dev/null 2>&1 || true
done

echo "[capture-tree] done. ${#TREE_PIDS[@]} process(es) captured in ${OUT_DIR}"
echo "[capture-tree] compare against a later capture to read the growth shape."
