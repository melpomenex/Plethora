# Implementation review

Reviewed the final provider-only diff against `694cf983177e`. This is a
source-grounded self-review supported by the test/build results in `report.md`;
no independent reviewer or physical macOS/Windows execution is claimed.

- Scope: one optional provider; existing defaults, playback ownership, cache and
  edition storage retain their contracts. The previous broader plan is historical.
- Model installation: exact immutable backbone/projector pair and known hashes;
  shared verified downloader; canonical containment checks; active model removal
  excluded through the host lock until registry/file deletion completes.
- Process lifetime: one serialized warm host, bounded input/output/time limits,
  cancellation before/after dispatch, terminate/reap before replacement, unload
  and exit cleanup. Temporary successful WAVs are read/validated then removed.
- Backend portability: CPU feature variants and normal Metal/optional CUDA plugin
  selection, with no named-device gate. The actual packaged binary was exercised
  with both CUDA selected and CUDA hidden to verify CPU execution.
- Integration: truthful two-voice/WAV/language capabilities; no invented timings
  or voice cloning; stable Settings search targets for setup and local models;
  model/locale cache separation; per-consumer cancellation; existing reader and
  edition dispatch/assembly tested. Paid-provider request reuse is preserved.
- Packaging: pinned runtime source and notices; only native runtime dependencies
  staged; large Linux version aliases excluded; no weights/compiler bundled;
  normal development/build hooks ensure the runtime is present.
- Verification: focused frontend/native suites, type/lint/build, isolated
  benchmark/bundle gates and OpenSpec validation pass. Unrelated script failures
  and static duplicate-pattern matches remain explicitly documented.

The model's commercial clearance scope and physical testing of other desktop
targets remain release evidence, not hardware qualification gates on adding an
option. The original proposal-phase review is preserved under
`evidence/initial-scope/review.md`.
