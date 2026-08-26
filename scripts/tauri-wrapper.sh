#!/usr/bin/env bash
set -euo pipefail

cmd="${1:-}"
shift || true

# Establish explicit Tauri frontend intent for every native build/dev path.
case "$cmd" in
  dev|build|android|ios)
    export PLETHORA_TAURI=1
    ;;
esac

if [[ "$cmd" == "build" ]]; then
  # On Arch Linux and other modern distros, linuxdeploy's bundled strip binary
  # doesn't support the .relr.dyn section (type 0x13) in newer ELF binaries.
  # Use NO_STRIP=1 to skip stripping and let the system handle it.
  if [[ "$(uname -s)" == "Linux" ]]; then
    export NO_STRIP=1
  fi
fi

if [[ "$cmd" == "dev" ]]; then
  # Tauri (wry/tao) on Linux requires a GTK display backend. In headless shells
  # this otherwise fails with a panic like:
  # "Failed to initialize gtk backend!: ... Failed to initialize GTK"
  #
  # Auto-wrap with Xvfb when available; otherwise fail fast with a clear hint.
  if [[ "$(uname -s)" == "Linux" ]]; then
    if [[ -z "${DISPLAY-}" && -z "${WAYLAND_DISPLAY-}" && -z "${MIR_SOCKET-}" ]]; then
      if command -v xvfb-run >/dev/null 2>&1; then
        export PLETHORA_TAURI_XVFB=1
      else
        cat >&2 <<'EOF'
No GUI session detected (DISPLAY/WAYLAND_DISPLAY unset).

On Linux, Tauri needs a GTK display backend to start. If you are running in a
headless environment, install Xvfb and rerun with xvfb-run:

  sudo apt-get update && sudo apt-get install -y xvfb
  xvfb-run -a npm run tauri dev
EOF
        exit 1
      fi
    fi
  fi

  port=15173
  dev_url="http://127.0.0.1:$port"
  started_vite=0

  # Start Vite as a direct child of this script so the sandbox allows the bind.
  # If a dev server is already listening on the expected port, reuse it.
  export PLETHORA_TAURI=1
  # Avoid macOS Keychain prompts during dev; the app falls back to its encrypted
  # local credential store instead.
  export PLETHORA_DISABLE_KEYCHAIN="${PLETHORA_DISABLE_KEYCHAIN:-${INCREMENTUM_DISABLE_KEYCHAIN:-1}}"

  dev_server_ready() {
    if command -v curl >/dev/null 2>&1; then
      curl -fsS --max-time 2 "$dev_url" >/dev/null 2>&1
      return $?
    fi

    if command -v ss >/dev/null 2>&1; then
      ss -ltn "( sport = :$port )" 2>/dev/null | tail -n +2 | grep -q ":$port"
      return $?
    fi

    if command -v lsof >/dev/null 2>&1; then
      lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
      return $?
    fi

    return 1
  }

  dev_server_is_tauri() {
    if ! command -v curl >/dev/null 2>&1; then
      return 1
    fi
    curl -fsS --max-time 2 "$dev_url/plethora-build-target.json" 2>/dev/null | grep -q '"target":"tauri"'
  }

  stop_dev_server() {
    if command -v lsof >/dev/null 2>&1; then
      lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true
      sleep 0.5
    fi
  }

  if dev_server_ready; then
    if dev_server_is_tauri; then
      echo "Reusing existing Tauri dev server on 127.0.0.1:$port"
    else
      echo "Non-Tauri dev server detected on 127.0.0.1:$port — restarting with PLETHORA_TAURI=1"
      stop_dev_server
      npm run dev -- --host 127.0.0.1 --port "$port" --strictPort &
      vite_pid=$!
      started_vite=1
    fi
  else
    npm run dev -- --host 127.0.0.1 --port "$port" --strictPort &
    vite_pid=$!
    started_vite=1
  fi

  for _ in {1..60}; do
    if dev_server_ready; then
      break
    fi
    sleep 0.5
  done

  if ! dev_server_ready; then
    echo "Vite dev server did not become ready at $dev_url" >&2
    exit 1
  fi
  trap 'if [[ "$started_vite" == "1" ]]; then kill "$vite_pid" 2>/dev/null || true; fi' EXIT

  export TAURI_CLI_NO_DEV_SERVER_WAIT=true
  export CARGO_BUILD_JOBS=1
  # Linux WebKitGTK/EGL stability defaults for dev sessions.
  if [[ "$(uname -s)" == "Linux" ]]; then
    export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS="${WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS:-1}"
    export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"
    export WEBKIT_DISABLE_COMPOSITING_MODE="${WEBKIT_DISABLE_COMPOSITING_MODE:-1}"
    export WEBKIT_DISABLE_HARDWARE_ACCELERATION="${WEBKIT_DISABLE_HARDWARE_ACCELERATION:-1}"
    unset WEBKIT_FORCE_SANDBOX || true
    export LIBGL_ALWAYS_SOFTWARE="${LIBGL_ALWAYS_SOFTWARE:-1}"
  fi
  # Prefer the X11 backend during dev on Linux. In mixed DISPLAY/WAYLAND
  # sessions, WebKitGTK/Tauri can finish compiling but fail to surface a
  # visible window under Wayland.
  if [[ "$(uname -s)" == "Linux" && -n "${DISPLAY-}" ]]; then
    export GDK_BACKEND="${GDK_BACKEND:-x11}"
    export WINIT_UNIX_BACKEND="${WINIT_UNIX_BACKEND:-x11}"
  fi
  # Explicitly select a known-good toolchain for reproducible dev builds.
  export RUSTUP_TOOLCHAIN="${RUSTUP_TOOLCHAIN:-1.89.0}"
  # Some crates (notably parts of sqlx) can trigger deep compiler stacks on
  # this toolchain; keep this high to avoid rustc SIGSEGVs.
  export RUST_MIN_STACK=2147483647
  # Linker selection is handled in `src-tauri/.cargo/config.toml` (we avoid
  # rustc's self-contained rust-lld on Linux).

  # Workaround for recurring rustc/LLVM SIGSEGVs seen in this environment:
  # - disabling incremental and debuginfo significantly reduces compiler stress.
  export CARGO_INCREMENTAL=0
  export CARGO_PROFILE_DEV_DEBUG=0

  if [[ "${PLETHORA_TAURI_XVFB-}" == "1" ]]; then
    # 24-bit color is required by some GTK/WebKit paths.
    xvfb-run -a -s "-screen 0 1280x720x24" tauri dev "$@"
  else
    tauri dev "$@"
  fi
  exit 0
fi

tauri "$cmd" "$@"
