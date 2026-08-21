## 1. Registry Extensions and Truthing

- [x] 1.1 Add a `store_transactions` disclosure entry reflecting Proposal B's actual flows (transaction identifiers/signed payloads to Plethora server over TLS; retention for accounting/refunds; userDeletable=false for minimal records with documented rationale). Finalize wording against B's landed implementation.
  - Done as DRAFT per B's documented planned flows (StoreKit 2 JWS → Plethora server over TLS; ASNS server-side). Registry entry carries a contingency comment; destination/retention strings must be revisited when B merges (`privacyCompleteness.test.ts` pins the current contract). Label answer ("Purchases · linked · app functionality") is stable.
- [x] 1.2 Resolve the telemetry discrepancy: add a `web_analytics` entry covering Vercel Analytics on web/PWA builds (or remove it from store-relevant builds per design §6) and correct/remove `telemetry_crash_reporting` so it matches shipped behavior.
  - Kept Vercel Analytics (web/PWA-only, `!isTauri()` gate asserted by test) and disclosed it as `web_analytics`; `telemetry_crash_reporting` rewritten to record that NO crash/telemetry SDK ships today (dependency sweep enforced by `privacyCompleteness.test.ts`).
- [x] 1.3 Extend `privacyCompleteness.test.ts` to enforce: every registry id documented, new fields present, no disclosure claiming behavior that a code search contradicts (spot-list of assertions).
- [x] 1.4 Surface the existing `isCloudEligible`/`isLocalOnly` shield as a functional user control where cloud eligibility applies (documented placement).
  - Placed as a per-document "Local-Only Shield" toggle in the item-details popover (`src/components/settings/LocalOnlyShieldToggle.tsx`, document targets); placement documented in `docs/PRIVACY_ARCHITECTURE.md` §3.

## 2. Privacy Manifest

- [ ] 2.1 Produce the production iOS archive (with Proposal A) and audit linked libraries + runtime usage for Apple Required Reason APIs; record the evidence (which APIs, from which dependency) in `docs/release/ios-privacy-manifest-audit.md`.
  - **BLOCKED on Change A §4** (no signed/exported archive exists yet). Audit doc created with full methodology, source-stage evidence table, and ⏳ markers for every archive-dependent claim. Re-verify symbols against the archive when A's pipeline yields one.
- [x] 2.2 Author `PrivacyInfo.xcprivacy` source (checked-in data file consumed by A's overrides script) with only evidenced categories and Apple-approved reason codes verified against Apple's current catalog at implementation time.
  - Checked-in at `src-tauri/ios-assets/PrivacyInfo.xcprivacy`; delivered via `scripts/ios-overrides/privacy-manifest.json` (`privacyManifestSourcePath`). Only UserDefaults (CA92.1) + FileTimestamp (C617.1, 3B52.1) declared; DiskSpace/SystemBootTime deliberately omitted absent evidence. Reason codes verified against developer.apple.com "Describing use of required reason API" on 2026-08-21.
- [ ] 2.3 Audit third-party dependencies' manifests (Tauri/wry/plugins ship their own where applicable); ensure aggregation is correct and no duplicate/contradictory declarations.
  - Source-stage review recorded in `docs/release/ios-privacy-manifest-audit.md` §4; **archive-time aggregation check pending A** (embedded-framework manifest sweep).
- [ ] 2.4 **Verification:** exported archive contains the manifest; `altool` validation passes with no privacy-manifest warnings; evidence recorded.
  - **PENDING Change A §4 pipeline** — run the steps in `docs/release/ios-privacy-manifest-audit.md` §8 once an archive exists; record evidence per G's schema.

## 3. App Privacy Nutrition Label Mapping

- [x] 3.1 Extend registry entries with label-mapping fields (data types, linked-identity tracking flags, purposes) per design §2.
- [x] 3.2 Create the generator/checklist that emits an App Store Connect questionnaire draft from the registry; snapshot-test it.
  - `src/lib/privacy/labelMapping.ts` + snapshot test in `src/lib/privacy/__tests__/labelMapping.test.ts`.
- [x] 3.3 Write the mapping document (`docs/release/ios-privacy-labels.md`): registry id → label answer → evidence pointer. Keep registry, docs, and draft in sync by test.
  - Sync enforced by `labelMapping.test.ts` (every registry id must appear in the doc).

## 4. Privacy Center and AI Disclosure UX

- [x] 4.1 Build `PrivacyCenter` in Settings → Privacy rendering all registry disclosures grouped by category with state and local-fallback information; wire into `SettingsPage.tsx` privacy tab (coordinate merge order with Proposal D).
  - Lazy-loaded inside the privacy tab section only (no section renumbering); render-tested.
- [x] 4.2 Implement the cloud-AI first-use disclosure per design §4: content requirements, once-per-provider-class persistence, local-provider exemption, provider-class-change re-prompt. Unit tests for trigger/persistence logic.
  - `src/lib/privacy/cloudAiDisclosure.ts` (+ UI presenter in `cloudAiDisclosureUi.ts`, registered at app shell in `src/main.tsx`); 8 unit tests cover trigger/persistence/re-prompt/local-exemption/storage-failure degradation.
- [x] 4.3 Add the disclosure trigger to the cloud-AI entry points (summaries, flashcard generation, embeddings, transcription, TTS) without altering their behavior when consent exists; coordinate `aiBillingConsent.ts` field additions with Proposal B.
  - Wired at: `runAiAction` cloud path (all AI actions), `buildSemanticGraph` cloud embeddings, both `useTTS` cloud gates (pre-loop + backstop), `transcribeWithGroq`, and cluster `enqueueAutoTranscription`. Local/keyless destinations exempt; acknowledged provider classes proceed unchanged. No fields added to `aiBillingConsent.ts` — C reads its exported provider sets read-only; zero semantic changes (B-coordination note: none required).

## 5. Permissions and Purpose Strings

- [x] 5.1 Produce the iOS permission inventory (notifications, microphone, camera/photo, background audio if verified, any plugin-triggered) with the triggering feature for each; publish as part of the audit doc.
  - `docs/release/ios-privacy-manifest-audit.md` §5.
- [x] 5.2 Author accurate, user-oriented purpose strings for every declared permission; deliver as data via A's overrides contract. No permission without a shipped feature; no feature-triggered permission without a string.
  - Camera + microphone strings in `scripts/ios-overrides/privacy-manifest.json` (`purposeStrings`); contract pinned by `src/lib/privacy/__tests__/iosPurposeStrings.test.ts`.
- [ ] 5.3 Verify contextual-request behavior: notifications requested on first relevant action, microphone on first dictation use, camera on first scan — never at launch. Add a checklist item + recorded manual evidence.
  - Checklist written (audit doc §6); **recorded manual evidence requires an installable build from A** — cannot be produced at source stage.
- [x] 5.4 Remove/justify any declared-but-unused capability (e.g., do not declare background audio unless audio playback genuinely requires it).
  - Dispositions in audit doc §7 (background audio / local network / location / push NOT declared; entitlement/plist edits applied by A).

## 6. Verification

- [ ] 6.1 Simulator verification: Privacy Center renders all entries; AI disclosure fires once per provider class; no launch-time prompts.
  - **Cannot be executed at source stage** (requires simulator + A's build). Logic covered by unit/render tests (`PrivacyCenter.test.tsx`, `cloudAiDisclosure.test.ts`); manual pass remains.
- [ ] 6.2 Archive validation evidence (from §2.4) recorded in the evidence location defined by Proposal G.
  - **PENDING A's archive + G's evidence schema.**
- [x] 6.3 Documentation correction: ensure `docs/PRIVACY_ARCHITECTURE.md` matches final shipped behavior; note any prior claims corrected.
  - Registry table updated (`store_transactions`, `web_analytics`, corrected telemetry row) with an explicit correction log noting the previously aspirational crash-reporting claims.
