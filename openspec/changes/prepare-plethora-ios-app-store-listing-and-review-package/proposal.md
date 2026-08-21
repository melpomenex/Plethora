## Why

Plethora's launch identity is a reading-and-learning system — **Read → Extract → Remember → Review** — not "another spaced repetition app." The App Store listing must tell that story and the reviewer package must make approval easy. Today nothing exists: no App Store Connect metadata, no screenshots, no review notes, no URLs package. The existing desktop description ("Spaced repetition and incremental reading for effective learning" in `tauri.conf.json`) is desktop-flavored and does not reflect the mobile launch surface. `docs/release/PLETHORA_1_0_HUMAN_LAUNCH_CHECKLIST.md` correctly tracks these as open human tasks; this proposal turns them into an implementable, evidence-backed work package.

## What Changes

- Define final store metadata: app name/subtitle, description, keywords, promotional text, category (Education), age-rating questionnaire answers.
- Capture all screenshots **from the actual release/TestFlight RC build** on required iPhone sizes (6.9"/6.5") and iPad (13") if supported, following the five-part narrative: Read anything → Capture what matters → Remember automatically → Build your knowledge library → (Listen and learn, only if iOS audio/TTS is verified stable).
- Assemble the reviewer package: review notes, demo/test account with seeded sample library, explanation of optional cloud/AI features and subscription behavior, privacy-policy/support/terms URLs.
- Define localization strategy for v1 (launch-language scope) consistent with the repo's internationalization state.

## Capabilities

### New Capabilities

- `app-store-listing-package`: App Store metadata, RC-build screenshot set, reviewer materials, and legal/support URL readiness.

### Modified Capabilities

None.

## Impact

- New docs/assets: `docs/release/app-store/` (metadata sheets, review notes, screenshot storyboard), screenshot source files.
- Read-only consumption of D's capability matrix (what to show/hide in screenshots), B's product/pricing facts (subscription copy from StoreKit-truth), C's privacy label mapping (consistency between listing claims and labels).
- No application code changes except trivially: none expected; if a demo-mode/sample-library seed is needed for reviewers, coordinate scope explicitly (demo infrastructure partially exists via `add-demo-mode-with-onboarding`).

**Owns:** everything under `docs/release/app-store/`, screenshot capture process, ASC metadata entry sheet.
**Must NOT change:** app code, billing behavior, privacy implementation, gating logic.

## Dependencies

- **Hard:** G's gate (RC build + evidence exist) for screenshots/reviewer validation; B (real pricing/subscription facts); F (reviewer account works end-to-end including deletion).
- **Soft:** C (label consistency check), D (capability matrix defines what appears on screen).

## Parallelization Notes

Metadata drafting, URL preparation, and storyboard design can start in Wave 1–2 in parallel with everything; only final screenshot capture and ASC entry wait for the Wave 3 RC.

## Migration / Backward Compatibility

None (documentation/marketing artifacts). Desktop descriptions untouched.

## Risks

- Screenshot/reality drift: mitigated by the exact-RC-build rule enforced through G's evidence chain.
- Reviewer rejection on unclear account requirements: mitigated by local-first positioning (no account required) stated explicitly in notes and description.
