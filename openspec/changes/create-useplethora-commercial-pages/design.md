## Context

`src/types/entitlements.ts` lists Pro capabilities (sync, library intelligence, graph, OCR cloud, premium TTS, transcription, analytics, etc.) with local fallbacks. Display prices are **not** in app code; billing OpenSpec still describes missing store wiring. `docs/release/PLETHORA_1_0_HUMAN_LAUNCH_CHECKLIST.md` has empty legal/store checkboxes. `docs/IMPLEMENTATION_STATUS.md` still titles Incrementum in places and marks iOS in progress / AnkiConnect planned. `docs/USER_HANDBOOK.md` overclaims AnkiConnect.

## Goals / Non-Goals

**Goals:** Honest commercial pages; configurable prices/CTAs; download detection without traps; claim matrix; draft legal with banners; SEO pages that do not cannibalize with duplicate fluff.

**Non-Goals:** Inventing entity identity; enabling real checkout; rewriting the handbook; implementing AnkiConnect; changing entitlement defaults in the app.

## Decisions

### Pricing table source

Rows are `CapabilityId` plus Free-tier local features (reading, extracts, incremental reading, cards, SRS, image occlusion, e-ink, local TTS where supported, local backups, import/export, BYO keys). Pro column matches registry `defaultPlan === 'pro'`. If a row is not in the registry, it MUST be in the claim matrix with evidence.

### Checkout

`cta.mode` from config. When disabled, button label “Available at launch” / “Coming soon” and no `/api/checkout`. When enabled later, href comes from env (Stripe/Paddle/App Store) — still not implemented here beyond the href slot.

### Downloads

`navigator.userAgentData.platform` then UA. Recommend one primary button + “All downloads”. Linux: .deb/.AppImage/arch notes as **coming soon** unless URLs exist. iOS: App Store or coming soon. Android: Play or APK if URL provided. Never auto-download.

### Claim matrix (normative excerpts)

| id | public? | notes |
|---|---|---|
| local-reading-formats | yes if status shipping | PDF/EPUB/HTML/MD/etc. from product docs |
| incremental-reading | yes | |
| srs-fsrs | yes | |
| image-occlusion | yes | |
| eink | yes | |
| byo-ai | yes | user-chosen providers |
| cloud-sync-e2ee | **no** | sync engine stub / empty pull; do not market ZK multi-device |
| pro-gating-current | **no** | CapabilityGate unused at feature call sites — do not describe current app as paywalled |
| anki-apkg | yes | package import/export |
| anki-connect-live | **no** | handbook vs IMPLEMENTATION_STATUS vs code disagree; default public=false |
| ios-app-store | **no** | not commercially release-ready |
| android-play | **no** | Play Billing plugin absent; enrollment open |
| desktop-win-mac-linux | yes as desktop apps | mention macOS signing caveats if still true |
| web-checkout | **no** | no Stripe/Paddle implementation |
| store-price-999 | **never** | fixture $9.99/$79.99 must not appear |
| zero-knowledge | **no** | conflicting docs + stub sync |
| fake-user-counts | never | |

Banned phrases unless matrix public: “zero-knowledge”, “end-to-end encrypted sync”, “military-grade”, “AnkiConnect sync”, “on the App Store”, “on Google Play”, “used by N readers”, “$9.99”, “$79.99”.

### Legal pages

Template sections with `{{LEGAL_ENTITY}}` style tokens. If null, render “This policy is a draft and is not offered as a contract. Plethora is preparing its legal entity.” Production index blocked by F.

### SEO pages

Each audience page: unique intro (students vs researchers vs Anki migrants vs read-it-later). Canonical self. `rel=canonical`. Do not repeat the entire homepage. Anki page MUST include a sentence that live AnkiConnect synchronization is not claimed.

### Docs/changelog

Prefer linking into curated `docs/product/` topics that are user-facing. Exclude `docs/release/*RC*` from the public docs nav.

### Incrementum / readsync.org

Public website copy SHALL say Plethora and useplethora.com. Historical changelog entries may mention old names only inside `/changelog` if quoting history, with a one-line note about the rename.

## Open Questions

Founder: support email; whether docs are a subset or “GitHub docs” link; Play vs APK.
