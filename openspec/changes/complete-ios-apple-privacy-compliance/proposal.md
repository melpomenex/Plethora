## Why

Plethora has a genuinely useful privacy architecture — `src/types/privacy.ts` and `src/lib/privacy/disclosureRegistry.ts` model eight disclosures (cloud sync, backup, AI, document processing, TTS, transcription, web capture, telemetry) with egress triggers, encryption state, and local fallbacks, enforced by `privacyCompleteness.test.ts` against `docs/PRIVACY_ARCHITECTURE.md`. But the Apple-specific packaging layer does not exist:

- **No `PrivacyInfo.xcprivacy` exists anywhere in the repo** (verified by repo-wide search). Apple requires a privacy manifest for apps using Required Reason APIs; without it the production archive is not submission-ready.
- **The disclosure registry is never rendered to users.** Its only consumers are its own tests. The Settings → Privacy tab shows a static "Zero-Knowledge Privacy Guarantee" card, JSON export, and account deletion — it does not iterate `DISCLOSURE_REGISTRY`, and no component reads `isLocalOnly`.
- The `telemetry_crash_reporting` disclosure describes an aspirational opt-in endpoint that ships nothing today — while the only real third-party analytics (`@vercel/analytics` in `src/main.tsx`) loads on web/PWA builds and is covered by **no** disclosure entry.
- Cloud-AI consent currently lives implicitly in billing-consent flags (`src/utils/aiBillingConsent.ts`: paid embeddings/TTS default-off) and BYO API keys (`AIProviderSettings.tsx`). There is no first-use disclosure of what content leaves the device, to which provider, and why.
- No iOS Info.plist or purpose strings exist at all (`tauri.ios.conf.json` is essentially empty); Android's commented AndroidManifest entries are the only precedent.

Apple review checks privacy manifests, nutrition labels matching actual data flows, accurate purpose strings, and third-party AI disclosure. These must be built on the existing registry rather than duplicated.

## What Changes

- Add a correct `PrivacyInfo.xcprivacy` to the iOS target: audit the production archive/dependency graph for Required Reason API usage (e.g., UserDefaults via Tauri/plugins, file timestamps, disk space, system boot time where applicable), assign approved reason codes that match actual usage, validate against a real archive.
- Create a reproducible mapping from the internal disclosure registry (+ Proposal B's transaction data flows) to App Store Connect privacy nutrition label answers.
- Build an in-app Privacy Center that renders the existing disclosure registry, including per-provider AI data-flow disclosure with first-use consent for cloud AI transmission and persistent preferences.
- Audit every iOS permission the app can trigger (notifications, microphone, camera/photo picker, background audio, local network if applicable), add accurate purpose strings via Proposal A's overrides mechanism, and enforce contextual (not launch-time) permission requests.
- Correct the telemetry picture: either cover Vercel Analytics in the disclosure set (web builds) or remove it from store-relevant surfaces, and make the crash-reporting disclosure match reality (nothing ships today).
- Add privacy/compliance tests and archive-level validation evidence.

## Capabilities

### New Capabilities

- `apple-privacy-compliance`: iOS privacy manifest, App Store privacy-label traceability, permissions purpose strings, AI disclosure UX, and telemetry accuracy.

### Modified Capabilities

None.

## Impact

- New: `src-tauri/gen/apple/**/PrivacyInfo.xcprivacy` (injected via A's overrides script as agreed data), purpose-string inputs.
- `src/lib/privacy/disclosureRegistry.ts` + `src/types/privacy.ts` (extend entries; do not redesign the model), new `src/components/settings/PrivacyCenter.tsx`, `SettingsPage.tsx` privacy tab wiring.
- `src/utils/aiBillingConsent.ts` / AI provider settings (consent persistence integration — narrow).
- `docs/PRIVACY_ARCHITECTURE.md` + `privacyCompleteness.test.ts` (extended coverage).
- Server: none expected beyond consuming B's documented data flows read-only.

**Owns:** everything above.
**Must NOT change:** build pipeline internals (A — C supplies data: manifest file path + plist key/value pairs), billing behavior (B), capability gating (D), account deletion flow logic (F — C covers only its disclosure/copy aspects).

## Dependencies

- **Hard:** none blocking start. Archive-level validation (tasks §5) needs A's archive output; B's final data flows feed two registry entries (transactions, ASNS) — draft them now, finalize when B lands.
- **Soft:** A's Info.plist injection contract (see ownership below).

## Parallelization Notes

C is parallel-safe with B/D/E/F. Collision risks: `gen/apple` (A owns; C contributes via the agreed data-input contract, not direct edits), `SettingsPage.tsx` (D also touches for gating; C confines edits to the privacy tab section), `aiBillingConsent.ts` (B touches paywall consent adjacent code; C adds disclosure-gating around it — coordinate field names).

## Migration / Backward Compatibility

Registry additions are additive; `privacyCompleteness.test.ts` assertions extended, not weakened. Existing user settings untouched; new consent preferences default to "ask once at first use" for cloud AI features users explicitly invoke.

## Risks

- Required Reason API usage depends on the compiled dependency graph (Tauri runtime, plugins, Rust std) — must be determined from the actual archive, not source grep alone; Apple's reason-code catalog must be re-checked at implementation time since it evolves.
- Over-declaring in the manifest is itself a review risk; entries must be evidence-backed.
- Nutrition labels are manual entry in App Store Connect; reproducibility comes from the mapping document + checklist, not automation.
