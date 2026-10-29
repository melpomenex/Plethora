# Proposal review and verification

Reviewed 2026-10-28 against source baseline `694cf983177ed625d052584c1fea995c53385842`. This was a source-grounded self-review; no independent agent review or actual-model execution is claimed.

## Material issues resolved in the proposal

1. **Installed model mistaken for working inference:** separate full artifact validity, operational native backend, memory suitability and live-versus-edition performance. Validate actual depth decoder/codec and packaged app per target.
2. **CLI mistaken for production streaming:** wrap experimental libmtmd APIs in one supervised persistent host. Initial app contract is completed segments; upstream incremental PCM is evidence for a future transport, not a false v1 capability.
3. **Spec intent mistaken for source implementation:** explicitly document blob-backed edition audio/in-memory plans, missing provider cancellation and disabled global audio rollout. Add required persistence/owner work rather than assume it exists.
4. **Supertonic proposal mistaken for entirely future work:** sherpa family contracts, native engine and v1.13.6 packaging already exist; its provider is still absent. Coordinate actual shared surfaces without duplicating a model manager or forcing GGUF into sherpa.
5. **Mutable or ignored model revision:** verified the current query-parameter API accepts a nonexistent ref as main. Require revision-specific endpoint, immutable resolved SHA, matching files and negative lookup tests.
6. **Variant collisions:** add an optional common identity discriminator only for new variant installations, retaining legacy output IDs/directories.
7. **Cancellation-only-in-UI and late ready commits:** producer cancellation, reference-counted dedup, durable epoch intent/CAS, deletion tombstone and native kill/reap deadline protect both playback and persistent state.
8. **Cache seed/config inconsistency:** automatic retries retain recorded seed; changing seed creates a new identity. LFM3 keys include projector/runtime/locale/profile and do not use unsafe legacy fallback; playback-rate changes reuse audio.
9. **Unbounded long-form PCM/storage:** bounded utterance helper reset, native file output, incremental section assembly, logical cache budget and permanent asset leases. WAV storage is stated separately from weight size.
10. **Model thrash or silent narrator changes:** foreground configuration lease prevents model swaps during prefetch gaps; editions keep immutable narrator/runtime configuration, regardless of default changes.
11. **Fake alignment and commercial overclaims:** segment versus estimated precision is explicit, word estimates are transient, forced alignment/training deferred. LFM commercial threshold/redistribution terms are separate from MIT runtime notices and remain a release gate.
12. **Untestable “natural/seamless” promises:** provisional onset/RTF/join/memory/UI/quality thresholds, deterministic race injection and real-hardware acceptance are specified with failure dispositions. No device is labeled already supported.

## Checks executed

- `openspec validate add-lfm3-audio-local-tts --strict --json`: valid, zero issues.
- `openspec status --change add-lfm3-audio-local-tts`: proposal/specs/design/tasks all complete (4/4 planning artifacts).
- Structural consistency check: seven proposal capability paths exactly match seven delta directories; 33 requirements, 83 concrete WHEN/THEN scenarios; all modified requirement names exist in canonical specs.
- Checklist check: 62 unique unchecked future items, each with verification language; 59 first-release/integration items plus three separately scoped follow-up decisions. Dependencies and independent-agent suitability are recorded without doing implementation work.
- Local link/source checks: all relative Markdown links and repository paths in the audit resolve. Proposed new module paths are explicitly identified as proposed rather than asserted existing.
- Working-tree scope: only this new OpenSpec change was authored. Existing modified/untracked sidecar binaries remain outside the change; application code, dependencies and canonical specifications were not edited. No branch, commit, PR or push was created.

The OpenSpec validator checks document structure, not inference feasibility. Full application tests and `npm run bench:check` were not run for this planning-only change; they are required tasks for implementation. Model/HW/license verification still outstanding is recorded as release gates, not silently marked passed.

## Remaining implementation blockers, ranked

1. Real-model G1 results for the chosen native pipeline on reference desktops, including complete codec/accelerator execution, warm onset and cancellation.
2. Commercial eligibility/threshold-boundary resolution before affected commercial distribution.
3. Accepted desktop global playback ownership plus generated-reader integration, and durable edition asset/job implementation.
4. Per-locale, long-form and packaging evidence before each advertised backend/workflow is enabled.

The proposal is complete and ready to implement starting with the gated spike. The feature itself has not been implemented or certified by this work.
