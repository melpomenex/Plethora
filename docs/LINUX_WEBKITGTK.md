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

1. `PLETHORA_GPU_MODE=software` selects the compatibility fallback. `hardware`
   keeps hardware acceleration enabled while still allowing a narrowly
   detected NVIDIA/Wayland synchronization setting. `auto` uses detection.
2. In auto mode, `LIBGL_ALWAYS_SOFTWARE=1` or a software renderer
   (`llvmpipe`, `softpipe`, `swrast`) selects compatibility mode.
3. With NVIDIA and WebKitGTK before 2.54 (or an unavailable runtime version),
   the policy sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`, retaining hardware
   acceleration and compositing.
4. With NVIDIA, WebKitGTK 2.54 or newer, and an observable native Wayland
   backend, DMA-BUF stays enabled and the policy sets
   `__NV_DISABLE_EXPLICIT_SYNC=1` unless the environment already supplied a
   value. This targets the Wayland protocol-error report without applying a
   Wayland-only setting to X11.
5. With modern WebKitGTK on X11 or an unknown display backend, the policy keeps
   DMA-BUF and does not set the NVIDIA explicit-sync variable. AMD, Intel, and
   other hardware renderers keep acceleration enabled. If `glxinfo` is
   unavailable, the policy checks the NVIDIA kernel module and then DRM device
   nodes.

The WebKitGTK 2.54 source path for `WEBKIT_DISABLE_DMABUF_RENDERER=1` returns
before installing the shared-memory renderer transport; the separate
`WEBKIT_DMABUF_RENDERER_FORCE_SHM=1` option keeps accelerated backing-store
support while avoiding the hardware DMA-BUF transport. Plethora does not set
that option without target evidence. Tauri's current Linux guidance documents
`__NV_DISABLE_EXPLICIT_SYNC=1` for NVIDIA Wayland protocol errors.

The main Tauri window remains transparent. This change does not assume
transparency caused the reported stale paints; compare target rendering before
considering a Linux-only opaque native surface.

### Overrides

```bash
PLETHORA_GPU_MODE=auto      # default — the detection cascade above
PLETHORA_GPU_MODE=hardware  # never disable acceleration
PLETHORA_GPU_MODE=software  # always use the compatibility fallback
```

### Diagnostics

Each startup appends one concise decision line to
`/tmp/plethora-startup.log`. Values describe environment configuration, not a
driver/compositor handshake, for example:

```
[graphics] requested=auto effective=hardware reason=nvidia-wayland-explicit-sync display=wayland webkit=2.54 renderer="NVIDIA ..." dmabuf-env=unset:unset explicit-sync-env=1:policy acceleration-policy=ondemand:policy
```

`glxinfo-hardware`, `dri-device-present`, `software-renderer`,
`nvidia-legacy-dmabuf-off`, `nvidia-wayland-explicit-sync`,
`nvidia-modern-no-sync-policy`, `no-gpu-detected`,
`gpu-detection-unavailable`, `user-forced-software-gl`, `override-hardware`,
and `override-software`. Each relevant variable is marked `inherited`, `policy`,
or `unset`. Set `PLETHORA_LINUX_DIAGNOSTICS=1` to append the full set of
WebKitGTK/NVIDIA environment values.

The sandbox disable (`WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1`, required for
YouTube iframe playback) and the bundled GStreamer codec setup are independent
of the graphics policy and always applied on Linux.
