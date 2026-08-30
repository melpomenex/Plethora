#!/usr/bin/env bash
set -euo pipefail

# Unified Linux package build entry.
# Modes: release | fast | binary | bundle | profile

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MODE="${1:-release}"
BUNDLE="${2:-deb}"
STAMP_FILE="$ROOT_DIR/.cache/linux-binary-stamp"

source "$ROOT_DIR/scripts/tauri-linux-build-env.sh"
# shellcheck source=scripts/linux-build-accelerators.sh
source "$ROOT_DIR/scripts/linux-build-accelerators.sh"

export PLETHORA_TAURI=1
export NO_STRIP=1

resolve_profile() {
  if [[ -n "${PLETHORA_LINUX_CARGO_PROFILE:-}" ]]; then
    echo "$PLETHORA_LINUX_CARGO_PROFILE"
    return
  fi
  case "$1" in
    fast) echo "package-fast" ;;
    *) echo "release" ;;
  esac
}

cargo_target_dir() {
  local profile="$1"
  if [[ "$profile" == "release" ]]; then
    echo "release"
  else
    echo "$profile"
  fi
}

binary_path() {
  local profile="$1"
  echo "$ROOT_DIR/src-tauri/target/$(cargo_target_dir "$profile")/plethora-tauri"
}

sidecar_digest() {
  if [[ ! -d "$ROOT_DIR/src-tauri/bin" ]]; then
    echo nosidecars
    return
  fi
  (
    cd "$ROOT_DIR/src-tauri/bin"
    find . -type f ! -name '.*' -print0 2>/dev/null \
      | sort -z \
      | xargs -0 sha256sum 2>/dev/null \
      | sha256sum \
      | awk '{print $1}'
  ) || echo nosidecars
}

stamp_payload() {
  local profile="$1"
  local head lock cargo_toml tauri_conf frontend_meta dirty sidecars
  head="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  lock="$(sha256sum src-tauri/Cargo.lock 2>/dev/null | awk '{print $1}' || echo nolock)"
  cargo_toml="$(sha256sum src-tauri/Cargo.toml 2>/dev/null | awk '{print $1}' || echo nocargo)"
  tauri_conf="$(cat src-tauri/tauri.conf.json src-tauri/tauri.linux.conf.json 2>/dev/null | sha256sum | awk '{print $1}' || echo notauri)"
  frontend_meta="$(sha256sum dist/plethora-build-metadata.json 2>/dev/null | awk '{print $1}' || echo nofrontend)"
  dirty="$(git status --porcelain 2>/dev/null | sha256sum | awk '{print $1}' || echo nodirty)"
  sidecars="$(sidecar_digest)"
  echo "${head}:${profile}:${lock}:${cargo_toml}:${tauri_conf}:${frontend_meta}:${dirty}:${sidecars}"
}

write_stamp() {
  local profile="$1"
  mkdir -p "$(dirname "$STAMP_FILE")"
  stamp_payload "$profile" >"$STAMP_FILE"
}

check_stamp() {
  local profile="$1"
  if [[ ! -f "$STAMP_FILE" ]]; then
    echo "No Linux binary stamp at $STAMP_FILE — run npm run tauri:build:linux:binary first." >&2
    exit 1
  fi
  local expected current
  expected="$(stamp_payload "$profile")"
  current="$(cat "$STAMP_FILE")"
  if [[ "$current" != "$expected" ]]; then
    echo "Linux binary stamp is stale." >&2
    echo "Expected: $expected" >&2
    echo "Current:  $current" >&2
    echo "Re-run npm run tauri:build:linux:binary or set PLETHORA_ALLOW_STALE_BINARY=1 to override." >&2
    if [[ "${PLETHORA_ALLOW_STALE_BINARY:-}" != "1" ]]; then
      exit 1
    fi
    echo "WARNING: bundling with PLETHORA_ALLOW_STALE_BINARY=1" >&2
  fi
}

ensure_binary_exists() {
  local profile="$1"
  if [[ ! -x "$(binary_path "$profile")" ]]; then
    echo "Binary missing at $(binary_path "$profile")" >&2
    exit 1
  fi
}

apply_fast_profile_job_cap() {
  local profile="$1"
  if [[ "$profile" == "package-fast" && "${PLETHORA_CARGO_JOBS_WAS_SET:-0}" != "1" ]]; then
    if (( CARGO_BUILD_JOBS > 4 )); then
      export CARGO_BUILD_JOBS=4
    fi
  fi
}

print_banner() {
  local kind="$1"
  case "$kind" in
    fast)
      cat <<'EOF'

================================================================================
 FAST LOCAL PACKAGE — NOT FOR DISTRIBUTION
 Uses profile.package-fast (no LTO, faster iteration)
================================================================================

EOF
      ;;
    release|profile|binary)
      cat <<'EOF'

================================================================================
 PRODUCTION RELEASE PACKAGE
 Uses profile.release (thin LTO, production optimization)
================================================================================

EOF
      ;;
  esac
}

run_tauri_build() {
  local profile="$1"
  shift
  if [[ "$profile" == "release" ]]; then
    tauri build "$@"
  else
    tauri build "$@" -- --profile "$profile"
  fi
}

restore_staged_release_binary() {
  local release_bin backup
  release_bin="$(binary_path release)"
  backup="${release_bin}.bundle-backup"
  if [[ -f "$backup" ]]; then
    mv -f "$backup" "$release_bin"
  fi
}

stage_profile_binary_for_bundle() {
  local profile="$1"
  if [[ "$profile" == "release" ]]; then
    return
  fi
  local release_bin profile_bin backup
  release_bin="$(binary_path release)"
  profile_bin="$(binary_path "$profile")"
  backup="${release_bin}.bundle-backup"
  mkdir -p "$(dirname "$release_bin")"
  if [[ -f "$release_bin" ]]; then
    cp -f "$release_bin" "$backup"
  fi
  cp -f "$profile_bin" "$release_bin"
  echo "Staged $(basename "$profile_bin") into release path for tauri bundle (backup restored after)."
}

PROFILE="$(resolve_profile "$MODE")"
apply_fast_profile_job_cap "$PROFILE"

case "$MODE" in
  release|fast)
    if [[ "$MODE" == "fast" ]]; then
      print_banner fast
    else
      print_banner release
    fi
    run_tauri_build "$PROFILE" --bundles "$BUNDLE"
    write_stamp "$PROFILE"
    ;;

  profile)
    if [[ "$PROFILE" == "package-fast" ]]; then
      print_banner fast
    else
      print_banner profile
    fi
    t0=$(date +%s)
    run_tauri_build "$PROFILE" --bundles "$BUNDLE"
    t1=$(date +%s)
    # shellcheck source=scripts/linux-build-profile.sh
    source "$ROOT_DIR/scripts/linux-build-profile.sh"
    linux_build_profile_report "total_wall_clock|$((t1 - t0)).0"
    echo "For Rust phase detail, re-run with: CARGO_BUILD_TIMING=1 (see target/cargo-timings/)"
    write_stamp "$PROFILE"
    ;;

  binary)
    if [[ "$PROFILE" == "package-fast" ]]; then
      print_banner fast
    else
      print_banner release
    fi
    run_tauri_build "$PROFILE" --no-bundle
    write_stamp "$PROFILE"
    ;;

  bundle)
    check_stamp "$PROFILE"
    ensure_binary_exists "$PROFILE"
    NOTEBOOKLM_BUNDLE_RUNTIME="${NOTEBOOKLM_BUNDLE_RUNTIME:-1}" \
      POCKET_TTS_BUNDLE_RUNTIME="${POCKET_TTS_BUNDLE_RUNTIME:-1}" \
      node scripts/download-sidecars.js
    trap restore_staged_release_binary EXIT
    stage_profile_binary_for_bundle "$PROFILE"
    tauri bundle --bundles "$BUNDLE"
    ;;

  *)
    echo "Unknown mode: $MODE (expected release|fast|binary|bundle|profile)" >&2
    exit 1
    ;;
esac
