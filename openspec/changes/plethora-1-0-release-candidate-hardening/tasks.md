## 1. Audit

- [ ] 1.1 First-run journey + commercial workflow static audit (auth, entitlements, paywalls, cloud jobs, sync, local-only, deletion, export); record findings P0–P3
- [ ] 1.2 Release-artifact sweep (dev endpoints, mocks/stubs, placeholders, debug menus, temp flags) with triage
- [ ] 1.3 Error-path exercise list with dispositions (runtime-testable items get steps; code-verified items get evidence)
- [ ] 1.4 Brand/name consistency pass over A+B outputs (store surfaces, handbooks, notifications)

## 2. Fixes

- [ ] 2.1 Fix P0/P1 findings; selected P2 polish
- [ ] 2.2 Record deferrals with rationale

## 3. Gates & deliverables

- [ ] 3.1 Run full gate set (`test:run`, `cargo test`, `bench:check`, `build:check`, `test:scripts`, `test:browser-extension`, i18n completeness); fix failures
- [ ] 3.2 Write `docs/release/PLETHORA_1_0_RC_FINDINGS.md`
- [ ] 3.3 Write `docs/release/PLETHORA_1_0_HUMAN_LAUNCH_CHECKLIST.md` (human/external tasks only)
