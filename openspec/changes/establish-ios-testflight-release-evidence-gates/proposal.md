## Why

OpenSpec checkboxes alone must not be able to declare iOS "ready." Today nothing prevents that: `prepare-plethora-for-apple-app-store-and-google-play-commercial-release/tasks.md` is fully `[x]` including TestFlight dry runs that never happened, while the repo contains no `gen/apple`, no TestFlight upload tooling, and no device-verification records. The honest counter-example already in-repo — `docs/release/PLETHORA_1_0_RC_FINDINGS.md` listing TestFlight/device-matrix verification as open P3 — shows the team wants evidence, not assertions. This proposal builds the verification system: a golden-path scenario suite run on real hardware against TestFlight-distributed builds, with durable, reviewable evidence artifacts and an explicit completion ladder (designed → implemented → tests pass → simulator → physical device → TestFlight → ASC validation).

## What Changes

- Define the golden-path scenario suite for iOS: fresh install through import/read/extract/review/offline/sync/purchase/restore/deletion, with per-format variations (PDF, large PDF, EPUB, article) and iPhone/iPad.
- Define lifecycle/stress scenarios: backgrounding, screen lock, rotation, memory pressure, denied permissions, connectivity loss, offline launch, large libraries, keyboard, Dynamic Type/VoiceOver/Reduce Motion/light-dark/safe areas, long-running TTS where supported.
- Create the evidence model and durable storage location: structured run records (CI run id, build/TestFlight build numbers, device model, iOS version, scenario pass/fail, screenshots, sandbox transaction references where safe) committed under a gitignored-personal-data policy with sanitized templates tracked.
- Wire CI artifact naming/consumption so pipeline outputs (archives, validation logs) feed evidence records; define the release-gate checklist that must be green before App Store submission.

## Capabilities

### New Capabilities

- `ios-release-evidence-gates`: Reproducible physical-device/TestFlight verification scenarios, evidence artifacts, and the submission gate definition.

### Modified Capabilities

None.

## Impact

- New: `docs/release/ios-golden-path.md` (scenarios), `evidence/` convention (tracked templates + schema; actual runs stored per policy), `docs/release/ios-release-gate.md` (submission checklist).
- `.github/workflows/mobile-build.yml`: artifact naming alignment only (coordinate with A — A owns the job; G owns names/schema consumed by it).
- Read-only consumption of every other proposal's outputs.

**Owns:** scenario definitions, evidence schema/storage rules, gate checklist.
**Must NOT change:** any implementation code, build mechanics, billing/privacy/gating behavior. If scenarios reveal defects, they file findings back to owning proposals rather than fixing them here.

## Dependencies

- **Hard:** A (TestFlight build exists), B (sandbox purchase scenarios), F (account/deletion scenarios). Scenario authoring can start immediately; execution depends on those landing.
- **Soft:** C (privacy validation evidence), D (surface walkthrough), E (share scenarios).

## Parallelization Notes

G is deliberately last-executing but early-authorable. Scenario docs and evidence schema have no dependencies and can be written in Wave 1 alongside everyone else; only execution waits for Waves 1–2 integration.

## Migration / Backward Compatibility

Additive documentation/process only. No runtime changes.

## Risks

- Evidence rot: records must be cheap to produce or they won't be; templates + scripts must make a run record take minutes, not hours.
- Personal data leakage into committed evidence (screenshots with real accounts); sanitization rules required and enforced by review + a lint-style check for common patterns.
