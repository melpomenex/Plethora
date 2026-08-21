## Context

- Current "verification" state: CI `ios-build` job produces simulator-or-signed artifacts with logs; no device testing records, no TestFlight history, no scenario suite exist. Prior claims of TestFlight dry runs are false (verified).
- Honest precedent: `docs/release/PLETHORA_1_0_RC_FINDINGS.md` (F-33) lists TestFlight/device-matrix verification as open; `docs/release/PLETHORA_1_0_HUMAN_LAUNCH_CHECKLIST.md` correctly tracks human Apple-side prerequisites as unchecked.
- Existing artifact patterns to mirror: `.bench/results.json` upload in `ci-regression.yml`; release scripts produce machine-readable outputs.
- Inputs consumed from other proposals: A's archive/validation/upload logs + build numbers; B's sandbox matrix and transaction references; C's privacy validation results; D's surface walkthrough; E's share flows; F's lifecycle matrix.

## Goals / Non-Goals

**Goals:**

- Anyone can determine, from committed evidence, exactly what has been verified on which hardware/build — and what hasn't.
- The golden path passes on physical iPhone and iPad against a TestFlight build before submission.
- Launch blockers are enumerable and each carries a disposition.

**Non-Goals:**

- Automated UI test framework adoption (Playwright exists for web; native iOS automation is out of scope for v1 — scenarios are structured manual runs with evidence).
- Fixing defects found by scenarios (filed to owning proposals).
- Android release gates (separable later work reusing the schema).

## Decisions

### 1. Scenario suite
Golden path (numbered, ordered, resumable): fresh install → launch → local use without account → import EPUB → open → read → close → relaunch → position restored → select/highlight → extract → flashcard → Queue/Review surfaces it → review → close/reopen → scheduling correct → airplane mode → readable → reviewable → reconnect → sign in → sync → sandbox Pro purchase → terminate → relaunch entitlement retained → restore second device → account deletion → deleted login rejected. Variations: PDF / large PDF / scanned PDF (if supported) / EPUB / imported article × iPhone / iPad.

Lifecycle/stress: foreground↔background, lock/unlock, rotation, memory pressure, denied permissions, connectivity loss mid-operation, offline launch, large library/files, keyboard appear/dismiss, Dynamic Type, VoiceOver smoke, Reduce Motion, light/dark, safe areas, long TTS sessions (where supported).

### 2. Evidence model
`evidence/ios/` directory convention: one JSON run record per session (`{runId, date, ciRunId?, buildNumber, testFlightBuildNumber?, deviceModel, iosVersion, scenarios:[{id, status: pass|fail|blocked|skipped, notes?, artifactRefs?}], tester, redacted:true}`) plus referenced screenshots under `evidence/ios/media/`. Tracked in git: schema, templates, and sanitized records. Gitignored-by-default pattern for raw media with explicit opt-in commits after sanitization; a check script rejects records missing required fields or containing common personal-data patterns (emails, serials). Sandbox transaction ids recorded only in Apple-obfuscated form where applicable.

### 3. Verification ladder
Every launch-blocking claim maps to the ladder: designed → implemented → automated tests pass → simulator verified → physical-device verified → TestFlight-distributed verified → ASC validation passed. The gate checklist requires level ≥6 for all P0 scenarios. Task documents may mark `[x]` only at the achieved level with an evidence pointer.

### 4. Release gate
`docs/release/ios-release-gate.md`: the submission checklist enumerating every P0 item across all proposals (archive validates, devices verified, StoreKit products load/purchase/restore, no mock billing, deletion works, manifest validates, labels accurate, core offline path passes, accessibility smoke, TestFlight installed/tested, evidence recorded) each requiring an evidence reference; open items require explicit disposition (accepted-deferred with rationale).

### 5. TestFlight process
Internal-tester round mandatory; small external round recommended pre-review. Final screenshots/reviewer validation MUST come from the exact distributed RC build (build number recorded in evidence).

## Data Flows

CI artifacts (A) → referenced by run records. Sandbox transactions (B) → obfuscated references. Findings → filed against owning proposals' task lists; this proposal never patches implementation code.

## Failure Behavior

Any scenario failure blocks the gate until fixed (owning proposal) or explicitly dispositioned. Missing evidence = not done, regardless of code state.

## Testing Strategy

Schema validation script for run records; checklist linter (every gate line links evidence or disposition); manual execution per scenario docs. The "test" of this proposal is a completed, green evidence set for an RC build.

## Rollout

Schema + docs immediately; first full execution during Wave 3 on the first TestFlight build; repeat per RC.

## Alternatives Considered

- XCUITest automation now: deferred — setup cost vs. one-shot submission; revisit post-launch.
- Third-party test-management SaaS: rejected — evidence must live in-repo for traceability.

## Rejected Alternatives / Notes

Committing raw device screenshots by default: rejected — personal-data risk; sanitized media only.

## Ownership & Collision Boundaries

| File/area | Owner | Notes |
|---|---|---|
| `docs/release/ios-*` scenario/gate docs, `evidence/` schema/templates | **G exclusively** |
| CI artifact naming | G defines names; **A applies them** in its job (one-line diffs) |
| All implementation code | NOT G | findings filed back to owners |

**Integration order:** G executes only after A+B+F declare their verification levels; C/D/E evidence slots defined upfront so their completion feeds directly in.
