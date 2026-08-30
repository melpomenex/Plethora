# Linux Build Pipeline

## Purpose

Optimize Plethora's Linux native package build pipeline for developer iteration while preserving production release quality and CI stability.

## Requirements

### Requirement: Memory-aware Cargo parallelism

The Linux Tauri build environment SHALL compute `CARGO_BUILD_JOBS` when unset using available CPU count, available RAM (~3 GB per job), and a cap of 8 for local builds or 4 for CI.

The environment SHALL respect a caller-provided `CARGO_BUILD_JOBS` without overwriting it.

The environment SHALL override `CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1` to `4` to prevent single-module OOM, but SHALL NOT override other codegen-units values.

### Requirement: Production vs fast package profiles

The repository SHALL provide `npm run tauri:build:linux:deb` as the production release-quality `.deb` build using the `release` Cargo profile.

The repository SHALL provide `npm run tauri:build:linux:deb:fast` as a fast local `.deb` build using the `package-fast` Cargo profile (no LTO, higher codegen units).

Fast and production commands SHALL print distinct banners so users cannot confuse them.

Official CI release workflows SHALL NOT use the `package-fast` profile.

### Requirement: Frontend build efficiency

`npm run build` SHALL produce a correct frontend with help index built exactly once.

Tauri `beforeBuildCommand` SHALL produce a correct Tauri-target frontend without deleting Vite dependency caches unless the build target changes or deep clean is requested.

### Requirement: Optional build accelerators

When `sccache` is installed and not disabled, Linux Rust builds SHALL set `RUSTC_WRAPPER=sccache`.

When `mold` is installed and not disabled, Linux x86_64/aarch64 GNU builds SHALL use mold via `RUSTFLAGS` with GNU ld fallback.

### Requirement: Compile/bundle split

The repository SHALL provide commands to compile without bundling and to bundle an existing binary, with a freshness stamp preventing accidental stale packaging by default.

### Requirement: Build timing visibility

The repository SHALL provide a profiling command that reports per-phase timings for Linux package builds.

### Requirement: Production package integrity

Linux `.deb` packages SHALL continue to include all runtime resources, sidecars, shared libraries, and Debian dependencies defined in `tauri.conf.json` and `tauri.linux.conf.json`.
