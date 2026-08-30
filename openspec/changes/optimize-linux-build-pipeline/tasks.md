# Tasks

## 1. Cargo parallelism and profiles
- [ ] 1.1 Rewrite `scripts/tauri-linux-build-env.sh` with memory-aware job policy
- [ ] 1.2 Add `[profile.package-fast]` to `src-tauri/Cargo.toml`
- [ ] 1.3 Add `scripts/linux-build-accelerators.sh` (sccache, mold)
- [ ] 1.4 Update `scripts/__tests__/tauriLinuxBuildEnv.test.mjs`

## 2. Linux package scripts
- [ ] 2.1 Add `scripts/tauri-linux-package.sh` (release, fast, binary, bundle, profile modes)
- [ ] 2.2 Add `scripts/linux-build-profile.sh` timing helper
- [ ] 2.3 Add npm scripts to `package.json`
- [ ] 2.4 Wire `scripts/tauri-wrapper.sh` to accelerators

## 3. Frontend pipeline
- [ ] 3.1 Remove duplicate help-index from `build` script
- [ ] 3.2 Refactor `scripts/clean-frontend-artifacts.sh` (target-aware + `--deep`)
- [ ] 3.3 Add `clean:frontend:deep` npm script

## 4. CI and documentation
- [ ] 4.1 Update `.github/workflows/build.yml` and `release.yml` CI job counts
- [ ] 4.2 Update `docs/INSTALL.md` with Linux build commands and accelerators

## 5. Validation
- [ ] 5.1 Run `npm run test:scripts`
- [ ] 5.2 Run `bash -n` on modified shell scripts
- [ ] 5.3 Benchmark jobs=1 vs new policy (Linux or Docker)
- [ ] 5.4 Build and inspect `.deb` (production and fast)
- [ ] 5.5 Adversarial review of final diff
