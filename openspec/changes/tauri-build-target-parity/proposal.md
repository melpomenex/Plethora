## Why

Plethora's Vite configuration classifies Tauri builds using legacy `TAURI_PLATFORM` / `TAURI_ARCH` / `TAURI_FAMILY` environment variables and explicit `PLETHORA_TAURI=1` (set only for `tauri dev` via the wrapper). Tauri 2 production hooks supply `TAURI_ENV_*` variables instead. When production builds are not recognized as Tauri, `isPWA` becomes true under `mode === "production"`, causing PWA-oriented bundling (Tauri plugin externals, code-splitting policy) in packaged desktop apps. Development and production Tauri builds can therefore diverge in application architecture.

## What Changes

- Introduce a single authoritative `FrontendRuntimeTarget` contract (`tauri` | `pwa` | `web`) separate from `BuildProfile` (`development` | `sideload` | `store`).
- Detect Tauri 2 hook environments via `TAURI_ENV_PLATFORM`, `TAURI_ENV_ARCH`, `TAURI_ENV_FAMILY`, `TAURI_ENV_TARGET_TRIPLE`, plus legacy names and `PLETHORA_TAURI`.
- Fail the build when a Tauri environment is classified as PWA, or when explicit `pwa` mode conflicts with Tauri signals.
- Inject `__PLETHORA_RUNTIME_TARGET__` and emit `dist/plethora-build-metadata.json` for post-build verification.
- Export `PLETHORA_TAURI=1` from the Tauri wrapper for `dev`, `build`, `android`, and `ios` commands.
- Expose build fingerprint diagnostics (version, git SHA, build ID, runtime target, profile) for engineer verification.

## Capabilities

### New Capabilities

- `frontend-runtime-target`: Centralized, testable classification of Vite build targets with compile-time invariants.

### Modified Capabilities

- None (build-system only).

## Impact

- `vite.config.ts`, `scripts/tauri-wrapper.sh`, `src/lib/runtimeTarget.ts`, `src/lib/buildDiagnostics.ts`, `src/vite-env.d.ts`, verification scripts and tests.
- Feature branches gated by `isPWA` / `isTauriBuild` in Vite: module preload, Rollup externals, HMR, API proxy, React fast refresh.

## Intentional Dev/Prod Differences

Development and production Tauri builds may differ in optimization, logging, HMR, debug symbols, and signing. They must not differ in runtime target classification, canonical reader inclusion, or article import architecture.
