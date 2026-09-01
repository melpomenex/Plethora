# FSRS-7 Upstream Provenance

| Field | Value |
|-------|-------|
| **Upstream repository** | https://github.com/open-spaced-repetition/fsrs-rs |
| **Source fork** | https://github.com/JSchoreels/fsrs-rs |
| **Source branch** | `feature/fsrs-7-adr-optimization` |
| **Upstream PR** | https://github.com/open-spaced-repetition/fsrs-rs/pull/426 |
| **Exact commit** | `47fb3af98d434dceda9cdd9c4f28d3dc10237054` |
| **Date vendored** | 2026-09-01 |
| **License** | BSD-3-Clause |
| **Copyright** | Copyright (c) 2023, Open Spaced Repetition |

## Local patches

None. This directory is a pristine snapshot of the PR #426 head commit.

## Critical integration note

`FSRS::default()` and `FSRS::new(&[])` instantiate **FSRS-6** (21 parameters).
Production FSRS-7 requires explicit construction with 34 parameters:
`FSRS::new(&DEFAULT_PARAMETERS)` where `DEFAULT_PARAMETERS` is exported from `inference_v7.rs`.
