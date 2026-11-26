# Verification: Integrate Study Mode Adaptive Remediation

- Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml learning_evidence` verifying misconception resolution parity.
- Frontend tests: `npx vitest run src/lib/study-plans/evidence/` and `StudyModeRemediation.test.tsx`.
- Strict OpenSpec validation: `openspec validate integrate-study-mode-adaptive-remediation --strict`.
