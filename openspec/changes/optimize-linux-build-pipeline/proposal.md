## Why

Local Linux `.deb` builds routinely exceed 30 minutes because the repository forces `CARGO_BUILD_JOBS=1` (contradicting `.cargo/config.toml`), repeats frontend preprocessing, deletes Vite caches every Tauri build, and always pays full release LTO cost even for package-testing iteration. CI shares the single-job override for OOM safety but has no separate fast path for developers.

## What Changes

- Replace the hard-coded `CARGO_BUILD_JOBS=1` Linux override with a memory-aware parallelism policy that respects caller overrides and distinguishes local vs CI defaults.
- Add a `package-fast` Cargo profile and explicit **FAST LOCAL PACKAGE** vs **PRODUCTION RELEASE PACKAGE** npm commands.
- Eliminate duplicate `build-help-index.mjs` execution in the Tauri frontend build chain.
- Refactor frontend cleaning: preserve Vite and ESLint caches by default; add an explicit deep-clean command.
- Add optional `sccache` and `mold` acceleration with graceful fallback when not installed.
- Add Linux build timing instrumentation and split compile/bundle workflows (`--no-bundle`, `tauri bundle`).
- Keep production release optimization (thin LTO, production codegen) unchanged for official release workflows.
- Document build commands, parallelism policy, and optional accelerators in `docs/INSTALL.md`.

## Capabilities

### New Capabilities
- `linux-build-pipeline`: Memory-aware Cargo parallelism, fast vs production Linux package profiles, optional compiler/linker acceleration, frontend cache policy, build timing, and compile/bundle split workflows for Linux `.deb` iteration.

### Modified Capabilities
<!-- No existing OpenSpec capability governs build infrastructure. -->

## Impact

- `scripts/tauri-linux-build-env.sh`, `scripts/tauri-wrapper.sh`, new `scripts/linux-build-accelerators.sh`, `scripts/tauri-linux-package.sh`, `scripts/linux-build-profile.sh`, `scripts/clean-frontend-artifacts.sh`
- `package.json` npm scripts
- `src-tauri/Cargo.toml` (`[profile.package-fast]`)
- `src-tauri/.cargo/config.toml` (linker comments; optional mold via env)
- `.github/workflows/build.yml`, `.github/workflows/release.yml` (explicit CI job counts)
- `scripts/__tests__/tauriLinuxBuildEnv.test.mjs`, new script tests
- `docs/INSTALL.md`
