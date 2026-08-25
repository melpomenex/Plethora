## Context

- **Incident.** ~10+ hour macOS session, ~74 GB reported footprint. Platform: macOS ARM64, Tauri 2.11.0 (pinned `=2.11.0`), wry 0.55.1, WKWebView. No process-level breakdown exists; "74 GB" is unattributed.
- **Predecessor.** `bound-runtime-memory-and-gate` built the memory harness (`scripts/memory-bench/`: driver, scenario, control, discovery, smaps-rollup sampler, settle protocol, corpus provisioning, result writer) and `scripts/check-memory-budget.mjs` (clamped thresholds, post-warmup reference + OLS slope ratchet, machine-profile matching). Its collector is Linux-only by design (`platform.js` refuses non-Linux with the message that a platform collector "would plug in behind the same scenario, baseline, and gate logic"). Its remaining unchecked tasks are Linux verification of reader-lifecycle fixes; this change does not touch them.
- **Verified code state at HEAD** (file:line in `proposal.md`; each was read, not assumed): unbounded `__plethoraTestErrors` in production; unbounded `sectionAudioBlobCache`; per-operation unclosed `openDB()` and payload-materializing eviction in `ttsCache.ts`; a permanent 1s heartbeat; whole-file desktop audio materialization; ~40 scattered `createObjectURL` sites. All introduced 2026-08-19 → 2026-08-23.
- **What already works and must not be redesigned:** reader disposal, desktop PDF range loading, reader-tab residency cap (default 2) — implemented by the predecessor; `ReaderTTSControls` already revokes its URLs; the bootstrap heartbeat already stops on settle.

## Goals / Non-Goals

**Goals**

1. Make the macOS incident class **reproducible, attributable, regression-tested, and hard to reintroduce**: macOS measurement in the existing harness, resource-lifetime diagnostics, bounded ownership for the verified unbounded mechanisms, tiered idle soak, and a slope gate that fails a per-cycle leak regardless of peak ceilings.
2. Keep the four workstreams independently implementable (D12).
3. Preserve all user-facing functionality; every bound has an explicit eviction/cleanup policy, not a removed feature.

**Non-Goals**

- Reimplementing the Linux collector, scenario machinery, or comparator (extend only).
- Redesigning the PDF/EPUB reader lifecycle (predecessor's scope; here it is only exercised and validated on macOS).
- Upgrading Tauri/Wry, allocator tuning, or reverting features without evidence.
- Telemetry: no user content, no production stack capture, no network reporting.

## Decisions

### D1 — Attribution gates fix *tuning*, not the three structural bounds

The diagnostic order is: capture the process tree (Phase 0/1) → instrument resource lifetimes (Phase 2) → reproduce deterministically (Phase 3) → profile deeply (Phase 4) → fix (Phase 5). However, three fixes are **correct by construction** — an unbounded global error array, an unbounded global Blob-URL map, and payload-materializing eviction are wrong regardless of what the 74 GB turns out to be — and may land in Phase 5 as soon as their WS-C primitives exist, with attribution informing only their caps and priorities. Any fix beyond those three must cite a finding recorded in `docs/memory-profile.md`, mirroring the predecessor's D1.

### D2 — Extend the harness at its platform seam, never fork it

macOS collection slots in behind `checkMemoryCollectionSupported` → per-platform collector, producing samples in the same keyed shape the result writer and comparator already consume. Scenario, settle, corpus, run-ID marking, control protocol, baselines, and gate are reused verbatim. New stages (soak, TTS, audio-edition) are added to the shared scenario builder and run on both platforms; nothing macOS-only forks off. macOS gaps in generic code (environment collection reads `/etc/os-release`, `/proc/cpuinfo`, `/proc/meminfo`; settle uses tree `Pss`) get platform branches keyed on the collector's headline field, not parallel macOS scripts.

### D3 — macOS measurement is a standalone native helper, not app code

Physical footprint per process comes from `proc_pid_rusage` with `RUSAGE_INFO_CURRENT` (`ri_phys_footprint`), plus `proc_pidinfo` for PPID/role classification. It lives in a small cargo crate under `scripts/memory-bench/native/` invoked by the driver (JSON on stdout), because: the shipped app must not carry diagnostic code; the driver runs on the dev machine where cargo already exists; and a helper avoids fragile human-output parsing (`ps`/`vmmap` text remain manual diagnostic artifacts, per D10). Process discovery walks the ancestry of the launched PID and classifies by executable (native app, `com.apple.WebKit.WebContent`, `com.apple.WebKit.Networking`, GPU/other), with the run-ID environment marker as a secondary verification where macOS permits reading it — on restriction, ancestry from the driver-launched root is the authoritative signal, and the limitation is documented. This preserves the predecessor's D3 invariant: an unrelated application's WebKit processes can never be absorbed.

### D4 — Physical footprint is the macOS headline; the tree total sums footprints

`ri_phys_footprint` matches what macOS itself charges and pressures (Xcode/Activity Monitor semantics), so it is the macOS analog of the predecessor's PSS-philosophy headline. Per-process samples keep all available fields (`ri_phys_footprint`, `ri_resident_size`, wired, virtual); the tree total is the sum of footprints (per-process charges are additive; RSS is reported but never summed, mirroring the Linux rule that shared pages must not be double-counted). The settle protocol's convergence check uses the tree footprint on macOS.

### D5 — Object URLs get a registry that owns metadata, never payloads

A `createOwnedObjectUrl(blob, { owner, ownerId, bytes })` / `revokeOwnedObjectUrl(url)` wrapper records `{ url, owner, ownerId, bytes, created }` in a registry that reports live counts and byte estimates grouped by owner. The registry **never retains the Blob or ArrayBuffer** — the URL already pins the payload in the browser; retaining it again would double-count and re-leak. In dev/test mode only, a bounded allocation-site sample (capped ring) is recorded. High-churn call sites may bypass per-call metadata (a counter-only mode) where measuring `blob.size` is not free. Adoption order: TTS providers and the audio-edition store first (the verified offenders); other sites opportunistically. Leak assertions (`owner's live URLs === 0 after dispose`) become testable invariants.

### D6 — Error recording becomes a bounded aggregate, and the harness contract moves with it

The recorder keeps at most N distinct signatures (configurable, default ≤ 64) as `{ signature, type, message, sampleStack?, count, firstSeen, lastSeen }`; a signature is `type + normalized message` (message truncated before storage). One repeating exception costs O(1) memory. Production builds keep the recorder **disabled by default** and expose it only behind an explicit enable (e.g. `PLETHORA_DIAGNOSTICS=1`); the reliability harness opts in through its own env. The iOS reliability harness — the only consumer of `__plethoraTestErrors` — migrates to reading aggregates (`getDiagnosticSnapshot().errors`), with a compatibility adapter only if the harness cannot be updated in the same change.

### D7 — Synthesized section audio: transitional bounded LRU now, disk-backed working set as the design target

`sectionAudioBlobCache` becomes a bounded LRU with count and byte caps, `revokeObjectURL` on evict and on replace, and explicit cleanup on edition deletion, job cancellation, library reset, and app teardown. `AudiobookViewer` consumption changes from "all ready sections pinned as playlist sources" to a **playback working set** (current + next 1–2 sections, prefetched ahead of the boundary) so an N-section edition no longer pins N Blobs. The preferred end state — generated audio persisted to disk and streamed through the existing media path, with only the working set live — is the documented target; this change implements the LRU + working set unless Phase 4 attribution shows even the working set churn is unacceptable, in which case the disk-backed path is pulled forward. Ownership is documented precisely: the edition store owns URLs until playback borrows them; nothing is revoked under an active `<audio>`.

### D8 — TTS cache: one managed connection; eviction that never touches payloads

`openDB()` becomes a shared, lazily-created, reused connection (created once, `close()`d on cache-clear/teardown where observable), eliminating per-operation `IDBDatabase` accumulation. Eviction switches to a **metadata-only index**: a small per-entry metadata record (`key`, `size`, `lastAccessed`) maintained alongside the payload store (or via key-only cursors), so computing eviction order and deleting victims never materializes `audioData`. The existing 500 MB bound, mutex, meta bookkeeping, and QuotaExceeded recovery are preserved; a one-time migration backfills metadata for existing entries without reading payloads beyond what IndexedDB requires to count/clear them (delete-by-key only). Cache hits keep minting a Blob+URL per playback, but through D5 owned URLs, so accumulation is observable and bounded by the caller's revoke.

### D9 — Test-only timers stop running in production

The permanent `main.tsx` heartbeat moves behind the same explicit diagnostics/harness gate as D6 (it exists for the reliability harness's liveness probe; the harness opts in via env). The bootstrap heartbeat already stops on settle and is left alone beyond the same gating where trivial. No claim is made that either timer explains 74 GB; this is lifecycle ownership, not a fix.

### D10 — Manual deep-attribution workflow is documented, with fixed checkpoints

`docs/memory-profile.md` gains the macOS workflow: Instruments (Allocations with generations, Leaks, VM Tracker), WKWebView JS heap snapshots (Safari Web Inspector over the WKWebView), and CLI artifacts (`ps -axo pid,ppid,%cpu,rss,vsz,etime,command`, `vmmap <pid> -summary`, `leaks <pid>`, `sample <pid> 10`), with named checkpoints A (fresh idle) / B (document open) / C (closed) / D (25 cycles) / E (100 cycles) / F (idle soak). The automated soak saves enough per-sample, per-process data (sampled at interval, not only at settle) that a failed overnight run is attributable the next morning: which process, which role, linear vs stepped, when it started. Growth classification (live-reachable / allocator high-water / WebKit backing stores / reclaimable cache / true native leak) is recorded per finding, and allocator remedies remain forbidden without high-water evidence, per the predecessor's D13.

### D11 — The gate must fail a leak that hides under the ceiling

The comparator's ratchet already covers repeated cycles; this change extends slope evaluation to **soak samples** (idle growth/hour post-warmup) and **per-process-role** metrics, and adds a scenario-mode-only synthetic leak: `PLETHORA_MEMORY_SYNTHETIC_LEAK_MB_PER_CYCLE` makes the in-app scenario host retain N MB per cycle (ArrayBuffers held in a module sink; env-gated exactly like the scenario host itself, absent in production). A gate self-test runs the harness against the synthetic leak and must FAIL while every peak metric stays under its ceiling — proving the ratchet, not the ceiling, catches leaks. Conversely, a stable high-water profile (rises then plateaus) and a noisy-but-bounded run must pass.

### D12 — Four workstreams with disjoint file ownership

- **WS-A (macOS measurement):** new `scripts/memory-bench/native/**` + new collector module; edits confined to `platform.js`, `driver.js` (platform dispatch), `result.js` (environment), `sample.js`/`discovery.js` (platform branches). Lands before WS-D's driver edits.
- **WS-B (Blob/audio/TTS):** `src/utils/ttsCache.ts`, `src/stores/audioEditionGenerationStore.ts`, `src/api/tts.ts`, `src/api/tts/providers/shared.ts`, `src/components/viewer/AudiobookViewer.tsx`, `src/components/audio/CreateAudioEditionDialog.tsx`, their tests.
- **WS-C (instrumentation + diagnostics):** `src/main.tsx`, `src/main-bootstrap.ts`, new `src/diagnostics/**` (owned URLs, error aggregates, resource counts), the reliability-harness consumer, their tests.
- **WS-D (soak + gate):** `scripts/memory-bench/scenario.js`, `driver.js` (periodic soak sampling, after WS-A), `src/lib/memoryScenario/**` (new ops incl. synthetic leak), `scripts/check-memory-budget.mjs`, `scripts/memory-baselines.json`, gate tests, optional CI job.

Two cross-workstream dependencies are explicit: WS-B adopts WS-C's owned-URL registry (WS-C's `src/diagnostics/ownedObjectUrl.ts` first); WS-D's synthetic leak and soak ops build on the scenario host WS-A leaves untouched. Otherwise no two workstreams edit the same file.

### D13 — Production observability stays cheap and private

Production diagnostics are counters and byte estimates only: no stacks (stacks are dev/test-only and bounded), no document text or audio content, no continuous capture, no monkey-patched browser globals in production, no per-operation overhead beyond an integer bump and a Map lookup. The rich surface (allocation-site samples, per-owner URL listings, heap-snapshot checkpoints) exists only when the diagnostics/harness gate is on, and is itself bounded (capped rings, capped signatures).

### D14 — Tauri/Wry/WKWebView isolation is conditional, respecting pins

If Phase 3/4 attribution cannot explain the growth from application resources (URLs, caches, errors, JS heap all flat while footprint climbs), run the control experiment: a minimal one-window Tauri app on the same pinned `tauri`/`wry` versions and WKWebView initialization, no Plethora features, soaked for a comparable period. Control flat + Plethora growing ⇒ application lifecycle (keep digging with D10 tooling); control growing ⇒ platform issue — then and only then evaluate version changes as a separate change. No dependency upgrade happens in this change.

## Risks / Trade-offs

- **Working-set playback glitches** at section boundaries (prefetch miss → gap). Mitigation: prefetch next 1–2 sections, revoke only behind playback, harness TTS/edition stages assert gap-free advancement in scenario mode.
- **TTS cache metadata migration** corrupting existing cached audio. Mitigation: metadata is additive (new store), payloads are only ever deleted by key during normal eviction; migration is idempotent and failure-tolerant (missing metadata ⇒ entry evictable last / counted on first access).
- **IndexedDB singleton vs. multi-tab/PWA contexts**: a module-level connection assumes one WebView context (true in Tauri today); document and assert.
- **Error-aggregate signature normalization** could merge distinct errors (truncated messages). Mitigation: normalization rules are spec'd and tested; sample stacks preserved per signature.
- **Soak duration vs. developer patience**: tiers keep the default suite quick; nightly/extended tiers run unattended on the Mac mini.
- **Footprint vs. PSS cross-platform comparability**: baselines are machine-profile-scoped and never compared across platforms; the comparator already refuses mismatched profiles.

## Migration Plan

1. WS-C diagnostics land inert-by-default (production behavior unchanged until env-gated on).
2. WS-B bounds land behind the existing flows; no data migration (blob cache is runtime-only; TTS cache migration is additive).
3. WS-A/WS-D harness extensions land behind their existing env gates; no production surface.
4. Baselines: macOS entries are recorded after fixes (Phase 8); the Linux entries remain the predecessor's to record.
5. The reliability harness consumer migrates to the aggregate API in the same PR as the recorder change.

## Open Questions

- The exact working-set size (next 1 vs. 2 sections) and byte cap for the section-audio LRU — chosen from Phase 3/4 data, recorded as documented defaults.
- Whether macOS permits reading the run-ID marker from sibling processes' environments on current Darwin (helper falls back to ancestry; resolved in WS-A implementation).
- Whether the network process and GPU process are separately identifiable in every macOS version targeted (roles degrade to `other`, recorded per sample).
- Whether the optional CI macOS soak job is worth runner cost vs. Mac-mini-local nightly only — decided at Phase 8.
