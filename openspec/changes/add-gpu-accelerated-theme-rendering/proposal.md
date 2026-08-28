## Why

Plethora renders its ~40 animated themes entirely through JavaScript-driven Canvas2D
inside `ThemeBackdrop.tsx` (a 1.5k-line component that owns both lifecycle and every
animation implementation). Full-screen procedural effects — `plasma` computes 4 `sin`
calls per pixel through `ImageData` on the CPU every frame — burn main-thread time even
on healthy GPUs. On Linux the situation is worse than necessary: while
`src-tauri/src/main.rs` conditionally disables WebKitGTK GPU features only for software
rasterizers, the dev wrapper (`scripts/tauri-wrapper.sh`) still unconditionally exports
`WEBKIT_DISABLE_DMABUF_RENDERER=1`, `WEBKIT_DISABLE_COMPOSITING_MODE=1`,
`WEBKIT_DISABLE_HARDWARE_ACCELERATION=1` and `LIBGL_ALWAYS_SOFTWARE=1` before Rust
starts, defeating the conditional policy for every development session. (The old
`src-tauri/AppRun` and `src-tauri/dev-wrapper.sh` did the same but are dead code —
neither is installed by packaging nor referenced anywhere.)

Archaeology shows the blanket disable predates the discovery that YouTube failures were
actually caused by missing GStreamer H.264 codecs (fixed by `bundleMediaFramework`) and
WebKitGTK sandbox/CORS issues — not by hardware acceleration. YouTube playback requires
the sandbox disable and codec bundling, both of which are preserved. Real GPUs (Mesa
AMD/Intel, NVIDIA) render fine with acceleration on.

## What Changes

- **One authoritative Linux graphics policy** (`src-tauri/src/graphics.rs`) applied in
  `main()` before WebKit initializes: `PLETHORA_GPU_MODE=auto|hardware|software`
  (default `auto`). `auto` probes `glxinfo -B`, falls back to scanning
  `/sys/class/drm` when `glxinfo` is absent, keeps the llvmpipe/softpipe/swrast
  compatibility fallback, disables only the DMABUF renderer on NVIDIA+X11, and logs one
  `[graphics] backend=… reason=…` diagnostic line. The dev wrapper stops blanket-disabling
  acceleration; dead wrappers are removed; regression tests pin the policy.
- **A framework-independent renderer abstraction**
  (`src/components/common/ambient/renderer/`): `ThemeBackdrop` becomes a thin React
  lifecycle owner; effect definitions, backends, quality policy, frame scheduling and
  diagnostics move to plain TypeScript modules.
- **A WebGL2 backend** (direct WebGL2, no new dependencies) for fullscreen procedural
  effects, with shader-compile-failure → Canvas2D → static fallback, context-loss
  handling, bounded backing-buffer resolution, and render-scale support.
- **Theme migrations to WebGL2**: `plasma`, `aurora`, `nebula`, `oceanwaves`,
  `northern`, `underwater`, `sunbeams`, `synthsun`, `lavalamp`, `cosmicdust`, `bioglow`,
  `starwarp`, and `jellyfish` (palette-driven). Their Canvas2D implementations remain
  as the fallback. Particle-shaped effects (rain, snowfall, confetti, …) intentionally
  stay Canvas2D.
- **Adaptive quality policy**: tiered fps/render-scale/density for desktop-AC,
  desktop-battery, mobile and mobile-battery; static (no RAF) for reduced-motion and
  disabled animations; sustained frame-time overshoot degrades WebGL quality instead of
  stuttering.
- **Local-only diagnostics** (`window.__plethoraAmbientDiagnostics` in dev or with an
  opt-in flag): backend, target/actual fps, frame-time percentiles, render scale,
  density, battery/visibility/reduced-motion state, WebGL2 availability. No telemetry.
- Benchmarks for representative effect frame costs and policy hot paths, with
  `scripts/perf-baselines.json` entries.

## Capabilities

### New Capabilities

- `gpu-theme-rendering`: renderer abstraction, WebGL2 backend, fallback chain, quality
  tiers, context-loss handling, background suspension, diagnostics.
- `linux-graphics-policy`: single authoritative GPU policy with detection cascade,
  overrides, logging, and wrapper hygiene.

### Modified Capabilities

- None archived yet cover these areas. The stale `fix-linux-youtube-playback` change's
  blanket "disable hardware acceleration" requirement is updated in that change to
  defer to `linux-graphics-policy` (sandbox disable and codec bundling unchanged).

## Impact

- **Frontend:** `ThemeBackdrop.tsx` (rewritten as thin owner), new
  `ambient/renderer/**` modules, `ambient/jellyfishRenderer.ts` (unchanged API, reused
  as Canvas2D fallback).
- **Rust:** `src-tauri/src/graphics.rs` (new), `main.rs` (delegates to policy),
  `scripts/tauri-wrapper.sh` (stops blanket-disabling), removal of dead
  `src-tauri/AppRun` and `src-tauri/dev-wrapper.sh`.
- **Tests:** renderer selection/fallback/lifecycle tests, shader contract tests,
  Rust policy unit tests, wrapper regression tests, new benchmarks + baselines.
- **Dependencies:** none.
- **Risk:** WebKitGTK/NVIDIA white-screen regressions (mitigated: compat fallback,
  NVIDIA DMABUF-only disable, `PLETHORA_GPU_MODE` override); mobile thermal regression
  (mitigated: mobile quality tier, animations still default off on native mobile);
  visual drift in migrated themes (mitigated: shaders mirror Canvas2D palettes,
  Canvas2D fallback retained per effect).
