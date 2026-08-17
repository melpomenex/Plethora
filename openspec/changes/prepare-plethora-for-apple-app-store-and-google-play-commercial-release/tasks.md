# Implementation Tasks

## 1. Identity, signing, variants
- [ ] 1.1 Store/sideload build-variant flags (compile-time cfg + conf variants); strip self-updater/install-permission from store builds + static assertions
- [ ] 1.2 Play App Signing enrollment; new upload keystore in secrets; retire committed keystore; iOS ASC API-key CI signing
- [ ] 1.3 versionCode automation in release script (5-manifest alignment verified for mobile)

## 2. Policy audit & compliance
- [ ] 2.1 Re-verify current store policies (updaters/IAP/external links/media/browser/permissions) with dated findings
- [ ] 2.2 Platform-gated surfaces (checkout links, extension pointers) config + docs
- [ ] 2.3 Account-deletion + restore verification on store builds with recorded sandbox evidence

## 3. Listings & review support
- [ ] 3.1 Screenshot/feature-graphics pipeline from real UI states (device classes)
- [ ] 3.2 Localized store metadata (6 locales); privacy labels generated from 22's data map + traceability test
- [ ] 3.3 Reviewer sandbox accounts with Pro grants; review notes; demo-content seeding

## 4. Regression program
- [ ] 4.1 Device-matrix smoke suites (launch/import/read/extract/review/TTS/offline/share/billing/deletion) — scripted, evidence recording
- [ ] 4.2 Lifecycle tests (backgrounding during transcription/TTS jobs, battery gates); deep-link verification if enabled
- [ ] 4.3 `docs/RELEASE_CHECKLIST.md` + sign-off flow; production config freeze (PLETHORA_ENV, flags, kill switches armed)

## 5. Validation
- [ ] 5.1 Full gates + mobile physical-device runbook execution record
- [ ] 5.2 Internal-track / TestFlight upload dry runs
