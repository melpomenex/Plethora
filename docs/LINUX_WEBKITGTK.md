# Linux (WebKitGTK) Known Limitations

> **Memory behavior:** for how Incrementum's runtime memory is structured, how
> the memory benchmark measures it, and the baselines/thresholds that guard
> it, see [docs/memory-profile.md](memory-profile.md). The memory benchmark
> requires WebKitGTK 4.1 and a display (or Xvfb).

The Linux AppImage uses WebKitGTK as its web engine. While WebKitGTK works well for most app functionality, it has some known limitations compared to the macOS (WKWebView) and Windows (WebView2/Chromium) builds.

## YouTube Playback Performance

YouTube videos are embedded via an iframe using `react-youtube`. On macOS and Windows, the native webview engines handle cross-origin iframe compositing efficiently. WebKitGTK struggles with this — when a YouTube video is playing, the **entire app UI may become sluggish**.

This is a WebKitGTK limitation, not an app bug. There is no fix within the app code.

### Mitigations

- **Use the web version** on browsers that use Chromium/Blink (Chrome, Firefox, Edge) for the best YouTube experience
- **Try X11 instead of Wayland** — WebKitGTK compositing is sometimes smoother on X11
- **Environment variables** (may or may not help depending on your system):
  - `WEBKIT_HARDWARE_ACCELERATION_POLICY=always` — force GPU compositing
  - `WEBKIT_DISABLE_COMPOSITING_MODE=1` — force software rendering (can go either way)

## Missing Media Codecs

Some WebKitGTK builds (especially minimal/distro-specific ones) lack H.264/MP4 codecs. The app detects this at startup and shows a warning if inline video playback is likely unsupported.

### Fix

Install GStreamer plugins with H.264 support:

```bash
# Arch / Omarchy
sudo pacman -S gst-plugins-good gst-plugins-bad gst-plugins-ugly gst-libav

# Ubuntu / Debian
sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-libav

# Fedora
sudo dnf install gstreamer1-plugins-good gstreamer1-plugins-bad-free gstreamer1-plugins-ugly-free gstreamer1-libav
```

## YouTube Embed Host Fallback

YouTube's privacy-enhanced embed domain (`youtube-nocookie.com`) is blocked by WebKitGTK's CORS policy for internal requests made by the embed. The app detects Linux and automatically falls back to `youtube.com` for embeds. If you see "Your browser can't play this video" errors, this fallback may not have triggered — check the console for `[YouTubeViewer]` warnings.

## Graphics Acceleration Policy

GPU acceleration is configured by a single authoritative policy applied at
startup (`src-tauri/src/graphics.rs`), before the WebKit view is created. The
same policy runs in packaged builds (AppImage/deb/rpm) and in `npm run tauri
dev` — the dev wrapper no longer disables acceleration on its own.

### How the policy decides

1. `PLETHORA_GPU_MODE` override (see below) wins over everything.
2. If `LIBGL_ALWAYS_SOFTWARE=1` is set, compatibility mode is used.
3. If `glxinfo -B` reports a software rasterizer (`llvmpipe`, `softpipe`,
   `swrast`), compatibility mode is used.
4. If the renderer is NVIDIA **and** the session is X11, hardware stays on but
   the DMABUF renderer is disabled (the WebKitGTK/NVIDIA DMABUF white-screen
   class of bugs).
5. Otherwise — including when `glxinfo` is not installed — hardware
   acceleration stays enabled. Without `glxinfo`, the policy scans
   `/sys/class/drm` for a real GPU device and only falls back to software when
   none is found.

### Overrides

```bash
PLETHORA_GPU_MODE=auto      # default — the detection cascade above
PLETHORA_GPU_MODE=hardware  # never disable acceleration
PLETHORA_GPU_MODE=software  # always use the compatibility fallback
```

### Diagnostics

Each startup appends exactly one decision line to the early startup log
(`$TMPDIR/plethora-startup.log`), e.g.:

```
[graphics] backend=hardware reason=glxinfo-hardware dmabuf=enabled
[graphics] backend=compatibility reason=software-renderer dmabuf=disabled
```

Common reasons: `glxinfo-hardware`, `dri-device-present` (no `glxinfo`
installed but a GPU device node exists), `software-renderer`,
`nvidia-x11-dmabuf`, `no-gpu-detected`, `gpu-detection-unavailable`, `user-forced-software-gl`,
`override-hardware`, `override-software`.

The sandbox disable (`WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1`, required for
YouTube iframe playback) and the bundled GStreamer codec setup are independent
of the graphics policy and always applied on Linux.
