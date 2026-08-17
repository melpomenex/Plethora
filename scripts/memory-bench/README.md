# memory-bench — memory benchmark harness (collector half)

Deterministic memory measurement for the Incrementum desktop app on Linux.
See `docs/memory-profile.md` for how memory is measured and why PSS, and
`openspec/changes/bound-runtime-memory-and-gate/` for the change that
introduced this.

## Layout (Phase 2, collector)

| Module | Purpose |
|---|---|
| `smaps-rollup.js` | Strict parser for `/proc/<pid>/smaps_rollup`. Fields: `Pss`, `Pss_Anon`, `Pss_File`, `Pss_Shmem`, `Private_Dirty`, `Rss`, `Swap`. Unknown/absent fields are `null`, never `0`; malformed input yields an attributed error. |
| `discovery.js` | Process discovery rooted at the launched PID: relationship by process group **and** ancestor chain, verified by the `PLETHORA_MEMORY_RUN_ID` marker in `/proc/<pid>/environ`. Role classification: `native`, `web-content`, `network`, `other`. |
| `sample.js` | Per-process sampling (`readProcessSample` — an exited process is recorded absent with a reason, never a failure) and tree aggregation (`aggregateSample` — total sums proportional fields only, never `Rss`). |
| `platform.js` | Platform gate: non-Linux or missing/unreadable `smaps_rollup` → unsupported environment (no result file). |
| `fixtures/` | Rollup fixture files used by the unit tests. |

Unit tests live in `scripts/__tests__/memoryBench{Smaps,Discovery,Sample}.test.mjs`
and run under `npm run test:scripts` (`node --test`).

## Design invariants (from design D3/D4 and the memory-benchmark-harness spec)

- A process is counted only when it carries the run-id marker — a foreign
  WebKitWebProcess with the same name is never counted.
- A field that cannot be parsed is **absent**, never defaulted to zero: a
  zero-valued default would read as an improvement, the worst failure mode for
  a memory gate.
- The tree total is a PSS-family sum; summing RSS would double-count the shared
  library text mapped by both the native and web processes.

The driver half of the harness (scenario stages, settle protocol, corpus,
result writer) is added in Phase 2's driver tasks.
