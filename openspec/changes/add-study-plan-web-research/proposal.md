## Why

An AI Knowledge Only plan is useful before learners find materials, but its generated claims and practice are unverified. Learners who want external references need a separately authorized way to research, inspect, and verify them without sending their library or promoting past scores.

## What Changes

- Add opt-in Web Research to AI Knowledge Only as a separate, bounded action with its own query, destination, and cost disclosure.
- Let users review external snapshots and claim-level citations; distinguish fetched, accepted, and independently verified support.
- Permit newly verified questions only through the existing assessment publication gate or its explicit external-evidence adapter. Preserve old unverified attempts and their original provenance.
- Builds on `add-study-plan-knowledge-policies` (PRD SP-20). Lesson and Plan Home integration can follow their respective changes.

## Capabilities

### New Capabilities

- `study-plan-web-research`: Authorized external research, revisioned provenance, and explicit verification of new assessment revisions.

### Modified Capabilities

## Impact

Study Plan creation/preview, search and fetch adapters, source snapshot storage, policy/preflight, citation navigation, and assessment verification.
