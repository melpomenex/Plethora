## 1. Registry Extensions and Truthing

- [ ] 1.1 Add a `store_transactions` disclosure entry reflecting Proposal B's actual flows (transaction identifiers/signed payloads to Plethora server over TLS; retention for accounting/refunds; userDeletable=false for minimal records with documented rationale). Finalize wording against B's landed implementation.
- [ ] 1.2 Resolve the telemetry discrepancy: add a `web_analytics` entry covering Vercel Analytics on web/PWA builds (or remove it from store-relevant builds per design §6) and correct/remove `telemetry_crash_reporting` so it matches shipped behavior.
- [ ] 1.3 Extend `privacyCompleteness.test.ts` to enforce: every registry id documented, new fields present, no disclosure claiming behavior that a code search contradicts (spot-list of assertions).
- [ ] 1.4 Surface the existing `isCloudEligible`/`isLocalOnly` shield as a functional user control where cloud eligibility applies (documented placement).

## 2. Privacy Manifest

- [ ] 2.1 Produce the production iOS archive (with Proposal A) and audit linked libraries + runtime usage for Apple Required Reason APIs; record the evidence (which APIs, from which dependency) in `docs/release/ios-privacy-manifest-audit.md`.
- [ ] 2.2 Author `PrivacyInfo.xcprivacy` source (checked-in data file consumed by A's overrides script) with only evidenced categories and Apple-approved reason codes verified against Apple's current catalog at implementation time.
- [ ] 2.3 Audit third-party dependencies' manifests (Tauri/wry/plugins ship their own where applicable); ensure aggregation is correct and no duplicate/contradictory declarations.
- [ ] 2.4 **Verification:** exported archive contains the manifest; `altool` validation passes with no privacy-manifest warnings; evidence recorded.

## 3. App Privacy Nutrition Label Mapping

- [ ] 3.1 Extend registry entries with label-mapping fields (data types, linked-identity tracking flags, purposes) per design §2.
- [ ] 3.2 Create the generator/checklist that emits an App Store Connect questionnaire draft from the registry; snapshot-test it.
- [ ] 3.3 Write the mapping document (`docs/release/ios-privacy-labels.md`): registry id → label answer → evidence pointer. Keep registry, docs, and draft in sync by test.

## 4. Privacy Center and AI Disclosure UX

- [ ] 4.1 Build `PrivacyCenter` in Settings → Privacy rendering all registry disclosures grouped by category with state and local-fallback information; wire into `SettingsPage.tsx` privacy tab (coordinate merge order with Proposal D).
- [ ] 4.2 Implement the cloud-AI first-use disclosure per design §4: content requirements, once-per-provider-class persistence, local-provider exemption, provider-class-change re-prompt. Unit tests for trigger/persistence logic.
- [ ] 4.3 Add the disclosure trigger to the cloud-AI entry points (summaries, flashcard generation, embeddings, transcription, TTS) without altering their behavior when consent exists; coordinate `aiBillingConsent.ts` field additions with Proposal B.

## 5. Permissions and Purpose Strings

- [ ] 5.1 Produce the iOS permission inventory (notifications, microphone, camera/photo, background audio if verified, any plugin-triggered) with the triggering feature for each; publish as part of the audit doc.
- [ ] 5.2 Author accurate, user-oriented purpose strings for every declared permission; deliver as data via A's overrides contract. No permission without a shipped feature; no feature-triggered permission without a string.
- [ ] 5.3 Verify contextual-request behavior: notifications requested on first relevant action, microphone on first dictation use, camera on first scan — never at launch. Add a checklist item + recorded manual evidence.
- [ ] 5.4 Remove/justify any declared-but-unused capability (e.g., do not declare background audio unless audio playback genuinely requires it).

## 6. Verification

- [ ] 6.1 Simulator verification: Privacy Center renders all entries; AI disclosure fires once per provider class; no launch-time prompts.
- [ ] 6.2 Archive validation evidence (from §2.4) recorded in the evidence location defined by Proposal G.
- [ ] 6.3 Documentation correction: ensure `docs/PRIVACY_ARCHITECTURE.md` matches final shipped behavior; note any prior claims corrected.
