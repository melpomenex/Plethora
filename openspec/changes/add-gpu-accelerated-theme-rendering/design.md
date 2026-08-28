# Design — GPU-accelerated animated theme rendering

## Context

`ThemeBackdrop.tsx` today: a 39-entry `_ANIM` map of inline Canvas2D renderers, a 30 FPS
`shouldRender` gate, window-resize listener, interval registry, visibility/focus/suspend
gates, battery density halving, CSS-filter brightness, and a jellyfish special case for
static frames. The canvas backing store is CSS-pixel sized (1×, no devicePixelRatio).
Only `jellyfish` implements `staticOnly`/`onResize`; `liquid-glow` themes intentionally
have no canvas renderer (pure CSS animation).

Linux today: `main.rs` sets `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1` unconditionally
(YouTube iframe requirement) and conditionally disables DMABUF/compositing/HW-accel only
when `glxinfo -B` reports llvmpipe/softpipe/swrast — but defaults to "disable" whenever
`glxinfo` is missing (most end-user distros lack `mesa-utils`), and the dev wrapper
disables everything unconditionally before Rust runs.

## Goals

1. Hardware acceleration enabled by default on healthy Linux GPUs; compatibility
   fallback for software rasterizers and known-bad configurations; explicit override.
2. A clean renderer architecture: React owns lifecycle; rendering is framework-free.
3. WebGL2 GPU path for fullscreen procedural effects; Canvas2D stays the fallback.
4. Tiered quality (desktop-AC / desktop-battery / mobile / mobile-battery / static).
5. Bounded backing buffers, context-loss resilience, no RAF/timer/listener leaks.
6. Cross-platform: Linux (WebKitGTK ≥ 2.40), Windows (WebView2), macOS/iOS (WKWebView),
   Android (system WebView).

## Renderer abstraction

```
ThemeBackdrop.tsx            (React: state, effects, guards, DOM host)
  └─ createBackdropRenderer(host, inputs, hooks)   (factory / controller)
       ├─ WebGLThemeRenderer      (preferred when effect has a webgl2 impl
       │                          and getContext("webgl2") succeeds)
       ├─ Canvas2DThemeRenderer   (compat / fallback; hosts legacy AnimFns)
       └─ static path             (single frame, no RAF)
```

- `ambient/renderer/types.ts` — `ThemeRenderer` interface (`start`, `resize`,
  `updateInputs`, `dispose`, `backend`), `RendererInputs` (effectId, paletteId,
  density, brightness, environment), `FrameBudget` (fps, renderScale, densityScale),
  legacy `AnimCtx`/`AnimFn` moved here unchanged.
- `ambient/renderer/effects.ts` — `EFFECT_REGISTRY: Record<string, EffectDefinition>`
  with `{ id, canvas2d?, webgl?, supportsStatic, rendererPreference }`. Lookup keeps the
  exact-then-prefix match from `_ANIM` so `liquid-glow` continues to resolve to
  "no renderer, CSS handles it".
- `ambient/renderer/qualityPolicy.ts` — pure `resolveQuality(env, backend)` →
  `FrameBudget`; pure `nextAdaptiveStep(budget, metrics)` for degradation.
- `ambient/renderer/frameScheduler.ts` — timestamp-paced rAF loop with per-frame cost
  measurement; single pending handle; `stop()` cancels; never schedules while stopped.
- `ambient/renderer/diagnostics.ts` — ring buffer of frame costs + latest state;
  exposed as `window.__plethoraAmbientDiagnostics` only in dev builds or when
  `localStorage["plethora.ambientDiagnostics"] === "1"`.
- `ambient/renderer/createThemeRenderer.ts` — feature detection, backend selection,
  fatal-fallback swapping (WebGL2 renderer reports unrecoverable state → controller
  replaces it with a Canvas2D renderer for the same effect).

### Lifecycle contract

React effect deps (same as today): `[animation, ambientPaletteId, density, suspended,
isVisible, effectiveDensity, animationsEnabled, prefersReducedMotion]`. On change:
dispose old controller (cancels rAF, clears intervals, removes listeners, removes
`.anim-flash` nodes, deletes GL resources, removes its canvas element) then create a new
one. Each renderer creates and owns its `<canvas class="theme-backdrop-canvas">` inside
the host div — required because a canvas that ever returned a `"2d"` context can never
return `"webgl2"` (context type-lock), so the WebGL→Canvas2D swap must replace the
element. The brightness CSS filter continues to be applied to the canvas element by the
renderer, so no per-draw brightness work is needed.

### Canvas2D backend

`canvas2d/Canvas2DThemeRenderer.ts` reproduces today's hosting exactly: gets
`getContext("2d")`, sizes to `window.innerWidth/innerHeight`, registers window resize,
provides `timer`/`frame`/`shouldRender` (30 FPS)/`onResize` to the legacy `AnimFn`s now
living in `canvas2d/legacyEffects.ts` (moved verbatim from `_ANIM`), including the
jellyfish delegation. Static mode keeps today's semantics: only effects with
`supportsStatic` (jellyfish) render a single frame; others produce no canvas, exactly as
the current guards do.

### WebGL2 backend

`webgl2/WebGLThemeRenderer.ts`:

- Context attributes: `{ alpha: false, antialias: false, depth: false, stencil: false,
  preserveDrawingBuffer: false, powerPreference: "default" }` — no discrete-GPU wake,
  no MSAA on a soft ambient surface.
- One fullscreen triangle (`gl.TRIANGLES`, 3 vertices), no per-frame buffer updates.
- Programs compiled once per effect; uniform locations cached at init; per-frame work is
  a handful of `uniform1f/2f/3fv` calls plus one draw call.
- Standard uniforms for every effect shader: `uTime` (seconds), `uResolution` (backing
  px), `uDensity`, `uAspect`, `uPalette[4]` (vec3). Effects may declare extra uniforms
  via an optional `setup` hook returning a per-frame update function. All numeric inputs
  are validated (finite, clamped) before reaching uniforms.
- Backing store: `cssSize × min(devicePixelRatio, dprCap) × renderScale`, with hard
  caps (max 4096 px per axis, max ~5.3M px ≈ 2560×1440×1.44) so a 3× phone or 5K
  desktop can never allocate an absurd buffer. CSS size stays 100%; the compositor
  upscales.
- Context loss: `webglcontextlost` → `preventDefault()`, stop the scheduler, mark
  context dead. `webglcontextrestored` → re-create all GL resources and resume. If the
  renderer observes ≥3 losses (or a loss followed by failed re-init), it reports fatal →
  the controller swaps to Canvas2D. Restores never loop.
- Shader compile/link failures throw a typed `ShaderInitError` during construction; the
  factory catches it and returns the Canvas2D renderer instead. A background must never
  block the app.
- Effects are pure data modules in `webgl2/glsl/` — full fragment-shader source plus
  default palette. Shared GLSL helpers (hash, value/simplex noise, rotation, palette
  mix, glow) live in `glsl/common.ts` as string constants.

### Adaptive quality

`qualityPolicy.ts` tiers (fps / renderScale / densityScale):

| Tier | WebGL2 | Canvas2D |
|---|---|---|
| desktop, AC | 60 / 1.0 / 1.0 | 30 / 1.0 / 1.0 |
| desktop, battery | 30 / 0.75 / 0.75 | 30 / 1.0 / 0.5 (today's behavior) |
| mobile, AC | 24 / 0.6 / 0.6 | 30 / 1.0 / 0.75 |
| mobile, battery | 15 / 0.5 / 0.4 | 30 / 1.0 / 0.4 |
| static (reduced-motion / disabled) | one frame, no RAF | one frame (supportsStatic only) |

DPR cap: 2.0 desktop, 2.0 mobile (before renderScale). `nextAdaptiveStep` watches a
rolling window of frame costs measured by the scheduler: sustained overshoot
(median cost > 1.5× the frame budget for ~2 s) steps down
fps 60→30→20→15 then renderScale 1.0→0.85→0.7→0.5, one step at a time with a cooldown;
it never steps below the mobile-battery floor. Degradation is recorded in diagnostics.
Sustained *headroom* never auto-upgrades (avoids oscillation); resuming from hidden
re-evaluates from the policy tier.

### Frame scheduling

`frameScheduler.ts` keeps the accumulator-free gate proven in production today
(`elapsed >= interval` with remainder carry), but centralizes it: one pending rAF id,
timestamp-driven, `stop()` idempotent, restart-safe. Static mode draws once and never
schedules. All platforms stop rAF in hidden windows (engine behavior); the React
visibility/focus gates remain the authoritative suspension.

## Linux graphics policy

`src-tauri/src/graphics.rs` — pure, unit-testable decision function plus an `init()`
called from `main()` (position is load-bearing: env must exist before `run()` creates
the WebKit view; unchanged from today).

Inputs: `PLETHORA_GPU_MODE` (`auto` default; `hardware` forces on; `software`/`compat`
forces off), `LIBGL_ALWAYS_SOFTWARE`, `glxinfo -B` renderer string when available,
`XDG_SESSION_TYPE`, and `/sys/class/drm` card vendor/driver scan as the no-`glxinfo`
fallback (VGEM-only or no DRI nodes ⇒ no real GPU).

Decision (`auto`):

1. `LIBGL_ALWAYS_SOFTWARE=1` → compatibility (`reason=user-forced-software-gl`).
2. glxinfo renderer contains `llvmpipe`/`softpipe`/`swrast` → compatibility
   (`software-renderer`). (Virtio/vmwgfx with a host GPU still reports the emulated GL
   string and is treated as hardware when it is not in the software list.)
3. NVIDIA renderer string **and** X11 session → hardware with
   `WEBKIT_DISABLE_DMABUF_RENDERER=1` only (`reason=nvidia-x11-dmabuf`), per
   tauri-apps/tauri#9394 / Tauri Linux graphics guidance.
4. Any other non-software glxinfo renderer (AMD, Intel, other Mesa, NVIDIA on Wayland)
   → hardware, no disabling (`reason=glxinfo-hardware`).
5. `glxinfo` unavailable → DRI scan: real card vendor present → hardware
   (`reason=dri-device-present`); otherwise compatibility (`reason=no-gpu-detected`).
   This fixes today's behavior where missing `glxinfo` silently disabled acceleration
   for every user without `mesa-utils`.

Applied env: hardware mode sets `WEBKIT_HARDWARE_ACCELERATION_POLICY=always`;
compatibility mode sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`,
`WEBKIT_DISABLE_COMPOSITING_MODE=1`, `WEBKIT_DISABLE_HARDWARE_ACCELERATION=1` (legacy
trio, kept for older WebKitGTK) and `WEBKIT_HARDWARE_ACCELERATION_POLICY=never`.
`WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1` stays **unconditional** (YouTube iframe
requirement) and the APPDIR GStreamer block is untouched.

Diagnostics: exactly one `early_log` line per start, e.g.
`[graphics] backend=hardware reason=glxinfo-hardware dmabuf=enabled`, plus one line for
explicit overrides. No spam.

Wrapper hygiene: `scripts/tauri-wrapper.sh` stops exporting the blanket disables and
`LIBGL_ALWAYS_SOFTWARE` in dev; it exports `PLETHORA_GPU_MODE="${PLETHORA_GPU_MODE:-auto}"`
and lets the same binary apply one policy for dev and packaged runs. Dead
`src-tauri/AppRun` and `src-tauri/dev-wrapper.sh` are deleted (packaging stopped
installing AppRun in `702a484c`; dev-wrapper has zero references). The
`fix-linux-youtube-playback` change's stale "always disable HW acceleration" requirement
is updated to defer to this policy. `node --test` script tests assert the wrapper can
never reintroduce unconditional disables and that `main.rs` routes through the policy
module with the sandbox disable unconditional.

## Platform notes

- **Windows/WebView2, macOS-WKWebView, iOS-WKWebView, Android-WebView**: WebGL2 has
  been enabled by default since Chromium 56 / Safari 15 / iOS 15 / WebKitGTK 2.40 — all
  below Plethora's floors. Feature detection (`getContext("webgl2")`) still gates
  everything; no UA sniffing.
- **iOS**: contexts are lost under memory pressure/suspension — handled by the
  context-loss path; backing-buffer caps keep canvas memory far below the ~384 MB
  WebKit canvas ceiling.
- **Linux/WebKitGTK**: WebGL2 exists on all Tauri-2 targets but may silently run on
  llvmpipe with a masked renderer string (undetectable from JS). Mitigation: the native
  graphics policy prefers compatibility mode on real software rasterizers, and the
  adaptive-quality downgrades step in if the GL path is still slow.
- **Mobile**: native mobile keeps animations default-off; when enabled, the mobile
  tiers above apply (reduced fps/resolution/density, immediate suspension on hide).
- rAF pauses in hidden/minimized webviews on every engine in the matrix — expected and
  desired; the React gates remain the authoritative suspension.

## Diagnostics

`diagnostics.ts` maintains: requested fps, measured fps, dropped/skipped frames, mean
and p95 frame cost, backend, render resolution + scale, density, battery/reduced-motion/
visibility state, WebGL2 availability, GL vendor/renderer strings when safely
obtainable (local-only; never sent anywhere; `WEBGL_debug_renderer_info` values are
recorded only into this local object). Exposed on `window` in dev or via the localStorage opt-in only.

## Rejected alternatives

- **Canvas2D-only**: keeps `plasma`-class effects on the CPU (~4 sin/px/frame); no path
  to smoother fullscreen effects; rejected as the end state though retained as fallback.
- **WebGPU**: not available on WebKitGTK/iOS Safari < 18/older Android WebView across
  the whole matrix; would require a third fallback tier for marginal gain over WebGL2
  for fullscreen fragment effects. Deferred (the abstraction leaves room).
- **Three.js / regl / glsl-framework**: multi-hundred-KB additions for what is one
  fullscreen triangle and ≤14 fragment shaders; `three` already ships for the Knowledge
  Universe graph but is deliberately not imported here (it must never enter the backdrop
  chunk). Direct WebGL2 with ~100 lines of helpers is smaller and auditable.
- **OffscreenCanvas + Worker rendering**: WebKitGTK support is incomplete; adds
  transfer/postMessage complexity; the compositor already uploads the canvas
  off-main-thread. Revisit if main-thread uniform updates ever show up in profiles.
- **Native GPU implementations per platform (Skia/Metal/Vulkan layers)**: would fork the
  effect vocabulary per OS and explode test surface; the WebView is already composited
  by the OS GPU stack.
- **Platform-specific renderer implementations** (e.g. WebGL only on Windows/macOS):
  rejects healthy Linux/NVIDIA/mobile GPUs that work fine; feature detection + fallback
  + adaptive quality covers the actual failure modes with one code path.
- **New user-facing graphics settings**: violates the "no WebGL/DMA-BUF jargon in
  Settings" requirement; quality is automatic and the existing three controls
  (enabled/frequency/brightness) remain the whole UI.

## Testing & benchmarks

- Unit tests (vitest, mock-context patterns already proven by `jellyfishRenderer.test.ts`):
  registry completeness and static flags; quality tiers; scheduler pacing/no-duplicate-
  loops; renderer selection incl. WebGL2-unavailable, shader-failure, fatal-context-loss
  → Canvas2D swap; static mode never schedules rAF; unmount cleanup; theme switching;
  shader source contracts (parses, declares standard uniforms, unique ids).
- Rust unit tests for the policy decision matrix (AMD/Intel/NVIDIA/llvmpipe/softpipe/
  swrast strings, missing glxinfo + DRI scan, overrides, sandbox always-on).
- `node --test` wrapper regression tests.
- Benchmarks (`ambientRender.bench.ts`, seeded and sink-folded per repo rules):
  canvas2d `plasma` full frame at 1920×1080 (the "before" cost that motivates the GPU
  path), `jellyfish` draw frame, quality-policy resolve, scheduler decision — with
  `scripts/perf-baselines.json` entries added from measured runs.
- WebGL end-to-end smoothness is validated interactively via the diagnostics overlay;
  jsdom cannot create real GL contexts, so GL-adjacent logic is tested through mocked
  `WebGLRenderingContext` objects (same approach the repo already uses for Canvas2D).
