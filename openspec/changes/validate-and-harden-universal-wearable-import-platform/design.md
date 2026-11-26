## Context

Every requirement in the universal import platform must be backed by automated tests and measured benchmarks rather than assumptions.

## Goals / Non-Goals

- **Goals:**
  - Verify zero leakage of imported wearable data into `plethora.db`, `semantic_chunks`, `sync_outbox`, or application logs.
  - Measure actual peak RSS / processing time / records-per-second on synthetic >50 MB Apple Health XML and multi-year CSV/ZIP archives.
  - Provide truthful capability matrix documentation distinguishing `Documented`, `Implemented`, `Fixture-tested`, `Verified against actual consumer exports`, `Partial`, `Bridge-required`, and `Unsupported`.
- **Non-Goals:**
  - Do not commit real private health data as test fixtures.

## Decisions

- **Optional Desktop Folder Watcher:** Implemented as an explicit opt-in setting on desktop (`integrations.health.watched_folder`) that polls/checks a user-chosen folder for stable (non-growing) supported exports, never deletes source files, and records processed file hashes idempotently. Truthfully disabled on mobile (`android`/`ios`).
