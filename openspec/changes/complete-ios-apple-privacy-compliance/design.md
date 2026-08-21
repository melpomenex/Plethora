## Context

### Existing privacy architecture (verified)

- `src/types/privacy.ts`: `EncryptionState` ('none_local_only' | 'in_transit_tls' | 'stored_encrypted' | 'e2e_encrypted'), `DataEgressTrigger` ('never' | 'manual' | 'opt_in' | 'automatic' | 'scheduled'), `PrivacyDisclosure` (id, name, category ∈ core/ai/sync/media/integrations/telemetry, dataLeavesDevice, trigger, destination, retention, encryptionState, thirdPartyInvolvement, userDeletable, localFallback, description), plus `isCloudEligible(document)` enforcing an `isLocalOnly` shield that **no UI currently reads**.
- `src/lib/privacy/disclosureRegistry.ts`: 8 entries — `cloud_sync`, `cloud_backup`, `cloud_ai_intelligence` (destination "Plethora AI Gateway / Configured Model Provider"; third parties "OpenAI, Anthropic, DeepSeek, or OpenRouter (BYO key or Pro gateway)"; fallback "On-device EmbeddingGemma, Ollama, SQLite FTS5"), `cloud_document_processing` (OCR), `cloud_tts`, `cloud_transcription` (Whisper clusters), `cloud_web_capture`, `telemetry_crash_reporting` ("Opt-In… Disabled completely by default; zero egress").
- Consumer reality: only `src/__tests__/privacyCompleteness.test.ts` (asserts each id appears in `docs/PRIVACY_ARCHITECTURE.md`). The Settings → Privacy tab (`SettingsPage.tsx` ~1674–1779) renders a static zero-knowledge card + JSON export + account deletion; it does not iterate the registry. No "Privacy Center" exists.
- AI consent today: `src/utils/aiBillingConsent.ts` (`paidEmbeddingsEnabled` default false, `paidTtsEnabled` default false, `allowCloudFallback`); BYO keys via `AIProviderSettings.tsx` / `llmProvidersStore.ts` (keys in OS keychain); TTS includes a Plethora-hosted provider in `ttsSettings.ts`.
- Telemetry reality: `@vercel/analytics` `<Analytics />` renders when `!isTauri()` (web/PWA only) — always-on there, undisclosed anywhere. No Sentry/PostHog exists. `settingsStore.analyticsEnabled` defaults false and gates local analytics features.
- iOS: no Info.plist, no purpose strings, no privacy manifest. Android precedent: commented AndroidManifest permission entries (`RECORD_AUDIO` for voice features/getUserMedia, `CAMERA` gated at runtime in RustWebChromeClient for QR sync scanning, `INTERNET`, `REQUEST_INSTALL_PACKAGES`). Notification plugin wired with check/request commands (`lib.rs:877`).

## Goals / Non-Goals

**Goals:**

- A valid, archive-validated `PrivacyInfo.xcprivacy` covering actual Required Reason API usage of the compiled app.
- Nutrition-label answers traceable to the internal registry (one mapping doc, kept in sync by test).
- Users see what leaves their device, to whom, and why — once, contextually, with persistent preferences.
- Accurate purpose strings; contextual permission prompts only.
- Telemetry claims match shipping behavior.

**Non-Goals:**

- Redesigning the disclosure data model or the zero-knowledge sync architecture.
- Adding telemetry/crash reporting that doesn't exist today.
- Implementing StoreKit or its server verification (B) — C only registers B's resulting data flows.
- Account deletion flow changes (F).

## Decisions

### 1. Privacy manifest from evidence, not source grep
Process: build the production iOS archive (A), inspect the linked libraries and runtime API usage (`otool`/symbols + dependency docs for Tauri/wry/WebKit/plugins), enumerate Required Reason API categories actually used (likely candidates: UserDefaults via plugins, file timestamp APIs, disk space; verify each against Apple's current catalog), declare only evidenced categories with matching reason codes. The manifest file is generated into the project by A's overrides script from a checked-in source file owned by C (`src-tauri/ios-overrides/privacy-manifest.json` or equivalent agreed path). Validation: rebuild archive, confirm Xcode/`altool` acceptance and no manifest warnings.

### 2. Registry as nutrition-label source of truth
Extend `disclosureRegistry.ts` with the fields needed for label mapping (data types collected, linked vs not-linked tracking flags, purposes). Add a generator/checklist script emitting a filled App Store Connect questionnaire draft from registry entries; a test keeps `docs/PRIVACY_ARCHITECTURE.md`, the registry, and the emitted draft consistent. New entries required: store transactions (from B: transaction identifiers + signed payloads retained for accounting — userDeletable=false for minimal records, documented rationale), web/PWA analytics (Vercel) or its removal.

### 3. Privacy Center UI
New `PrivacyCenter` section in Settings → Privacy rendering all registry disclosures grouped by category, with per-disclosure state (enabled/BYO/local-only) where a control exists, links to docs, and export/delete actions surfaced next to relevant disclosures (deletion button itself remains F-owned). Surface the `isLocalOnly` shield as a real toggle where cloud eligibility applies.

### 4. Cloud-AI first-use disclosure
One-time modal (per provider category, not per action): shown the first time a user invokes a feature that transmits content to a configured cloud AI provider (summaries, flashcard generation, embeddings, transcription, TTS). Content: what content leaves the device, which provider receives it, why, whether it's BYO-key or Plethora-hosted, and the local alternative. Choice persisted (`aiBillingConsent`-adjacent store); "don't ask again" honored; re-prompt only when the destination provider class changes. Local-first providers (Ollama/on-device) never trigger it.

### 5. Permissions
Inventory on iOS: notifications (review reminders/import feedback — request contextually on first scheduling action, never at launch), microphone (voice dictation/language modes — request at first use of the feature), camera/photo (QR scan, image import — request at first use), background audio (only if audio editions/TTS playback requires it; declare `UIBackgroundModes audio` ONLY if verified as used), local network (unlikely — verify). Purpose strings written user-oriented ("Plethora uses the microphone only when you dictate pronunciation practice…"), injected via A's overrides contract. Add a launch-time audit asserting no permission prompt fires before user action (manual + recorded).

### 6. Telemetry truthing
Decide at implementation: keep Vercel Analytics on web/PWA and add a `web_analytics` disclosure entry (category telemetry, trigger automatic, destination Vercel, no document content), OR strip it from store-relevant builds. Default decision unless product objects: keep + disclose (web-only, never in native iOS bundle). Rewrite `telemetry_crash_reporting` description to match reality (no crash SDK ships) or remove if a crash reporter lands under a different proposal.

## Data Flows

Documented inputs to C (read-only consumption): B's flows (device→Apple purchases; device↔Plethora server transaction JWS over TLS; ASNS Apple→server), existing sync/AI/TTS/transcription/capture flows already modeled in the registry. Outputs: manifest file, purpose strings, registry entries, label mapping doc, consent preferences.

## Failure Behavior

- Missing/incomplete manifest at archive time → build validation task fails with pointer to the audit doc.
- Disclosure without matching docs entry → `privacyCompleteness.test.ts` fails (existing mechanism extended).
- Consent unavailable (storage failure) → cloud AI features degrade to asking every session rather than silently transmitting.

## Testing Strategy

- Unit: registry completeness (extended), label-mapping generator snapshot test, consent persistence, purpose-string presence test (parses overrides output for expected keys).
- Archive-level: manifest present in exported `.ipa`; validation clean.
- Manual: first-use AI disclosure appears exactly once per provider class; no launch-time permission prompts; Privacy Center renders all entries. Recorded as evidence (G's format).

## Rollout

Registry + Privacy Center can land immediately (pure frontend). Manifest/purpose strings land as data consumed by A's pipeline; final archive validation happens in G's TestFlight wave.

## Alternatives Considered

- Hand-writing xcprivacy directly in gen/apple: rejected — regenerating the project would lose it; must flow through the overrides contract.
- Third-party consent-management SDK: rejected — overkill; two consent surfaces (AI disclosure, telemetry) don't justify a dependency and its own privacy implications.

## Rejected Alternatives / Notes

- Auto-generating the entire App Store questionnaire via API: rejected for v1 — manual entry guided by a generated checklist is reproducible enough and avoids ASC API scope creep.

## Ownership & Collision Boundaries

| File/area | Owner | Notes |
|---|---|---|
| `src-tauri/gen/apple/**` | A owns; **C contributes via data files only** (`privacy-manifest.json`, plist key/value list consumed by A's override script) | never edit xcodeproj directly |
| `src/lib/privacy/**`, `src/types/privacy.ts`, `docs/PRIVACY_ARCHITECTURE.md`, `privacyCompleteness.test.ts` | **C** | B supplies flow facts read-only |
| `src/components/settings/PrivacyCenter.tsx` (new), SettingsPage privacy tab section | **C** | D gates the tab itself; coordinate merge order on SettingsPage |
| `src/utils/aiBillingConsent.ts` | shared | C adds disclosure gating fields; B owns billing-consent semantics — field-level coordination required |
| Permission purpose strings | C (content) via A's injection mechanism | E adds share-extension-specific strings separately |

**With D:** D treats "privacy center" and per-disclosure controls as externally-owned capabilities in its matrix; C does not add platform gating logic.
