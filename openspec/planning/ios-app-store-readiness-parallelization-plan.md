# iOS App Store Readiness — Parallelization Plan

Status: planning artifact (2026-08-21). Cross-proposal coordination map for the eight OpenSpec changes that take Plethora iOS from simulator-grade to an App Store submission candidate. Companion to `plethora-transformation-roadmap.md`. Every claim below was verified against live code in the 2026-08-21 audit; stale prior claims are annotated inside each proposal.

## The changes

| # | Change | Wave | Capability | Priority |
|---|--------|------|------------|----------|
| A | `complete-production-ios-build-and-signing-pipeline` | W1 | `ios-release-pipeline` | P0 foundation |
| B | `implement-native-ios-storekit2-billing` | W1 | `ios-storekit-billing`, `store-entitlement-validation` | P0 commercial |
| C | `complete-ios-apple-privacy-compliance` | W1 | `apple-privacy-compliance` | P0 submission req. |
| D | `harden-ios-feature-availability-and-mobile-product-scope` | W1 | `ios-feature-availability` | P0 completeness |
| E | `implement-native-ios-share-extension` | W1 | `ios-share-extension` | P1 parallelizable |
| F | `harden-ios-account-and-subscription-lifecycle` | W2 (parts W1) | `ios-account-lifecycle` | P1/P0-adjacent |
| G | `establish-ios-testflight-release-evidence-gates` | W3 (authorable W1) | `ios-release-evidence-gates` | P0 gate |
| H | `prepare-plethora-ios-app-store-listing-and-review-package` | W4 (draftable W1) | `app-store-listing-package` | P2 packaging |

## Dependency graph

```text
A. Production iOS Foundation ──┬──> B. StoreKit 2 Billing
   (gen/apple, signing,        ├──> C. Privacy Manifest & Labels
    build profile, plugin      ├──> D. Capability Gating
    symbol fix, CI archive)    ├──> E. Share Extension (via A's target hook)
                               │
B + C + D + A ─────────────────┴──> F. Account & Subscription Lifecycle
                                     (deletion flow + mock-fallback removal may start in W1)
A + B + C + D + E + F ────────────> G. TestFlight Evidence Gates
G ────────────────────────────────> H. Store Listing / Reviewer Package
```

Soft edges: B can start before A lands by agreeing the `buildProfile.ts` export signature; E's Swift work proceeds against a locally generated project using A's documented procedure; G and H authoring has zero dependencies.

## Waves

### Wave 1 — foundation + parallel engineering (5 agents concurrently)
A, B, C, D, E. All five own disjoint primary file sets (see collision map). Two hard coordination points:
1. **`buildProfile.ts`** — A creates; B and D consume read-only. Agree the constant name/signature in a comment on A's task 3.2 before either consumer merges.
2. **Extension-target hook** — E supplies target definitions as data; A's overrides script applies them. Neither edits `gen/apple` or CI YAML directly.
F's B-independent half (deletion-flow rewrite, sign-in integrity, tasks F §1–§2) MAY also start in Wave 1.

### Wave 2 — integrated user lifecycle
F §3–§4 (subscription UX integrating B's landed engine). Wave 1 fixes continue merging. No new agents required to serialize.

### Wave 3 — verification
G executes golden-path/lifecycle/billing/deletion/privacy/share scenarios on physical devices against the first TestFlight build. Findings are filed back to owning proposals; G never patches implementation code.

### Wave 4 — packaging
H finalizes metadata/screenshots/reviewer package from the exact RC build after G declares gate status.

## Shared-file collision map

| File/area | Owner | Permitted touches by others |
|---|---|---|
| `src-tauri/gen/apple/**`, xcodeproj | **A** | C: privacy manifest/plist via data files consumed by A's overrides script; E: extension target via the same hook. Never direct edits. |
| `src-tauri/tauri.ios.conf.json` | **A** | C may append resource reference (coordinate). |
| `.github/workflows/mobile-build.yml` (iOS job) | **A** | G defines artifact names (applied by A); no one else. |
| `package.json` scripts | **A** (iOS scripts), **B/D none**, others read-only. |
| `scripts/release.cjs` | **A** | H/G read-only. |
| `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml` | shared, trivially | B adds ONE cfg-guarded plugin registration + dep line; conflicts are one-line, last-writer-includes-both. |
| `src/lib/buildProfile.ts` | **A creates** | B/D consume read-only. |
| `src/lib/billing/*`, `billingStore.ts`, `components/monetization/*` | **B** | F consumes stores read-only; D gates visibility only. |
| `server/src/routes/v1/billing.ts`, ASC client, migrations | **B** | F consumes deletion-retention semantics read-only. |
| `src-tauri/src/entitlements/mod.rs` | **B** (refresh transport) | others read-only. |
| `src/lib/privacy/**`, `docs/PRIVACY_ARCHITECTURE.md` | **C** | B supplies flow facts as input only. |
| `PrivacyCenter.tsx`, SettingsPage privacy tab | **C** | D gates tab availability only. |
| `aiBillingConsent.ts` | shared | C adds disclosure-gating fields; B owns billing-consent semantics — field-level coordination. |
| `platformCapabilities.ts`, `MobileNavigation.tsx`, `TabRegistry.tsx`, palettes | **D exclusively** | others register capability ids via enum additions. |
| `SettingsPage.tsx` | three-way, disjoint sections | D: update row/section gating · C: privacy tab · F: account section. No section renumbering; last merge rebases. |
| folder-import plugin share semantics (`shareTarget.ts`, `useShareTarget.ts`) | **E** | A owns its link-symbol naming (already fixed); D registers the capability slot. |
| `accountStore.ts`, deletion component, `UserProfilePanel.tsx` | **F** | B provides events/state; D gates visibility. |
| `src-tauri/src/plethora_auth` | **F** (mock gating; mechanism agreed with A's build profile). |
| `docs/release/ios-*` scenario/gate docs, `evidence/` schema | **G exclusively**. |
| `docs/release/app-store/**`, screenshots | **H exclusively**. |

## Integration order

1. A tasks 1.x (plugin symbol fix) — unblocks all iOS compilation; land immediately.
2. A §2–§3 (project + build profile) ∥ B §1–§5 ∥ C §1,4 ∥ D §1–§3 ∥ E §1–§3 ∥ F §1–§2.
3. A §4–§5 (signing/CI) → first signed device build → B §7 sandbox on device ∥ C §2–§3 (archive audit) ∥ E §4 (target integration).
4. F §3 (subscription UX) once B's store contract is live.
5. G §4 execution on the first TestFlight build.
6. H §4 screenshots from the RC; ASC entry after G's gate report.

## Final release gate ("App Store ready")

Submission-ready when ALL of the following hold, each with evidence per G:

- [ ] Production iOS Release build compiles for device; correct bundle identity
- [ ] Archive signs correctly and passes validation
- [ ] Physical iPhone install succeeds; iPad verified if supported
- [ ] StoreKit products load from Apple; sandbox monthly (and annual if offered) purchase succeeds
- [ ] Restore succeeds; entitlement persists across relaunch; transaction updates/reconciliation function
- [ ] No mock billing possible in production builds (invariant tests green)
- [ ] Account deletion works in-app; copy distinguishes Apple subscription cancellation
- [ ] Privacy manifest validates against the archive; labels match actual data flows; cloud-AI disclosure accurate
- [ ] Unsupported platform features hidden or clearly marked unavailable; no broken controls (D walkthrough)
- [ ] No desktop updater/self-update behavior reachable on iOS
- [ ] Core offline workflow passes (import/read/extract/review golden path)
- [ ] Background/foreground lifecycle passes; accessibility smoke passes
- [ ] TestFlight build installed and tested on clean devices (internal round; external round recommended)
- [ ] Release evidence recorded per schema; every gate item evidenced or dispositioned
- [ ] App Store screenshots from the real RC; reviewer account works; reviewer notes complete
- [ ] Support/privacy/terms URLs ready; App Store Connect metadata ready
- [ ] Zero open P0 blockers; every remaining P1/P2 has an explicit accepted disposition

## Superseded prior artifacts (annotate, don't rewrite history)

- `prepare-plethora-for-apple-app-store-and-google-play-commercial-release` — false `[x]` claims (ASC API-key signing 1.2, TestFlight dry runs 5.2); superseded by A (+G).
- `implement-cross-platform-subscription-billing-and-license-management` — false `[x]` claims (plugins 2.1/2.2, JWS 3.2, webhook signatures 3.4, grant derivation 3.5/3.6, purchase path 4.1); superseded by B.
- `implement-plethora-accounts-authentication-and-entitlements` — false `[x]` claims (OAuth 1.4, Rust auth 2.1); corrected by F (OAuth explicitly deferred).
- `implement-plethora-cloud-privacy-security-data-export-and-account-deletion` — partial claims (retention/receipt/job 2.1, multi-step deletion 2.2); completed by F.
- `eink-mode-and-native-share` — iOS Share Extension requirement implemented by E; Android-only `[x]` items annotated.
