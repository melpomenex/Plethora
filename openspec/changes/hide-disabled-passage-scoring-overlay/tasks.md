## 1. Regression Coverage

- [x] 1.1 Extend the reader integration harness to simulate remote authorization denial and assert the warning is visible while passage scoring is enabled; rerender with scoring disabled and verify the warning and overlay disappear immediately.
- [x] 1.2 Add coverage that an enabled feature still displays its model-unavailable warning when readiness is not ready; verify the warning is hidden when the explicit feature toggle is false.

## 2. Hook State and Presentation

- [x] 2.1 Gate the surfaced status reason and overlay visibility on `featureEnabled`, while retaining readiness warnings for enabled scoring; verify the authorization and model-readiness integration cases pass.
- [x] 2.2 When `featureEnabled` becomes false, clear the status reason, set status to `disabled`, empty scoring results, and clear the open passage; verify the disable transition and existing disabled-no-work scenario pass.
