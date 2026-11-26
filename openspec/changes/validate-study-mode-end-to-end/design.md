# Design: Validate Study Mode End-to-End

## Data Model (Migration 165)

- `study_efficacy_events`: `id TEXT PRIMARY KEY`, `session_id TEXT`, `metric_kind TEXT NOT NULL`, `concept_id TEXT`, `score REAL`, `latency_ms INTEGER`, `cost_usd REAL`, `metadata_json TEXT NOT NULL DEFAULT '{}'`, `recorded_at TEXT NOT NULL`. Written only when `settings.studyMode.enableEfficacyMeasurement === true` (default `false`).

## Test Coverage Matrix

- Rust integration tests for migrations 162–165, fresh/upgrade DBs, authoritative grading, privacy, and FSRS isolation.
- Vitest integration suite `src/lib/study-plans/studyMode/__tests__/studyModeE2E.test.tsx` covering Scenarios A–L.
- Disabled-mode verification asserting zero AI calls and zero artifact writes when Study Mode is inactive or disabled.
