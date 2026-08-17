# Design — RC Audit & Launch Hardening

## Context

Plethora 2.x has commercial infrastructure (accounts, entitlements, paywalls, cloud jobs, E2EE sync, store-readiness change 14/14) but recent integrations needed follow-up fixes. `docs/RELEASE_CHECKLIST.md` and CI gates exist (`test:run`, `cargo test`, `bench:check`, `build:check`, `test:scripts`, `test:browser-extension`). This change is verification + bounded fixing, ending in an RC sign-off and a human-only launch checklist.

## Goals / Non-Goals

**Goals:** exercise first-run + commercial workflows as integrated systems; classify findings P0–P3; fix P0/P1 + selected P2; leave green gates and two documents (findings log, human launch checklist).

**Non-Goals:** new features (A–D excepted); weakening any gate; replacing human judgment on legal/business items.

## Decisions

1. **Static-first audit where automation is impossible**: code-level verification of wiring (entitlement gates not frontend-only, local-only egress guards, deletion/export completeness) via targeted greps + existing tests; documented as findings with evidence. Runtime device-matrix testing items that cannot be exercised headlessly are listed in the findings doc as pending-manual with exact steps.
2. **Findings doc schema**: `docs/release/PLETHORA_1_0_RC_FINDINGS.md` — ID, area, severity, evidence, disposition (fixed commit / deferred rationale / manual-verification steps).
3. **Human checklist discipline**: `docs/release/PLETHORA_1_0_HUMAN_LAUNCH_CHECKLIST.md` contains only tasks requiring humans/external parties (entity/legal/tax, store enrollments, screenshots, submissions); engineering tasks are rejected from this file.
4. **Artifact sweep allowlist**: TODO/FIXME/mock/stub hits in release-reachable code are triaged; tests/dev-only files documented as allowed.
5. **Gate runs are the RC definition**: RC = all listed gates green + zero open P0/P1 + human checklist published.

## Risks / Trade-offs

- [Audit theater] → every finding needs evidence (file:line or failing command) and a disposition.
- [Scope creep] → feature-freeze rule: fixes only for P0/P1/selected P2; everything else recorded.

## Migration Plan

N/A.

## Open Questions

None.
