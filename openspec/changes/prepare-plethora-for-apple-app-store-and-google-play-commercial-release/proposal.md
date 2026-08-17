# Change: Prepare Plethora for Apple App Store and Google Play Commercial Release

> Wave 4 — Commercialization (final gate). Hard-depends on 1 (identity), 4 (billing on devices), 21 (final UX), 22 (privacy/deletion completeness). Verifies the integrated product for store submission.

## Why

Plethora ships through the Apple App Store and Google Play. Stores require: correct bundle identity and signing, verified in-app purchase integration, accurate privacy declarations ("privacy nutrition labels" / Data Safety form), in-app account deletion, sensible permissions justifications, working restore flows, crash-free baseline behavior, and review-process support (demo accounts, review notes). This change is a **readiness program with a checklist and regression proof**, not a feature.

## What exists today
- **Android**: `gen/android` (package `com.incrementum.app`, targetSdk 36/minSdk 24, NDK pinned); CI builds signed APKs on tags (`mobile-build.yml`); **committed `release.keystore` with password "incrementum"** (must be replaced by Play App Signing upload key — rebrand flags rotation; this change completes it); permissions: INTERNET, RECORD_AUDIO, CAMERA (QR), MODULATE_AUDIO, REQUEST_INSTALL_PACKAGES (APK self-updater — **incompatible with Play policy; must be disabled in Play builds**); share intents (SEND/VIEW), leanback. Play-listing assets absent.
- **iOS**: no `gen/ios` yet; `tauri.ios.conf.json` + iOS icon set exist; CI has signed/simulator build jobs; StoreKit plugin arrives with 4. No App Store metadata.
- **Updater**: desktop GitHub updater (rebrand migrates to Plethora repo); Android self-updater must be Play-path-disabled; iOS updates via App Store only.
- **Privacy**: data map + deletion flow + telemetry policy arrive with 22 (inputs for labels).
- **Billing**: sandbox verification records from 4.
- **Mobile UX**: mature (mobile layouts, e-ink modes, share capture, onboarding tour).

## What Changes

### 1. Store identity & signing
- Final bundle ids per rebrand decision (`com.plethora.app` expected); **Play App Signing** enrollment with a new upload keystore (secret-stored, never committed — replacing the committed keystore); iOS certificates/profiles via CI secrets (App Store Connect API key); versionCode/versionName strategy documented (auto-increment per release; aligns with release skill).
- Distinct build flavors/flags for store builds vs sideload: `store` build config disables the APK self-updater + any policy-sensitive surface; sideload flavor keeps current behavior (documented).

### 2. Policy-sensitive functionality audit
- **Updaters**: Play/iOS builds contain no self-update code paths (compile-time cfg).
- **APK install permission** (`REQUEST_INSTALL_PACKAGES`): stripped from store builds.
- **YouTube/media ingestion** (18's boundary), in-app browser (web_proxy), browser-extension features: reviewed against platform policies; findings recorded with justifications or adjustments (policy text re-verified at implementation time — **do not trust this document's memory of current store rules**).
- Account deletion (22) reachable in-app (store requirement); restore purchases (4/21) functional.
- External-link/payment policies: desktop-checkout links must not appear in iOS mobile builds if prohibited (config-gated per platform; flag for legal/product verification).

### 3. Store listings & metadata
- Asset production pipeline: screenshots per device class (phone/tablet) from real UI states (following the app's actual best screens — reading, review, knowledge universe, insights); feature graphics; descriptions (per-locale: 6 languages where store-localized); keywords; privacy-label answers generated from 22's data map (single source).
- **Review support**: sandbox test accounts with Pro entitlements, review notes (features requiring accounts/billing, demo-mode walkthrough), demo content seeding (existing `demo/` + `lib/demoContent.ts`).

### 4. Release channels & update strategy
- Matrix documented: desktop (GitHub updater via rebrand chain), Play (staged rollouts + internal/closed tracks), iOS (TestFlight → phased release); rollback/posture notes; version alignment across the five manifests (release script already handles; verify mobile versionCode).
- Crash handling: 22's opt-in crash reporting + store-native crash tooling (Crashlytics-free v1: store consoles' native reports) — policy: no third-party SDK requirement; monitoring via 24.

### 5. Regression & submission readiness
- **Mobile regression program**: scripted device-matrix smoke (launch, import, read, extract, review, TTS, offline airplane-mode pass, share-sheet in/out, purchase sandbox, restore, deletion flow) on Android physical device (existing android-build skill workflow) and iOS simulator/device; battery/foreground-background lifecycle tests (existing battery optimization work extended); deep-link/universal-link verification if enabled.
- **Store-review checklist** (docs/RELEASE_CHECKLIST.md): per-store submission steps, rejection-risk items (IAP, deletion, background behavior, permissions justification text), and sign-off template.
- Production configuration: `PLETHORA_ENV=production` server URL, feature flags frozen list, kill switches armed (5/24).

## Impact

### Affected Specs
- `commercial-release-readiness` — New (store build variants, policy audit, listing pipeline, regression program, submission checklist).

### Affected Code Areas
- `src-tauri/gen/{android,ios}` configs, signing setup, `tauri.*.conf.json` variants, build scripts/CI (`mobile-build.yml` store jobs), compile-time store flags, demo/review tooling, `docs/RELEASE_CHECKLIST.md`, store asset pipeline scripts.

### Non-goals
- No new product features, no marketing site, no MAS (Mac App Store) v1 (desktop ships via site/GitHub), no third-party crash SDK.

## Dependencies

### Hard dependencies
- 1 (identity), 4 (billing), 21 (UX), 22 (privacy/deletion). Soft: everything (this validates the integrated product — all desired-launch proposals landed).

### May run concurrently
- 24 (observability arming).

### Must not start yet
- Actual submission (gated on this checklist completing).

## Shared interfaces
- Store build-variant flags (`store` vs `sideload`); privacy-label answers derived from 22's registry; versionCode automation hooks into the release script; submission checklist consumed by the cut-release process.

## Ownership boundaries
- **May modify**: mobile gen configs, signing/CI jobs, store-flag plumbing, docs/checklists, asset pipeline.
- **Must treat as external**: feature behavior (verified, not changed — deviations become bugs filed to owning proposals), billing/entitlement semantics.

## Collision risks
- `mobile-build.yml` + Android gradle (rebrand touches naming — sequence after); `lib.rs` cfg-gated blocks; release script extension (versionCode).

## Integration contract
- Produces the submission checklist + verified builds; consumes final data map (22), billing sandbox records (4), and UX freeze (21).

## Testing & acceptance

### Tests
- Build-variant tests: store builds exclude self-updater/install-permission code paths (static assertion), sideload builds retain them.
- Device-matrix smoke suites (scripted, repeatable in CI where emulators allow + physical-device runbook).
- Sandbox billing E2E on device (purchase/restore/refund) — recorded evidence.
- Deletion + privacy-label traceability test (labels ↔ data map ↔ in-app disclosure).
- Offline/lifecycle: airplane-mode suite; backgrounding during jobs (transcription/TTS) resumes correctly.
- Deep link/universal link verification (if configured).

### Acceptance criteria
- Staged/internal-track builds pass the full mobile regression program on real devices; policy audit documented with current store rules re-verified at implementation time; listings complete (assets, localized metadata, labels); review accounts + notes ready; checklist signed off — the product is submission-ready.

### Must remain unchanged
- Sideload/desktop behavior (flavors isolate changes); existing CI gates.

## Open questions
1. iOS minimum OS + device matrix (set at submission planning).
2. Play staged-rollout percentages (ops decision).
3. Whether iOS ever needs the in-app browser policy review outcome documented (flagged in audit).
