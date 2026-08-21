## Context

- Product identity: "Plethora — Read anything. Learn everything." (per `openspec/planning/plethora-transformation-roadmap.md`); philosophy: do not paywall reading, paywall augmentation; local-first and fully useful without an account. Launch workflow: Import → Read → Extract → Remember → Review.
- Current store-adjacent copy is desktop-flavored (`tauri.conf.json` short/long description) — not reusable verbatim for iOS.
- Existing assets: `src-tauri/icons/ios/AppIcon-*` (icon source), `mobile-screenshots/` directory exists at repo root (verify freshness/provenance — screenshots must ultimately be re-captured from the RC regardless).
- Demo infrastructure partially exists (`add-demo-mode-with-onboarding` change); reviewer sample-library strategy builds on whatever that shipped plus a seeded account.
- Human prerequisites tracked honestly in `docs/release/PLETHORA_1_0_HUMAN_LAUNCH_CHECKLIST.md`: Apple Developer enrollment, D-U-N-S, Paid Applications schedule, ASC product creation, shared secret/notification key, reviewer demo account.
- Cross-proposal inputs: D's `docs/product/features/platform/ios-capabilities.md` (screenshot content truth), B's StoreKit-derived pricing/subscription facts, C's privacy label mapping (listing must not contradict labels), F's verified reviewer-account lifecycle.

## Goals / Non-Goals

**Goals:**

- Complete ASC metadata sheet ready for entry; five-part screenshot narrative captured from the RC; reviewer package that lets review complete the core value loop unaided; URLs live (privacy/support/terms).
- Listing story = learning system ("Read. Extract. Remember."), with SRS as the engine — not the headline.

**Non-Goals:**

- App Preview video production (optional; documented as follow-up if skipped).
- Paid UA/marketing site work; ASO experimentation beyond a keyword set.
- Localization beyond the v1 launch-language decision.

## Decisions

### 1. Metadata
Name "Plethora"; subtitle candidates centered on reading→memory (e.g., "Read. Extract. Remember."); primary category Education (secondary: Productivity/Books per ASC options). Description structure: value loop first, formats second (PDF/EPUB/articles), local-first/no-account-required explicit, Pro clearly described as cloud/AI augmentation with Apple-managed billing. Keywords: reading, flashcards, spaced repetition, PDF/EPUB reader, study, memorize, highlights, notes, incremental reading, language learning (validate 100-char budget at implementation). Promotional text: version-launch blurb, easily updatable without review.

### 2. Screenshots from the exact RC build
Five-frame narrative: (1) Read anything — document open in reader; (2) Capture what matters — selection/extract moment; (3) Remember automatically — Review session with rating controls; (4) Build your library — Documents/knowledge organization; (5) optional Listen-and-learn frame ONLY if G's evidence shows iOS audio/TTS stable for the RC. Required sizes: iPhone 6.9" + 6.5"; iPad 13" if iPad supported. Every frame's build number recorded via G's evidence chain. No mockups materially diverging from the submitted app.

### 3. Reviewer package
Review notes covering: what Plethora does in one paragraph; the 60-second reviewer path (import sample → read → extract → review); demo account credentials handling (delivered via ASC review-information fields, never committed to git); explicit statement that account creation is optional; explanation of subscription products (monthly/annual, free trial if configured), Restore Purchases location; note on optional cloud AI (BYO keys / Pro gateway) with data-flow summary consistent with C's labels; file-import capabilities list matching D's matrix. Seeded sample library on the reviewer account (a few small public-domain documents) created via existing import tooling.

### 4. URLs and legal
Privacy policy URL must match C's registry/docs; terms URL; support URL (GitHub issues or dedicated page — decide at implementation based on existing support posture); encryption/export-compliance answer prepared (standard HTTPS — likely qualifies for exemption; confirm current Apple guidance at implementation).

### 5. Age rating & questionnaire
Education content, user-generated/imported content considerations (imported documents are private to the user; no social UGC sharing — state this in notes), no gambling/contests; prepare answers consistent with feature reality including web/RSS content viewing.

## Data Flows

None runtime. Inputs: capability matrix (D), pricing facts (B), labels mapping (C), gate evidence (G).

## Failure Behavior

If any dependency fact is unsettled at capture time (e.g., TTS unstable), the affected frame/scenario is dropped rather than approximated; listing claims never exceed verified behavior.

## Testing Strategy

Consistency checklist: every claim in metadata traceable to implemented+verified features (cross-ref D's matrix and G's evidence); label-vs-listing cross-check with C's mapping; reviewer dry-run of the 60-second path on the RC build recorded as evidence.

## Rollout

Draft metadata early; finalize after Wave 3 gate; enter ASC after G declares submission-candidate status.

## Alternatives Considered

- Marketing-site-hosted screenshots/mockups: rejected — App Store screenshots MUST come from the RC build per this initiative's rules.
- Positioning primarily as an Anki-compatible SRS app: rejected — undersells the reading system identity; compatibility remains a feature bullet, not the headline.

## Rejected Alternatives / Notes

- Launching with App Preview video: deferred unless capacity allows; not a gate.

## Ownership & Collision Boundaries

| File/area | Owner | Notes |
|---|---|---|
| `docs/release/app-store/**`, screenshot storyboard/captures | **H exclusively** |
| Reviewer sample-library seeding | H defines needs; F executes account setup within its lifecycle run |
| Metadata claims about pricing/subscriptions | H writes; **facts supplied by B**, never invented |
| Privacy/terms URLs content | C owns privacy content accuracy; H owns packaging |
