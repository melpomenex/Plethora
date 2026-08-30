#!/usr/bin/env bash
# Optional Linux Rust build accelerators. Safe to source multiple times.

if [[ "$(uname -s)" != "Linux" ]]; then
  return 0 2>/dev/null || exit 0
fi

if [[ -z "${RUSTC_WRAPPER:-}" && -z "${PLETHORA_DISABLE_SCCACHE:-}" && -z "${GITHUB_ACTIONS:-}" ]]; then
  if command -v sccache >/dev/null 2>&1; then
    export RUSTC_WRAPPER=sccache
    export SCCACHE_CACHE_SIZE="${SCCACHE_CACHE_SIZE:-10G}"
  fi
fi

if [[ -z "${PLETHORA_DISABLE_MOLD:-}" && -z "${CARGO_BUILD_TARGET:-}" ]]; then
  local_target="${TAURI_ENV_TARGET_TRIPLE:-}"
  if [[ -z "$local_target" ]]; then
    arch="$(uname -m)"
    case "$arch" in
      x86_64) local_target="x86_64-unknown-linux-gnu" ;;
      aarch64|arm64) local_target="aarch64-unknown-linux-gnu" ;;
    esac
  fi

  if [[ "$local_target" == *-unknown-linux-gnu ]]; then
    if command -v mold >/dev/null 2>&1; then
      case " ${RUSTFLAGS:-} " in
        *" fuse-ld=mold "*) ;;
        *)
          export RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }-C link-arg=-fuse-ld=mold"
          ;;
      esac
    fi
  fi
fi
