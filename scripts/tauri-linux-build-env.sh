#!/usr/bin/env bash
# Linux release-build memory envelope for Tauri/Cargo.
#
# Source of truth for Linux Tauri *release* builds invoked via
# scripts/tauri-wrapper.sh and scripts/tauri-linux-package.sh.
#
# - Respects caller-provided CARGO_BUILD_JOBS (sets PLETHORA_CARGO_JOBS_WAS_SET).
# - When unset, picks a memory-aware default (local cap 8, CI cap 4).
# - Guards against CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 (single huge LLVM module → OOM).

plethora_linux_mem_gb() {
  if [[ -r /proc/meminfo ]]; then
    local mem_kb
    mem_kb="$(awk '/^MemAvailable:/ { print $2; exit }' /proc/meminfo)"
    if [[ -z "$mem_kb" ]]; then
      mem_kb="$(awk '/^MemTotal:/ { print $2; exit }' /proc/meminfo)"
    fi
    if [[ -n "$mem_kb" ]]; then
      echo $(( (mem_kb + 1024 * 1024 - 1) / (1024 * 1024) ))
      return
    fi
  fi
  echo 8
}

plethora_linux_ncpu() {
  if command -v nproc >/dev/null 2>&1; then
    nproc
    return
  fi
  if [[ -r /proc/cpuinfo ]]; then
    grep -c '^processor' /proc/cpuinfo
    return
  fi
  echo 4
}

plethora_linux_default_cargo_jobs() {
  local ncpu mem_gb jobs_by_mem cap jobs
  ncpu="$(plethora_linux_ncpu)"
  mem_gb="$(plethora_linux_mem_gb)"
  jobs_by_mem=$(( mem_gb / 3 ))
  if (( jobs_by_mem < 1 )); then
    jobs_by_mem=1
  fi

  if [[ -n "${GITHUB_ACTIONS:-}" || -n "${CI:-}" ]]; then
    cap=4
  else
    cap=8
  fi

  jobs=$ncpu
  if (( jobs > jobs_by_mem )); then
    jobs=$jobs_by_mem
  fi
  if (( jobs > cap )); then
    jobs=$cap
  fi
  if (( jobs < 1 )); then
    jobs=1
  fi
  echo "$jobs"
}

if [[ -n "${CARGO_BUILD_JOBS:-}" ]]; then
  export PLETHORA_CARGO_JOBS_WAS_SET=1
else
  export CARGO_BUILD_JOBS
  CARGO_BUILD_JOBS="$(plethora_linux_default_cargo_jobs)"
  export PLETHORA_CARGO_JOBS_WAS_SET=0
fi

# A stale codegen-units=1 override creates one oversized LLVM module.
if [[ "${CARGO_PROFILE_RELEASE_CODEGEN_UNITS:-}" == "1" ]]; then
  export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=4
fi
