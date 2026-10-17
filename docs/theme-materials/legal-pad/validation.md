# Legal Pad implementation evidence

Implementation baseline: `f1f598c1b7cb92efd2c79f4cd13015bea98f6792`, inspected 2026-10-17. Existing changes to extracts, settingsStore, database/Rust summary handling, CHANGELOG and progressive-summary tests are preserved. No branch or PR is created. The initial diff/status is recorded locally at `/tmp/legal-pad-initial-state.json` for separation during verification.

Ownership: this change owns optional theme material/schema, appearance snapshot, paper assets/styles, theme picker and the material adapters in HTML/EPUB/PDF/RSS/Markdown/extracts. Existing EPUB display/insertRule/readiness guards, RSS persistence/migration, assistant composition, mobile overlay geometry and extract progressive-summary behavior remain their existing owners' contracts.

All native startup, GPU resident memory, power/thermal, P3 and physical-device selection checks in the test matrix are pending until performed. Production HDR is disabled. No proposed performance threshold is a measured result.

Baseline benchmark output: `/tmp/legal-pad-baseline-bench.log` (run before application edits). Actual exit/result is recorded below when available. Native baselines are pending; existing deterministic reader fixtures and browser harnesses are reused.

## Implemented and checked locally

- Registered `legal-pad` in eager fallback and lazy catalog; static light theme with explicit warm Material roles. Import metadata is allowlisted.
- Added applied appearance context, normalized persistent preferences, bounded resource/DPR selection and decode fallback. Existing non-paper theme behavior is preserved.
- Shared source-over backgrounds on named shell, navigation, card/dialog/palette, Markdown and PDF reflow owners. No canvas filter, decorative animation loop, native graphics-policy change or original PDF rendering change was introduced.
- HTML uses the shared snapshot and existing nonce-authorized stylesheet. Expanded rich extracts update their stylesheet without iframe navigation. EPUB hooks retain install-first/insertRule/verification protections, preserve publisher styles, classify fixed-layout sections and expose Original book appearance. RSS system appearance follows app material; explicit palettes remain independent.
- The actual paper source is ambientCG Paper006, CC0, **4096×4096** native color map. Its author labels the PBR technique “Approximation”; we use only the color-map fiber structure, not generated normal/displacement maps. No calibrated physical scale or color target is supplied. It is 8-bit SDR, not a 16-bit scan or HDR asset. The 1254px generated reference and mislabeled smaller Paper001 archive are excluded from production assets.
- `scripts/build-paper-material.mjs` deterministically derives neutral alpha textures from that source at each density, avoiding an upscaled source. Lossless WebP and PNG fallback are sRGB-profiled. Source and derivative SHA-256 values are in the manifest; packaged raster payload is approximately 1.59 MB (see manifest for exact bytes). Asset tests verify dimensions, hashes, license, nonempty grain and opacity bounds.
- Secondary ink was calibrated from `#61503A` to `#51422E`, and meaningful outline/border from `#786747` to `#6D5C3E`, after conservative texture/ruling compositing calculations found weak contrast on the darkest container. See `contrast.md` for current calculations. Physical color/texture approval is still pending.

## Completed local checks

- Before changes: `npm run bench:check` passed, 60 benchmark comparisons and existing bundle gate. Warnings about stale/missing baselines were retained, not rewritten.
- Focused final Vitest run: **262 passed across 23 suites**, covering theme/color/material roles, context/picker, preference hydration, EPUB lifecycle and publisher-style helper, HTML reader/preparation, and RSS preferences/customization.
- Asset source/hash/size/alpha tests: **2 passed**.
- `npx tsc --noEmit`: passed. `npm run build:check`: passed, including all 76 canonical documentation checks and bundle budget (entry 5 KB, one PDF worker, total build 26.1 MB, including existing assets).
- Focused ESLint on new production material/hooks/settings/harness files: passed without errors or warnings.
- New Playwright Legal Pad contract: **1 passed** in Chromium; actual texture decode, selected passage, preview/revert, retained text-node identity and desktop/390px screenshots verified. Manually inspected desktop and phone browser captures. This is responsive browser evidence, not physical high-PPI/P3/HDR validation.
- Ripwire was run. After extracting appearance lifecycle and rich-frame styling into hooks, no major gating rows remain for the changed ThemeContext/RichContentRenderer/HTML-token/RSS/EPUB symbols in the scoped review. The repository-wide report also includes unrelated working-tree changes and vendored/generated trees; it is not reported as globally green.

## Outstanding checks and known blockers

- `npm run test:scripts`: 3 failures outside paper asset tests: iOS project override test requires unavailable `plutil`; macOS environment-shape test cannot obtain its expected Darwin RAM measurement on this Linux host; existing marketing freshness test reports an unattributed connections screenshot. The corresponding existing tests/implementation files were not changed by this feature.
- Existing scholarly-reader visual suite cannot load `src/utils/articleImport/__tests__/fixtures/arxiv-html-regression/moe-routing.svg`, which is absent in the inspected baseline. That broader run was stopped after confirming this deterministic fixture failure. The separate Legal Pad browser test passes.
- An initial candidate benchmark run overlapped type/build/test work and failed 9 ratios, including unchanged speech-index/digest/DAQE/haptic paths. That is a failed, uncontrolled candidate run; no baseline was changed. A controlled rerun is recorded separately below.
- `adb devices -l` on the Linux workstation found no attached devices. The user subsequently authorized the Mini host, where wireless ADB reaches the Pixel 9 Pro XL (see Android delivery evidence below). No iOS/Xcode tooling is installed on this Linux workstation. Mandatory physical Android/iPhone, native Linux software/hardware, Windows/macOS WebView, power/thermal, native memory/selection and P3 checks have not been certified. Production HDR and P3 enhancement are disabled; the shipped rendering tier is SDR.
- Full app-surface golden coverage, real fixed-layout EPUB/source-media pixel comparisons, PDF original-canvas equality tests, exhaustive long-reader/RSS performance, all highlight/focus/disabled-state contrast combinations and offline install/update testing remain pending. Do not archive this change or call it release-ready from the focused checks alone.

## Source and implementation adjustments

The source requirement was strengthened by the user's explicit choice: genuine high resolution is required before asset-dependent work. The verified original-resolution Paper006 file meets the resolution gate; converting its 8-bit source to a nominal 16-bit TIFF would not add information, so the original PNG is retained transparently rather than presented as a higher-bit-depth scan. Semantic `.bg-card` and shared dialog classes are explicit material owners in addition to data-marked surfaces; they receive texture, never blanket transparency. Host readers with unknown/custom gutters hide the red margin; same-origin HTML/EPUB panes with known padding render it. No shipped HDR/EDR pipeline is claimed.

## How to review the current implementation

Run `npm run dev -- --port 5199 --strictPort` and open `/legal-pad-harness.html` for the actual palette/material, Appearance controls and canonical HTML reader. The normal app's existing theme picker also exposes Legal Pad. This harness is a deterministic browser review surface, not a replacement for testing each native reader and app destination. `npx playwright test src/visual/legal-pad.visual.spec.ts` runs the local browser contract independently of the currently incomplete scholarly fixture.

Controlled performance rerun, after competing Node build/test work stopped: **`npm run bench:check` passed**, all **60 benchmark comparisons** and the bundle budget. Existing stale/missing baseline warnings remain. No performance baseline or bundle ceiling was relaxed. This supersedes the failed uncontrolled run as the CPU/bundle gate result; it does not certify native GPU, memory or power budgets.

Final follow-up: the Legal Pad Playwright suite now passes **2 tests**, including a separate DPR-3 phone context that selects and decodes a bounded high-density asset. An additional **34-test** run covering EPUB source appearance, context/picker, Markdown search and canonical/legacy PDF reflow passes. The final TypeScript check also passes. These supplement (and partly overlap) the 262-test focused run; they are not summed into a unique-test total. The full 65-task implementation/acceptance checklist remains **17 verified / 48 open**; many adapters are implemented but their complete fixture/native acceptance is intentionally not marked done.


## Android delivery evidence

The user authorized building on `mini@100.72.61.107` and installing through wireless ADB, then explicitly chose **Install only; I’ll test it myself**. No phone launch, theme change, screenshot, selection or performance test is included in this delivery.

- The Mini’s original checkout at `/Volumes/external/mac-mini/Code/Plethora` was clean at `c034c6b2a394ab9960369194845edb917031c42b`. It remains intact. The build uses a separate source copy at `/Volumes/external/mac-mini/Code/legal-pad-build-20261017`.
- All **8,703** copied source files matched the local snapshot manifest. Source archive SHA-256: `6d8605171fb419ff82806fbe26b8d1e0b69dc89be5d5e5eb00faf149ff771365`. It includes the current uncommitted working tree; this is not a new Git commit. Local manifest: `/tmp/legal-pad-source-manifest.json`.
- The Mini’s configured release key certificate matches the existing installed app certificate exactly: SHA-256 `7e5df003dd45df3adf373296616bdb15eec4ad577736d805b3e9c3429a711266`. Credentials remain on the Mini and are not included in this report. Verification record: Mini `/tmp/legal-pad-signing-check.json`.
- Device: **Pixel 9 Pro XL**, Android **17**, provider `app.vanadium.webview` **155.0.8059.84.0**. ADB reports physical size **1008×2244**, density **360**; CSS DPR was not measured. Wireless ADB was already connected. The phone was locked during preparation.
- Android SDK platform 36, NDK `27.2.12479018`, Temurin Java 17. The existing native Back acceptance property is explicitly enabled for this internal build. Frontend target `tauri`, profile `development`, build ID `3.3.0+legal-pad-6d8605171fb4`.
- The first native attempt encountered a stale shared build-script cache containing another checkout’s absolute permissions path. Cleaning the app package’s release cache regenerated `app-command-acl.toml` in the correct source copy. The source and signing configuration were unchanged.

Both optimized Rust release passes succeeded (11m00s and 10m22s). Kotlin packaging then exposed one missing ignored generated `TauriActivity.kt` bridge in the isolated source copy. The nine other generated files matched the Mini’s working project byte for byte. Restoring its generated bridge (SHA-256 `3fc5f252a934cb3f3667ac7c43a013ed45acb123bbf399e0a6e433e975bda1b2`) resolved Kotlin compilation. This is a build dependency supplement to the frozen source manifest, not a tracked MainActivity change. Future isolated builds must include/regenerate this bridge; a plain tracked-file snapshot is insufficient with this shared cache.

Final packaging used `./gradlew assembleUniversalRelease -PabiList=arm64-v8a` with the existing `plethoraSkipRustBuild=true` property after native compilation; it reused the completed native library. Gradle release packaging and its vital lint checks passed. Restricting the ABI matches the CLI’s aarch64 target and avoids bundling other ABIs’ dependency libraries. No performance baseline or app source was changed to package successfully.

The user then reported that the initially installed APK crashed on launch. The captured Android exception was `NoSuchMethodError` for `MainActivity.getPluginManager()` during Tauri startup. DEX inspection showed that the previously working installed APK retained `TauriActivity.getPluginManager()`, while R8 had removed it from our release. The tracked [proguard-rules.pro](../../../src-tauri/gen/android/app/proguard-rules.pro) now keeps that specific JNI-reflected method.

Repackaging passed, and `apkanalyzer` confirms the rebuilt DEX contains `public final getPluginManager()`. The replacement ARM64 APK is **71,472,159 bytes**, SHA-256 `9ac53264312e07152bb1e08a011df40b4032c2d5b1e5fef32b079d9dca915cad`. Its verified release certificate still matches the known working app: `7e5df003dd45df3adf373296616bdb15eec4ad577736d805b3e9c3429a711266`. Wireless `adb install -r` succeeded and preserved app data; reading the installed APK back from the Pixel produced the same SHA-256 byte for byte. Package `com.plethora.app`, version **3.3.0**, code **3003000**. The Mini’s original checkout remains clean.

The fixed replacement was not launched, in line with the user's install-only instruction. The user should verify startup on the phone. Phone UI, startup after the fix, power, memory, P3 or other mandatory native acceptance rows remain pending. The OpenSpec checklist remains **17/65 verified**. Machine-readable delivery evidence: [android-delivery.json](android-delivery.json). User controls and rollback: [usage.md](usage.md).
