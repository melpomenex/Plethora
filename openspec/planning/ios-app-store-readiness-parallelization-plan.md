# iOS App Store Readiness — Parallelization Plan

Status: planning artifact (2026-08-21). Cross-proposal coordination map for the eight OpenSpec changes that take Plethora iOS from simulator-grade to an App Store submission candidate. Companion to `plethora-transformation-roadmap.md`. Every claim below was verified against live code in the 2026-08-21 audit; stale prior claims are annotated inside each proposal.

## The changes

| # | Change | Wave | Capability | Priority | Status |
|---|--------|------|------------|----------|--------|
| A | `complete-production-ios-build-and-signing-pipeline` | W1 | `ios-release-pipeline` | P0 foundation | **W1 implemented** (device/signing verification pending Xcode) |
| B | `implement-native-ios-storekit2-billing` | W1 | `ios-storekit-billing`, `store-entitlement-validation` | P0 commercial | **W1 implemented** (simulator/sandbox verification pending) |
| C | `complete-ios-apple-privacy-compliance` | W1 | `apple-privacy-compliance` | P0 submission req. | **W1 implemented** (archive-audit items blocked on A §4 run) |
| D | `harden-ios-feature-availability-and-mobile-product-scope` | W1 | `ios-feature-availability` | P0 completeness | **W1 implemented** (simulator walkthroughs pending) |
| E | `implement-native-ios-share-extension` | W1 | `ios-share-extension` | P1 parallelizable | **W1 implemented** (extension compile/device verification pending) |
| F | `harden-ios-account-and-subscription-lifecycle` | W2 (parts W1) | `ios-account-lifecycle` | P1/P0-adjacent | **§1–§2 implemented (W1)**; §3–§4 queued for W2 |
| G | `establish-ios-testflight-release-evidence-gates` | W3 (authorable W1) | `ios-release-evidence-gates` | P0 gate | queued |
| H | `prepare-plethora-ios-app-store-listing-and-review-package` | W4 (draftable W1) | `app-store-listing-package` | P2 packaging | queued |

## Session log — Wave 1 execution (2026-08-21)

Implemented via six parallel subagents in two launch groups. All commits direct to `main`.

**Merge order (chronological):**
1. Housekeeping: pre-existing settings-prefetch work committed separately (`a2f85618`) to keep agent diffs clean.
2. Group 1 (concurrent): **A §1** landed first (`cc37ea37`, compile-unblocking symbol fix) ∥ **C** (`03b7dd23`, `42ce10ce`, `e1bafae6`, `e81c41d2`, `a7017295`) ∥ **E** (`de519d5e`, `26829f80`, `4decefe0`, `ac6723cb`). A §2–§3 followed inside group 1 (`82ca7deb`, `98bddb50`, `530f1d06`).
3. Group 2 (after A's buildProfile landed): **F §1–§2** (`dcd4e850`, `5f3d62ed`) ∥ **D** (`8edec533`…`d744b0df`) ∥ **A §4–§7** (`dc70682f`…`11665061`, incl. `1baf06f7` integrating C/E override data into gen/apple) ∥ **B** (`d1f25537`…`ffadee49`; one silent agent failure required a relaunch).

**Contracts as landed:**
- `src/lib/buildProfile.ts`: `type BuildProfile = "development" | "sideload" | "store"`, `parseBuildProfile(value)`, `const BUILD_PROFILE`, `isStoreProfile()`, `isDevelopmentProfile()`; Vite define `__PLETHORA_BUILD_PROFILE__`. Rust twin: `src-tauri/src/build_profile.rs` (`build_profile()`, `is_store_profile()`). B/D/F consume read-only — held exactly.
- Overrides hook: data dir `scripts/ios-overrides/` (`privacy-manifest.json` ← C, `share-extension.target.json` ← E), consumed by `scripts/apply-ios-project-overrides.js`. Both files landed and were integrated into `gen/apple` (E ran the script itself; A re-ran post-C and committed `1baf06f7`). Neither C nor E touched gen/apple directly — contract held.

**Deviations from the collision map / task text (accepted):**
- B registered the storekit plugin **unconditionally** (not `#[cfg(ios)]`-wrapped) so non-iOS targets get typed UNSUPPORTED command errors; matches folder-import precedent. Also added one `capabilities/default.json` permission line beyond the "two lines" budget; transaction-update events use the Tauri channel-listener mechanism instead of global emit (same event name).
- A retained `xcrun altool` for validate+upload (`notarytool` is notarization-only); added optional secret `IOS_SHARE_PROFILE_BASE64` (extension signing profile); `ASC_KEY_PDF_BASE64` holds a .p8 despite its name (documented).
- D keeps `app_updater` available on Android (sideload self-update) — iOS-only hiding, per "no Android degradation".
- F: `signIn`/`register` now throw on failure (previously swallowed) so LoginModal renders errors; server deletion handler extracted to testable `deleteAccountHandler`.
- C: no fields added to `aiBillingConsent.ts` (read-only consumption) — no B↔C field coordination debt materialized; DiskSpace/SystemBootTime Required-Reason APIs deliberately omitted pending archive symbol audit.

**Blockers found & owners:**
- No Xcode/iphoneos SDK on the dev machine: blocks all *execution* verifications — A 1.5/2.5/3.5/4.5/5.5, B 1.3/7.2, C 2.1/2.3/2.4/5.3/6.1/6.2, D 4.2/6.3, E 4.4/5.x. Runbook ready (one command per stage); physical-device evidence belongs to the owning proposals + G's wave.
- B: Apple Root CA G3 fingerprint constant must be confirmed against Apple's published root list before production sign-off (env-overridable meanwhile). Owner: B.
- C: finalize `store_transactions` disclosure wording now that B's real flows are known (flow facts recorded in B's report). Owner: C (small follow-up).
- E: `shareProvenance` applied to text-note imports only; URL/file-import metadata hook needs a documentStore change outside E's ownership. Owner: E + document-store owners.
- Pre-existing failures on main, NOT introduced this session (verified against pre-session commit): `precisionScheduler.test.ts` SM-20 fixture mismatch; `prefetchCommonTabs` mock unhandled rejections in MainLayout tests; server tsc errors (`capture.ts`, `video-extracts.ts`); ~20 cargo sherpa/tts test-compile errors. Owners: unrelated to A–H; flagged for general triage.

**Post-merge integration gate (this session):** `tsc --noEmit` clean · eslint 0 errors · vitest 4840 passed / 1 failed (the pre-existing precisionScheduler fixture) · server tests 46/46 · `test:scripts` 149 pass / 0 fail.

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
