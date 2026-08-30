## Context

Plethora is a large Tauri v2 app. Linux release builds source `scripts/tauri-linux-build-env.sh` from `scripts/tauri-wrapper.sh`, which currently exports `CARGO_BUILD_JOBS=1` and `CARGO_PROFILE_RELEASE_CODEGEN_UNITS=4`. This overrides `src-tauri/.cargo/config.toml` (`jobs = 16`), serializing the dependency graph. CI workflows duplicate the same `CARGO_BUILD_JOBS=1` override.

The frontend chain for `tauri build` runs `beforeBuildCommand` → `build:tauri` → `clean-frontend-artifacts.sh` (wipes `dist/`, `node_modules/.vite/`, `.eslintcache`) → `npm run build` → `prebuild` (sidecars + help-index) → `build` (help-index again + vite).

Production `[profile.release]` uses `opt-level = "z"`, `lto = "thin"`, `codegen-units = 4` — appropriate for releases, expensive for local package smoke tests.

Prior OOM incidents on a 24-thread / ~24 GB Linux machine motivate conservative defaults, not unbounded parallelism.

## Goals / Non-Goals

**Goals:**
- Restore meaningful local Linux parallelism without reintroducing OOM instability.
- Provide a clearly labeled fast local `.deb` path that skips LTO and uses higher codegen units.
- Preserve production release artifacts and CI release semantics.
- Respect explicit `CARGO_BUILD_JOBS` from callers.
- Optional `sccache` / `mold` with zero install requirement.
- Observable build phases via a lightweight timing script.
- Split compile and bundle for faster packaging iteration.

**Non-Goals:**
- Reintroduce `rust-lld` (previously crashed).
- Mandate `sccache` or `mold`.
- Change macOS, Windows, Android, or iOS build behavior.
- Disable thin LTO globally for production releases.

## Decisions

### Decision 1: Memory-aware Cargo job policy (`scripts/tauri-linux-build-env.sh`)

**Choice:** Compute default jobs only when `CARGO_BUILD_JOBS` is unset:

```
jobs = min(ncpu, floor(mem_gb / 3), cap)
cap = 4 in CI (GITHUB_ACTIONS or CI=true), else 8 locally
floor at 1
```

**Rationale:** ~3 GB per `rustc` job is a conservative heuristic for this codebase. CI Ubuntu runners have 7 GB RAM → cap 4 is safe. Local 24 GB / 24 threads → 8 jobs uses cores without matching thread count.

**Codegen guard:** If caller sets `CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1`, override to `4` only (existing OOM guard). Do not override other values.

**Source of truth:** `.cargo/config.toml` `jobs = 16` remains the Cargo.toml fallback when env is unset and script is not sourced (e.g. raw `cargo` invocations). The Linux Tauri wrapper script sets env explicitly for memory safety.

### Decision 2: `package-fast` profile

```toml
[profile.package-fast]
inherits = "release"
lto = false
codegen-units = 16
opt-level = 2
strip = true

[profile.package-fast.package."*"]
opt-level = 2
```

Fast builds pass `tauri build -- --profile package-fast`. Production uses default `release` profile only.

### Decision 3: Frontend duplicate work and caching

- Remove redundant `build-help-index.mjs` from the `build` script (`prebuild` already runs it for `npm run build`).
- `clean-frontend-artifacts.sh` default: remove `dist/` only when `dist/plethora-build-metadata.json` target mismatches expected (`tauri` for native builds).
- `clean:frontend:deep`: also remove `node_modules/.vite/` and `.eslintcache`.

### Decision 4: Optional accelerators (`scripts/linux-build-accelerators.sh`)

- `sccache`: set `RUSTC_WRAPPER=sccache` when binary exists and `PLETHORA_DISABLE_SCCACHE` unset.
- `mold`: append `-C link-arg=-fuse-ld=mold` to `RUSTFLAGS` when `mold` exists and `PLETHORA_DISABLE_MOLD` unset.
- Never set for cross-compilation targets where mold may not apply.

### Decision 5: Linux package entry script (`scripts/tauri-linux-package.sh`)

Unified entry with modes:
| Mode | Behavior |
|------|----------|
| `release` | Production profile, bundle deb, banner |
| `fast` | `package-fast` profile, bundle deb, FAST banner |
| `binary` | `--no-bundle`, write freshness stamp |
| `bundle` | `tauri bundle` after stamp check |
| `profile` | Like release but emit timing report |

Freshness stamp: `.cache/linux-binary-stamp` = `git-head + profile + lock hash`.

### Decision 6: CI parallelism

Replace `CARGO_BUILD_JOBS: 1` with explicit values tuned for GitHub-hosted runner RAM (~7 GB):

- `linux-x86_64`: `2` (floor(mem/3) on 7 GB runners)
- `linux-aarch64`: `3` (ubuntu-24.04-arm; still bounded by codegen-units=4 + thin LTO)

Keep `CARGO_PROFILE_RELEASE_CODEGEN_UNITS: 4`. CI does not use `package-fast`.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| OOM with higher job count | Mem heuristic + caps; CI uses 2–4 |
| Fast profile shipped by mistake | Loud console banners; fast only via `:fast` script |
| Stale binary in bundle-only mode | Stamp check; `--allow-stale` escape hatch |
| mold incompatibility | Optional, off by default path, env disable |
| sccache stale artifacts | Document `sccache --zero-stats`; not used in reproducible release signing |

## Rollback

Revert `tauri-linux-build-env.sh` to export `CARGO_BUILD_JOBS=1` and remove new npm scripts. No schema migrations.

## Acceptance Criteria

- Local `npm run tauri:build:linux:deb` prints PRODUCTION banner and uses release profile.
- `npm run tauri:build:linux:deb:fast` prints FAST banner and uses `package-fast`.
- `CARGO_BUILD_JOBS=2 npm run tauri:build:linux:deb` uses 2 jobs.
- Help index runs once per Tauri build.
- Vite cache survives consecutive Tauri builds with same target.
- `sccache` / `mold` skipped when absent.
- CI Linux jobs use 4 (x86_64) and 2 (aarch64).
- Produced `.deb` contains sidecars, `.so` files, and deb dependencies unchanged.
