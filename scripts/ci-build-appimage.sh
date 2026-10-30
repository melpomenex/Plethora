#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APPIMAGE_DIR="src-tauri/target/release/bundle/appimage"
APPDIR="$APPIMAGE_DIR/Plethora.AppDir"
NOTEBOOKLM_RUNTIME_SRC="src-tauri/bin/notebooklm-runtime"
NOTEBOOKLM_RUNTIME_DST="$APPDIR/usr/bin/notebooklm-runtime"
WORK_DIR="/tmp/appimagetool-work"
APPIMAGETOOL_APPIMAGE="$WORK_DIR/appimagetool.AppImage"
APPIMAGETOOL_BIN="$WORK_DIR/squashfs-root/AppRun"
RUNTIME_FILE="$WORK_DIR/runtime-x86_64"

EXPECTED_APPIMAGE="$(node -e 'const c=require("./src-tauri/tauri.conf.json"); console.log(`src-tauri/target/release/bundle/appimage/${c.productName}_${c.version}_amd64.AppImage`)')"

# Do not let a failed Tauri invocation fall through to packaging yesterday's
# AppDir. Move any prior bundle aside so only this invocation can produce the
# AppDir used below. Keep the prior bundle recoverable if packaging fails.
mkdir -p "$APPIMAGE_DIR"
APPDIR_BACKUP_DIR=""
if [[ -d "$APPDIR" ]]; then
  APPDIR_BACKUP_DIR="$(mktemp -d "$APPIMAGE_DIR/.Plethora.AppDir.previous.XXXXXX")"
  mv "$APPDIR" "$APPDIR_BACKUP_DIR/Plethora.AppDir"
fi
PACKAGE_OUT_DIR=""
build_succeeded=0
cleanup_appimage_build() {
  if [[ -n "$PACKAGE_OUT_DIR" && -d "$PACKAGE_OUT_DIR" ]]; then
    rm -rf "$PACKAGE_OUT_DIR"
  fi
  if [[ "$build_succeeded" == "1" ]]; then
    if [[ -n "$APPDIR_BACKUP_DIR" ]]; then
      rm -rf "$APPDIR_BACKUP_DIR"
    fi
  elif [[ ! -d "$APPDIR" && -n "$APPDIR_BACKUP_DIR" && -d "$APPDIR_BACKUP_DIR/Plethora.AppDir" ]]; then
    mv "$APPDIR_BACKUP_DIR/Plethora.AppDir" "$APPDIR"
    rmdir "$APPDIR_BACKUP_DIR" 2>/dev/null || true
  elif [[ -n "$APPDIR_BACKUP_DIR" && -d "$APPDIR_BACKUP_DIR/Plethora.AppDir" ]]; then
    echo "Previous AppDir preserved at $APPDIR_BACKUP_DIR/Plethora.AppDir"
  fi
}
trap cleanup_appimage_build EXIT

echo "Building AppImage with tauri..."
build_rc=0
APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1 npm run tauri -- build --bundles appimage || build_rc=$?
if [[ $build_rc -ne 0 ]]; then
  echo "tauri appimage build exited with $build_rc; attempting fallback packaging from AppDir"
fi

if [[ ! -d "$APPDIR" ]]; then
  echo "Expected AppDir missing at $APPDIR"
  exit 1
fi
if [[ ! -x "$APPDIR/usr/bin/plethora-tauri" ]]; then
  echo "Tauri build did not produce the executable AppDir binary: $APPDIR/usr/bin/plethora-tauri"
  exit 1
fi

RUNTIME_TRIPLE="x86_64-unknown-linux-gnu"
RUNTIME_PY_SRC="$NOTEBOOKLM_RUNTIME_SRC/$RUNTIME_TRIPLE/python/bin/python3"
RUNTIME_MANIFEST_SRC="$NOTEBOOKLM_RUNTIME_SRC/$RUNTIME_TRIPLE/runtime-manifest.json"
RUNTIME_MODULE_SRC="$NOTEBOOKLM_RUNTIME_SRC/$RUNTIME_TRIPLE/site-packages/notebooklm"
RUNTIME_SIDECAR_SRC="src-tauri/bin/notebooklm-$RUNTIME_TRIPLE"

if [[ ! -x "$RUNTIME_PY_SRC" || ! -f "$RUNTIME_MANIFEST_SRC" || ! -d "$RUNTIME_MODULE_SRC" || ! -x "$RUNTIME_SIDECAR_SRC" ]]; then
  echo "NotebookLM runtime source incomplete; bootstrapping portable runtime for $RUNTIME_TRIPLE..."
  NOTEBOOKLM_BUNDLE_RUNTIME=1 TARGET_TRIPLE="$RUNTIME_TRIPLE" node scripts/download-sidecars.js
fi

if [[ ! -x "$RUNTIME_PY_SRC" || ! -f "$RUNTIME_MANIFEST_SRC" || ! -d "$RUNTIME_MODULE_SRC" || ! -x "$RUNTIME_SIDECAR_SRC" ]]; then
  echo "NotebookLM runtime source still incomplete after bootstrap."
  exit 1
fi

echo "Injecting notebooklm runtime into AppDir..."
mkdir -p "$NOTEBOOKLM_RUNTIME_DST"
rsync -a --delete "$NOTEBOOKLM_RUNTIME_SRC"/ "$NOTEBOOKLM_RUNTIME_DST"/

# Copy the notebooklm sidecar binary to AppDir
NOTEBOOKLM_SIDECAR_SRC="src-tauri/bin/notebooklm-$RUNTIME_TRIPLE"
NOTEBOOKLM_SIDECAR_DST="$APPDIR/usr/bin/notebooklm-$RUNTIME_TRIPLE"
if [[ -x "$NOTEBOOKLM_SIDECAR_SRC" ]]; then
  echo "Copying notebooklm sidecar to AppDir..."
  cp -f "$NOTEBOOKLM_SIDECAR_SRC" "$NOTEBOOKLM_SIDECAR_DST"
  chmod +x "$NOTEBOOKLM_SIDECAR_DST"
else
  echo "NotebookLM sidecar not found at $NOTEBOOKLM_SIDECAR_SRC"
  exit 1
fi

scripts/verify-notebooklm-runtime.sh "$APPDIR/usr/bin"

# === Bundle GStreamer Plugins for YouTube/Video Playback ===
# WebKitGTK requires GStreamer plugins for H.264 and other codecs
bundle_gstreamer_plugins() {
  echo "Bundling GStreamer plugins for media codec support..."

  # Find system GStreamer plugins directory
  local GST_PLUGINS_DIR=""
  if command -v pkg-config &>/dev/null; then
    GST_PLUGINS_DIR="$(pkg-config --variable=pluginsdir gstreamer-1.0 2>/dev/null || true)"
  fi

  # Fallback locations
  if [[ -z "$GST_PLUGINS_DIR" || ! -d "$GST_PLUGINS_DIR" ]]; then
    for dir in "/usr/lib/gstreamer-1.0" "/usr/lib/x86_64-linux-gnu/gstreamer-1.0" "/usr/lib64/gstreamer-1.0"; do
      if [[ -d "$dir" ]]; then
        GST_PLUGINS_DIR="$dir"
        break
      fi
    done
  fi

  if [[ -z "$GST_PLUGINS_DIR" || ! -d "$GST_PLUGINS_DIR" ]]; then
    echo "Required GStreamer plugin directory could not be found."
    return 1
  fi

  echo "Found GStreamer plugins at: $GST_PLUGINS_DIR"

  # Create destination directory
  local GST_DEST="$APPDIR/usr/lib/gstreamer-1.0"
  mkdir -p "$GST_DEST"
  find "$GST_DEST" -maxdepth 1 -type f -name '*.so' -delete

  # Essential plugins for YouTube/video playback
  # - libgstcoreelements.so (required)
  # - libgstplayback.so (required)
  # - libgstlibav.so (H.264, AAC codecs - from gst-libav)
  # - libgstvideoconvertscale.so (video processing)
  # - libgstaudioconvert.so, libgstaudioresample.so (audio)
  # - libgstvorbis.so, libgstopus.so (audio codecs)
  # - libgstisomp4.so (MP4 container)
  # - libgsttypefindfunctions.so (media type detection)
  # - libgstopengl.so (OpenGL rendering, required by WebKitGTK; named
  #   libgstgl.so before GStreamer 1.24-ish — bundle both names)
  # - libgstvpx.so, libgstdav1d.so (VP9/AV1 — YouTube's preferred MSE codecs)
  # - libgstpulseaudio.so / libgstpipewire.so (audio sinks; the pulse plugin
  #   was named libgstpulse.so before GStreamer 1.24-ish — bundle both names)
  # - libgstva.so (VA-API hardware decode; skipped silently where absent)
  local PLUGINS=(
    "libgstcoreelements.so"
    "libgstcoretracers.so"
    "libgstplayback.so"
    "libgstlibav.so"
    "libgstvideoconvertscale.so"
    "libgstaudioconvert.so"
    "libgstaudioresample.so"
    "libgstvorbis.so"
    "libgstopus.so"
    "libgstisomp4.so"
    "libgsttypefindfunctions.so"
    "libgstapp.so"
    "libgstautodetect.so"
    "libgstpulse.so"
    "libgstpulseaudio.so"
    "libgstpipewire.so"
    "libgstalsa.so"
    "libgstgl.so"
    "libgstopengl.so"
    "libgstvpx.so"
    "libgstdav1d.so"
    "libgstva.so"
  )
  local REQUIRED_PLUGINS=(
    "libgstcoreelements.so"
    "libgstplayback.so"
    "libgstlibav.so"
    "libgstvideoconvertscale.so"
    "libgstaudioconvert.so"
    "libgstaudioresample.so"
    "libgstisomp4.so"
    "libgsttypefindfunctions.so"
    "libgstapp.so"
  )

  local copied=0
  for plugin in "${PLUGINS[@]}"; do
    if [[ -f "$GST_PLUGINS_DIR/$plugin" ]]; then
      if ! cp -L "$GST_PLUGINS_DIR/$plugin" "$GST_DEST/"; then
        echo "Failed to copy GStreamer plugin: $plugin"
        return 1
      fi
      ((copied++)) || true
    else
      for required in "${REQUIRED_PLUGINS[@]}"; do
        if [[ "$plugin" == "$required" ]]; then
          echo "Required GStreamer plugin missing from $GST_PLUGINS_DIR: $plugin"
          return 1
        fi
      done
    fi
  done

  if [[ $copied -eq 0 ]]; then
    echo "No GStreamer plugins were copied from $GST_PLUGINS_DIR"
    return 1
  fi

  local plugin_set_id
  plugin_set_id="$(cd "$GST_DEST" && sha256sum ./*.so | sha256sum | awk '{print $1}')"
  if [[ ! "$plugin_set_id" =~ ^[[:xdigit:]]{64}$ ]]; then
    echo "Could not derive a GStreamer plugin-set identity"
    return 1
  fi
  mkdir -p "$APPDIR/usr/share/plethora"
  printf '%s\n' "$plugin_set_id" > "$APPDIR/usr/share/plethora/gstreamer-plugin-set-id"

  # Bundle the codec libraries these plugins link against (ffmpeg, libvpx,
  # dav1d, aom). linuxdeploy never sees the plugin files — they are copied
  # after it runs — so without this step libgstlibav.so et al. fail to load on
  # hosts without a soname-matching system ffmpeg/libvpx.
  local dep_base=""
  local -A copied_deps=()
  for plugin in "$GST_DEST"/*.so; do
    [[ -f "$plugin" ]] || continue
    while read -r dep; do
      dep_base="$(basename "$dep")"
      case "$dep_base" in
        libavcodec*|libavformat*|libavutil*|libswresample*|libswscale*|libpostproc*|libvpx*|libdav1d*|libaom*)
          if [[ -z "${copied_deps[$dep_base]:-}" && ! -e "$APPDIR/usr/lib/$dep_base" ]]; then
            cp -L "$dep" "$APPDIR/usr/lib/$dep_base"
            copied_deps[$dep_base]=1
            echo "Bundled codec dependency: $dep_base"
          fi
          ;;
      esac
    done < <(ldd "$plugin" 2>/dev/null | awk '$3 ~ /^\// {print $3}')
  done

  echo "Copied $copied GStreamer plugins to AppDir"

  # List what was copied
  if [[ -d "$GST_DEST" ]]; then
    echo "Bundled GStreamer plugins:"
    ls -la "$GST_DEST"/*.so 2>/dev/null || echo "  (none)"
  fi

  # Remove any GStreamer core libraries that tauri-bundler/linuxdeploy may have placed
  # in the AppDir. Bundled core libs (from Ubuntu's older GStreamer) conflict with
  # system WebKitGTK on distros like Arch that ship newer GStreamer versions.
  # Plugins are loaded via GST_PLUGIN_PATH set in main.rs; core libs come from the system.
  echo "Removing any bundled GStreamer core libraries..."
  rm -f "$APPDIR/usr/lib"/libgst*.so.* "$APPDIR/usr/lib"/libgstreamer*.so.*
}

bundle_gstreamer_plugins

PLUGIN_SET_ID_PATH="$APPDIR/usr/share/plethora/gstreamer-plugin-set-id"
if [[ ! -s "$PLUGIN_SET_ID_PATH" ]] || ! grep -Eq '^[[:xdigit:]]{64}$' "$PLUGIN_SET_ID_PATH"; then
  echo "GStreamer plugin-set manifest is missing or invalid: $PLUGIN_SET_ID_PATH"
  exit 1
fi

# Fix absolute symlinks in the AppDir (Python stdlib, linuxdeploy artifacts, etc.)
# Absolute symlinks break on user machines since they point to CI runner paths.
fixed=0
broken=0
find "$APPDIR" -type l | while read -r link; do
  target="$(readlink "$link")"
  if [[ "$target" = /* ]]; then
    if [[ -e "$target" ]]; then
      rm "$link"
      cp -aL "$target" "$link"
    else
      rm "$link"
    fi
  fi
done
echo "Absolute symlinks in AppDir cleaned up"

# appimagetool refuses to package an AppDir containing files other users cannot
# read (or executables they cannot run). Two bundled inputs carry restrictive
# modes: Playwright unpacks chrome-linux64/*.deps as 0600 and linuxdeploy writes
# AppRun as 0770. Normalize the finished tree right before packaging so those
# upstream modes cannot abort the build.
echo "Normalizing AppDir permissions for appimagetool..."
chmod -R a+rX "$APPDIR"
chmod a+rx "$APPDIR/AppRun"

mkdir -p "$WORK_DIR"
if [[ ! -x "$APPIMAGETOOL_BIN" ]]; then
  curl -fsSL -o "$APPIMAGETOOL_APPIMAGE" \
    "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage"
  chmod +x "$APPIMAGETOOL_APPIMAGE"
  (
    cd "$WORK_DIR"
    APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGETOOL_APPIMAGE" --appimage-extract >/dev/null
  )
fi

if [[ ! -f "$RUNTIME_FILE" ]]; then
  curl -fsSL -o "$RUNTIME_FILE" \
    "https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64"
  chmod +x "$RUNTIME_FILE"
fi

desktop_file="$(find "$APPDIR/usr/share/applications" -maxdepth 1 -type f -name '*.desktop' | head -n1 || true)"
if [[ -n "$desktop_file" ]]; then
  icon_name="$(awk -F= '/^Icon=/{print $2; exit}' "$desktop_file")"
  if [[ -n "$icon_name" && ! -f "$APPDIR/$icon_name.png" ]]; then
    if [[ -f "$APPDIR/Plethora.png" ]]; then
      cp -f "$APPDIR/Plethora.png" "$APPDIR/$icon_name.png"
    fi
  fi
fi

PACKAGE_OUT_DIR="$(mktemp -d "$APPIMAGE_DIR/.appimage-package.XXXXXX")"
(
  cd "$PACKAGE_OUT_DIR"
  ARCH=x86_64 "$APPIMAGETOOL_BIN" --runtime-file "$RUNTIME_FILE" "$ROOT_DIR/$APPDIR"
)

PACKAGED_APPIMAGE="$PACKAGE_OUT_DIR/Plethora-x86_64.AppImage"
if [[ ! -f "$PACKAGED_APPIMAGE" ]]; then
  echo "appimagetool packaging did not produce $PACKAGED_APPIMAGE"
  exit 1
fi

mv -f "$PACKAGED_APPIMAGE" "$EXPECTED_APPIMAGE"

if [[ ! -f "$EXPECTED_APPIMAGE" ]]; then
  echo "Expected AppImage missing: $EXPECTED_APPIMAGE"
  exit 1
fi

echo "Final AppImage:"
ls -lh "$EXPECTED_APPIMAGE"
echo "AppImage path: $ROOT_DIR/$EXPECTED_APPIMAGE"
build_succeeded=1
