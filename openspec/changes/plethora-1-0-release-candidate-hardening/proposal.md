# Plethora 1.0 — Proposal E: Release-Candidate Audit & Launch Hardening

## Why

Recent large integration commits required follow-up fixes, so "implemented" ≠ "release ready". This change establishes the Plethora 1.0 RC state through verification and targeted fixes only — a feature freeze applies (Proposals A–D are the approved exceptions) — and converts remaining launch work into a finite, human-owned checklist.

## What Changes

- **Audit, not build**: run the complete first-run journey and critical commercial workflows (auth, subscription/entitlements, paywalls, cloud jobs/quotas, sync, local-only mode, account deletion, export) against the real app; classify findings P0–P3; fix P0/P1 and selected P2 only.
- **Artifact sweep**: repository search for release-dangerous artifacts (dev endpoints, mocks/stubs reachable in release builds, placeholder legal URLs, debug menus, temporary flags) with remediation or documented justification per hit.
- **Error-path exercises**: corrupt/malformed inputs (EPUB, PDF, RSS, images), failed AI/TTS/transcription, invalid auth, extension-unreachable — verify messages are actionable.
- **Brand + naming consistency pass**: verify A and B landed everywhere (store surfaces, notifications, tray, deep links, handbooks).
- **Gate verification**: `test:run`, `cargo test`, `bench:check`, `build:check`, `test:scripts`, `test:browser-extension`, localization completeness, mobile build config sanity. Fix gate failures; do not weaken gates.
- **Deliverable**: `docs/release/PLETHORA_1_0_HUMAN_LAUNCH_CHECKLIST.md` — only genuinely human/external tasks (legal entity, tax, store enrollments, screenshots, submissions), no engineering work mixed in.
- Findings log: `docs/release/PLETHORA_1_0_RC_FINDINGS.md` with P0–P3 classification and disposition (fixed / deferred with rationale).

## Capabilities

### New Capabilities
- `release-candidate-gate`: definition of the reproducible RC gate — which checks must pass, what the findings log must contain, and what the human launch checklist may/may not include.

### Modified Capabilities
- None (fixes to existing capabilities are recorded as findings, not spec changes, unless behavioral contracts change).

## Impact

- Primarily verification + targeted fixes across existing code; new docs under `docs/release/`. Depends on A–D being implemented first so the audit covers their final state.

Cross-references: final phase of the Plethora 1.0 initiative; consumes outputs of all other proposals.
