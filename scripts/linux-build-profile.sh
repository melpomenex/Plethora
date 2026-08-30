#!/usr/bin/env bash
# Emit a human-readable Linux build timing summary.
# Sourced by scripts/tauri-linux-package.sh profile mode.

linux_build_profile_report() {
  local total=0
  local -a lines=()
  for entry in "$@"; do
    local label="${entry%%|*}"
    local secs="${entry##*|}"
    lines+=("$(printf '%-24s %8ss' "$label" "$secs")")
    total=$(awk -v a="$total" -v b="$secs" 'BEGIN { printf "%.1f", a + b }')
  done

  echo ""
  echo "Plethora Linux build timing"
  echo "---------------------------"
  for line in "${lines[@]}"; do
    echo "$line"
  done
  printf '%-24s %8ss\n' "Total" "$total"
  echo ""
}
