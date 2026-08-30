#!/usr/bin/env bash
# Emit a human-readable native build timing summary.
native_build_profile_report() {
  local platform="$1"
  shift
  local total=0
  local -a lines=()
  for entry in "$@"; do
    local label="${entry%%|*}"
    local secs="${entry##*|}"
    lines+=("$(printf '%-24s %8ss' "$label" "$secs")")
    total=$(awk -v a="$total" -v b="$secs" 'BEGIN { printf "%.1f", a + b }')
  done

  echo ""
  echo "Plethora ${platform} build timing"
  echo "---------------------------"
  for line in "${lines[@]}"; do
    echo "$line"
  done
  printf '%-24s %8ss\n' "Total" "$total"
  echo ""
}
