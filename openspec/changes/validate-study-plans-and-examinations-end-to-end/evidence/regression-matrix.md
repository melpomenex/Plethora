# C8-T09 regression matrix

- C6 targeted (evidence/gaps/remediation/API/UI): pass (51 + 40 + follow-ups in T08 gate)
- C7 targeted (diagnostics/practice/tutoring/remediation/API): pass (30 + 30 + 16 + 33 + follow-ups)
- C8 golden unit (fixtures/harness/golden/negative/boundaries/migrations/a11y): pass
- `test:wave5:regression` (review/FSRS): 9 files, 46 passed — scheduler isolation holds
- `test:scripts`, `docs:validate` (76 files), `check:bundle` (27.2 MB): pass
- `bench:check`: new study-plans baselines pass; 2 unrelated pre-existing failures untouched
- Rust targeted (`study_`, `exam_session`, `diagnostic`, `assessment_blueprint`, `migration_*`, `golden_test_support`): pass
- Full `cargo test --lib`: NOT COMPLETED (environment timeout)
- Global `tsc`: pre-existing unrelated errors only; touched files clean
- `openspec validate --all --strict`: 682 passed / 46 failed — all 46 pre-existing unrelated (program changes C1–C7 pass; C8 fails on skip_specs tooling)
- Native E2E / devices / paid providers: NOT RUN
