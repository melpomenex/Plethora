## 1. Linux graphics policy

- [x] 1.1 Create `src-tauri/src/graphics.rs`: pure decision function (PLETHORA_GPU_MODE, LIBGL_ALWAYS_SOFTWARE, glxinfo renderer classification, NVIDIA+X11 DMABUF-only case, `/sys/class/drm` fallback) + `init()` applying env and logging one `[graphics]` line
- [x] 1.2 Route `main.rs` Linux env setup through the policy module; keep sandbox disable and APPDIR GStreamer block unchanged
- [x] 1.3 Update `scripts/tauri-wrapper.sh`: drop blanket WEBKIT disables + `LIBGL_ALWAYS_SOFTWARE`, export `PLETHORA_GPU_MODE` default `auto`
- [x] 1.4 Delete dead `src-tauri/AppRun` and `src-tauri/dev-wrapper.sh`
- [x] 1.5 Update the stale `fix-linux-youtube-playback` spec delta to defer GPU policy to this change (sandbox/codec requirements unchanged)
- [x] 1.6 Rust unit tests: renderer-string matrix (AMD/Intel/NVIDIA/llvmpipe/softpipe/swrast), missing-glxinfo DRI fallback, overrides, sandbox always set
- [x] 1.7 `scripts/__tests__/graphicsPolicy.test.mjs`: wrapper never unconditionally disables; main.rs routes through policy; sandbox unconditional

## 2. Renderer abstraction

- [x] 2.1 Create `ambient/renderer/types.ts` (ThemeRenderer, RendererInputs, FrameBudget, AnimCtx/AnimFn moved from ThemeBackdrop)
- [x] 2.2 Move the 39 `_ANIM` entries verbatim to `ambient/renderer/canvas2d/legacyEffects.ts`; jellyfish keeps delegating to `runJellyfishAnimation`
- [x] 2.3 Create `ambient/renderer/effects.ts` registry with exact+prefix lookup, supportsStatic flags, renderer preferences
- [x] 2.4 Create `ambient/renderer/frameScheduler.ts` (timestamp pacing, single pending handle, frame-cost metrics)
- [x] 2.5 Create `ambient/renderer/qualityPolicy.ts` (tier table, adaptive step-down)
- [x] 2.6 Create `ambient/renderer/diagnostics.ts` (local-only snapshot, dev/opt-in window exposure)
- [x] 2.7 Create `ambient/renderer/canvas2d/Canvas2DThemeRenderer.ts` reproducing today's hosting (30 fps, resize, timers, anim-flash cleanup, static path)
- [x] 2.8 Create `ambient/renderer/createThemeRenderer.ts` controller (feature detection, backend choice, fatal fallback swap)
- [x] 2.9 Rewrite `ThemeBackdrop.tsx` as a thin React owner with the same guards, DOM classes, CSS-filter brightness, and effect dependency list

## 3. WebGL2 backend

- [x] 3.1 `webgl2/shaderUtils.ts`: compile/link with typed `ShaderInitError`, cached uniform locations
- [x] 3.2 `webgl2/WebGLThemeRenderer.ts`: context attrs, fullscreen triangle, standard uniforms, render-scale backing store with hard caps, validation of numeric inputs, context-loss handling with bounded retries and fatal reporting
- [x] 3.3 `webgl2/glsl/common.ts`: shared GLSL helpers (hash, noise, palette mix, glow, rotation)
- [x] 3.4 Effect shaders: plasma, aurora, nebula, oceanwaves, northern, underwater, sunbeams, synthsun, lavalamp, cosmicdust, bioglow, starwarp
- [x] 3.5 Jellyfish WebGL shader driven by `resolveJellyfishPalette` (12-color palette mapping), preserving visual identity; Canvas2D jellyfish stays the fallback and static path
- [x] 3.6 Register migrated effects in `EFFECT_REGISTRY` with webgl implementations

## 4. Tests

- [x] 4.1 Registry completeness: all legacy ids present, liquid-glow unresolved, static flags correct
- [x] 4.2 Quality policy tiers and adaptive step-down boundaries
- [x] 4.3 Frame scheduler: pacing, no duplicate loops, idempotent stop
- [x] 4.4 Renderer selection: WebGL2 ok / null / shader failure / fatal context loss → Canvas2D swap; static never schedules RAF
- [x] 4.5 WebGL shader source contracts (standard uniforms declared, ids unique, parse-sane)
- [x] 4.6 ThemeBackdrop guards and unmount cleanup (mocked canvas contexts)
- [x] 4.7 Existing jellyfish/theme tests keep passing unchanged

## 5. Benchmarks and gates

- [x] 5.1 `ambient/ambientRender.bench.ts`: canvas2d plasma frame @1920×1080, jellyfish draw frame, quality resolve, scheduler decision (seeded, sink-folded)
- [x] 5.2 Record baselines into `scripts/perf-baselines.json` from a real run
- [x] 5.3 `npm run bench:check` passes

## 6. Verification

- [x] 6.1 `npx tsc --noEmit` clean
- [x] 6.2 `npm run test:run` passes (no regressions vs pre-existing failures)
- [x] 6.3 `cd src-tauri && cargo test` policy tests pass; `cargo check` clean
- [x] 6.4 `npm run test:scripts` passes
- [x] 6.5 `npm run lint` clean for touched files
- [x] 6.6 Frontend build succeeds (`npm run build` / bundle budget check)
- [x] 6.7 `openspec validate add-gpu-accelerated-theme-rendering` passes

## 7. Review

- [x] 7.1 Adversarial review pass over the full diff; fix all credible findings
- [x] 7.2 Document benchmark findings and remaining limitations in the final report
