#!/usr/bin/env bash
# Memory-aware Cargo parallelism for native Tauri builds (all platforms).
#
# - Respects caller-provided CARGO_BUILD_JOBS (sets PLETHORA_CARGO_JOBS_WAS_SET).
# - When unset, picks jobs from CPU + RAM with platform-specific caps.
# - Guards against CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 (OOM on large crate).

plethora_host_os() {
  uname -s 2>/dev/null || echo unknown
}

plethora_mem_gb() {
  local os
  os="$(plethora_host_os)"
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
  if [[ "$os" == "Darwin" ]]; then
    echo $(( $(sysctl -n hw.memsize 2>/dev/null || echo 8589934592) / 1024 / 1024 / 1024 ))
    return
  fi
  if command -v wmic.exe >/dev/null 2>&1; then
    wmic.exe OS get TotalVisibleMemorySize /value 2>/dev/null \
      | awk -F= '/TotalVisibleMemorySize=/ { print int(($2 + 1048575) / 1048576); exit }'
    return
  fi
  echo 8
}

plethora_ncpu() {
  local os
  os="$(plethora_host_os)"
  if command -v nproc >/dev/null 2>&1; then
    nproc
    return
  fi
  if [[ "$os" == "Darwin" ]]; then
    sysctl -n hw.ncpu 2>/dev/null || echo 4
    return
  fi
  if [[ -r /proc/cpuinfo ]]; then
    grep -c '^processor' /proc/cpuinfo
    return
  fi
  echo 4
}

plethora_default_cargo_jobs() {
  local ncpu mem_gb jobs_by_mem cap jobs
  ncpu="$(plethora_ncpu)"
  mem_gb="$(plethora_mem_gb)"
  jobs_by_mem=$(( mem_gb / 3 ))
  if (( jobs_by_mem < 1 )); then
    jobs_by_mem=1
  fi

  # Android builds run Gradle alongside rustc — stay conservative.
  if [[ -n "${PLETHORA_ANDROID_BUILD:-}" ]]; then
    if [[ -n "${GITHUB_ACTIONS:-}" || -n "${CI:-}" ]]; then
      cap=1
    else
      cap=2
    fi
  elif [[ -n "${GITHUB_ACTIONS:-}" || -n "${CI:-}" ]]; then
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
  CARGO_BUILD_JOBS="$(plethora_default_cargo_jobs)"
  export PLETHORA_CARGO_JOBS_WAS_SET=0
fi

if [[ "${CARGO_PROFILE_RELEASE_CODEGEN_UNITS:-}" == "1" ]]; then
  export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=4
fi
