# Verification and release gates

All performance numbers below are **provisional engineering targets**, not measured results. The original proposal executed OpenSpec validation only. Subsequent Phase 1 CPU smoke, artifact verification, lifecycle probes and outstanding gates are recorded in [evidence/README.md](evidence/README.md); they do not pass G1 or certify a platform. Record commands, package/runtime/model hashes, hardware, results and failures there. Do not mark a target supported because its weights fit memory or because a fake engine test passed.

## Gate sequence

| Gate | Required evidence | Failure decision |
|---|---|---|
| G0 — rights and artifact provenance | Runtime source/build pin, exact backbone/projector hashes, license/NOTICE inventory; commercial eligibility resolution before commercial rollout | Block the affected distribution/use; keep engineering feasibility separate from license eligibility |
| G1 — native feasibility | At least one desktop full TTS backend generates real intelligible 24 kHz audio with both voices; 30-minute run, cancellation/kill, repeat-load and memory checks pass | Stop expensive integration; retain report, revise ADR if necessary |
| G2 — provider/install/cache | Real dispatch, immutable model install, settings/backward compatibility, variant isolation, local/offline native asset cache and bounded cancellation pass | Keep provider disabled on affected target |
| G3 — live owner | Desktop global-audio dependency accepted; current-position live narration, foreground priority, navigation, remote controls, clock/position and latency/join gates pass | Classify backend edition-only until corrected; do not claim live support |
| G4 — permanent editions | Article/EPUB/PDF plan quality, segment/section crash commits, resume, stale-source/deletion races, shelf/Queue playback and valid file storage pass | Do not declare the LFM3 integration complete or advertise permanent generation |
| G5 — packaged release | Signed/installed app, CPU/accelerator probe and no-network run on each claimed platform; commercial release requirements complete | Disable unverified platform/backend; no inference claim based on dev build alone |

## Reproducible actual-model benchmark

Use the exact research pair or explicitly revised validated pair, fixed model/runtime/backend/profile hashes, recorded segmenter version and seeded text order. Run with networking disabled after installation. Record OS/build, CPU/RAM/free RAM, GPU/driver/VRAM/unified memory, power mode, thread counts, context/GPU offload, app idle RSS and ambient/thermal state. CPU and GPU results are separate; annotate any fallback. Process startup and model loading are separate metrics. No vendor codec throughput substitutes for this run.

Reference targets: M4 with 16 GB unified memory, Linux RTX 2060 SUPER with 8 GB VRAM (record host RAM/CPU), Windows CUDA desktop with recorded GPU, and one CPU-only desktop. Linux ARM64/macOS Intel require separate evidence if claimed. Android/iOS are deferred; no synthetic desktop proxy for mobile.

Corpora: a short natural sentence, a 1,000-word article, a 5,000-word article, 30 minutes of continuous reading, a multi-chapter EPUB with nested TOC/repeated headings/non-TOC spine content, and a text PDF plus an OCR-required PDF. Include dates, abbreviations, acronyms, code/math/table/footnote cases; a human-verified text fixture for every enabled locale; mixed-language, RTL and CJK boundary cases. Use public/licensed or synthetic documents with stable hashes and expected spoken text. Store fixture metadata and synthetic source ranges in repo; private user text is never benchmark telemetry.

Compare at least **Pocket TTS** through its current adapter on the same desktop (if unavailable, document the failure and use another actually installed local provider, not System/cloud as the only comparator). Include cold/warm/long narration, duration/quality and resource metrics. Supertonic can be an additional comparator after its provider works, not an assumed dependency.

Measurements:

| Metric | Definition and proposed gate | Rationale |
|---|---|---|
| Cold host / model initialization | 5 cold host/model cycles; report median/p95 separately, plus first audible onset. Provisional p95 ≤30 s on reference SSD systems, cancellable throughout | Avoid unexplained spinner; intentionally weaker than warm target |
| Warm onset | 30 short-sentence starts, model resident, cache miss; intent-to-first audible sample p95 ≤2 s at 1× | User's proposed responsiveness goal; includes queue/prefill/generation/file/player time |
| End-to-end RTF | Native request admission through valid committed clip / produced audio duration; report queue, inference and I/O separately. Article/30-minute workload p95 segment RTF ≤0.75 at 1×, no reliance on cache | 25% headroom for prefetch, app activity and variability |
| Rate headroom | Repeat 1×/1.5×/2×; only promise underrun-free rate when `RTF × rate ≤0.75` or measured buffered run passes. Otherwise show buffering/throughput limitation | Faster playback consumes generated audio faster; no universal 2× claim |
| Underruns / seams | After initial buffer, zero starvation in 30 min on supported reference profile. Record transport-added intersegment delay; p95 ≤50 ms, max ≤100 ms, excluding intentional natural pauses; no clicks/overlap by listening review | Distinguish natural phrasing from decoder/queue gaps; these budgets require measurement |
| Memory | Report peak/steady RSS/PSS per host/app, GPU allocation, unified-memory pressure and allocations after unload. No OOM; respect D4 measured budget/reserve. Post-warm steady working set at minute 30 ≤minute-5 value +max(64 MiB, 5%); repeat at 2 hours before broad release | Detect accumulating KV/codec/PCM/URL retention without pretending a fixed weight-size ratio predicts peak |
| UI responsiveness | Reference app interaction trace during generation: synthesis causes no main-thread task >50 ms and ≤1 percentage-point increase in frames >16.7 ms versus same navigation baseline at 60 Hz | Native generation should not make highlighting/reading stutter; report monitor refresh and trace attribution |
| Cancellation | Playback silence ≤250 ms from Stop; cooperative producer ack target ≤1 s, forced kill/reap by 2 s after cancel deadline initiation; no audio/state event after invalidated epoch | Distinguish stopping sound from interrupting a GPU kernel |
| Buffer/queues | Inference active ≤1, pending native ≤8; live queued ≤2; buffered ahead ≤30 s or 8 MiB, with explicit exception only for current validated clip; no monotonic URL/queue growth | Deterministic resource bounds are stronger than averages |
| Cache | Repeat corpus emits zero new inference for reusable identities; changed voice/locale/model/profile misses; cancellation never publishes partial clip | Verify useful dedup and absence of wrong-narrator hits |
| Concurrent listening | Play already-generated audiobook while making another edition: no playback underrun, no focus theft, checkpoint regression or UI gate violation | Inference is background work; throttle/pause it as needed |
| Long-form throughput/ETA | Record multi-chapter total time, energy, average/p95 RTF, time per section, cache savings and ETA error; show estimate only after ≥3 representative generated segments | Avoid claiming precise long-book completion time from one demo sentence |
| Power/thermal | Record 30-minute CPU/GPU power and clock/thermal trends where exposed; no crash or OS memory pressure. Sustained thermal regression disables live classification if RTF/join gates fail | Device “fits” is insufficient for sustained narration |
| Narration quality | Two reviewers compare at least 100 representative sentences per enabled locale across both voices, plus 1,000-word article and book chapter-boundary samples. Provisional normalized word/CJK-character error ≤5%, zero material invented/omitted clauses, names/numeric values checked explicitly; no repeated looping, abrupt voice identity changes or audible clicks in reviewed joins. Record counts, adjudicate disagreements and disable failed locales/variants | Human comparison is required; optional existing offline scoring assists without adding a new transcription product or sending text/audio remotely |

Threshold changes require measured justification in the evidence and updated specs/design, never a quiet baseline relaxation. If warm onset fails with sentence files but edition generation is sound, retain edition-only classification. A PCM transport optimization gets its own end-to-end gates before live enablement. G1 may proceed on one validated desktop; G5 must pass separately for every shipped target.

## Automated tests without weight downloads

Use deterministic native/fake inference with real small WAV fixtures and controllable barriers (load, first frame, EOS, finalize, rename, SQL commit, event delivery). Fake results expose the same private protocol and asset contracts; production cannot select the fake provider. Unit tests must assert public invariants, not only mirror implementation branches.

| Layer | Required test coverage |
|---|---|
| Provider/settings | Adapter ID/dispatch, exportable audio/delivery/rate capabilities, no cloning/timestamps/instructions, locale mapping (`en-US`/`en-GB`), unknown/unavailable fail closed, missing local install, legacy settings migration and unchanged selections; every new Settings target/catalog/coverage row |
| Model manager | Exact pair and wrong/missing projector, GGUF architecture rejection, immutable ref resolution/reinspection mismatch, both hashes, variant IDs/directories, legacy contracts deserialize unchanged, path traversal/symlink escape, size/quota, download cancel/Range/retry, staged multi-file rollback and registry publication |
| Runtime supervisor | One process/load for concurrent callers, frame/prompt cancellation, hung-child kill/reap, protocol mismatch/oversized frame, request queue bounds/priorities/fairness, preemption preserves job work, maximum output/context/time, load failure/OOM, unload and app-exit cleanup; no respawn loop |
| Cache | Complete canonical identity including locale/runtime/projector/normalization/seed, LFM3 no unsafe legacy fallback, speed-only reuse, single-flight refcounts, cancel one consumer without stopping another, invalid waveform not cached, fsync/rename failure, metadata/file mismatch, quota/eviction, playing lease, clear preserves editions |
| Text/source | Abbreviations/date ambiguity, markup/code/math/table/notes, PDF hyphenation/OCR block, non-Latin graphemes/RTL/CJK punctuation, long-sentence split, normalized span mapping, same-file EPUB TOC fragments, repeated titles, untitled spine sections, current page/selection slicing, stable plan/source hashes |
| Editions | Frozen narration snapshot, configured WAV/export capability (reject System/native marker), actual duration, segment idempotency, original status mappings, state projection, only ready after valid durable file+SQL, partial/failed/cancelled/paused transitions, startup auto-resume only when desired running, original model/config required |
| Recovery | Crash after write/rename/before and after SQL, missing/corrupt ready file, orphan grace/active lease, failed section retry without deleting success, source stale isolation, revision/hash mismatch, deleted edition tombstone, config epoch CAS, out-of-space at every boundary |
| Playback | app focus exclusivity, generation does not focus, paused restore, source identity/revision checkpoints, progressive playlist update at same current section, no tab/unmount stop, read A/listen B independent positions, stale native/media callbacks, rate/seek/skip, remote control targets current owner, model uninstall leaves WAV playback |
| Regressions | Existing Fal/Groq/Pocket/System/OpenRouter/OpenAI/compatible/ElevenLabs/Plethora dispatch fixtures and Android Kitten/Kokoro native path; imported audiobooks/podcasts/recordings, all generic cache/settings changes; sherpa/STT HF contracts untouched |

Use Vitest suites beside current `src/api/tts`, `src/utils/__tests__`, `src/services/audio/__tests__` and edition/store/dialog tests; Rust tests beside HF/tts/audio repositories. Shell protocol fixtures are lightweight and deterministic. Actual-model smoke is separate opt-in/local, keyed to an already installed pinned model. No routine PR test downloads weights.

## Adversarial races: expected outcomes

| Trigger | Required observable outcome |
|---|---|
| Stop while host/model loads | Current intent/epoch invalidated, no playback on load completion, load cancels or host reaped by deadline; a subsequent Play can load cleanly |
| Change document mid-generation | Previous session consumers withdraw; old result never moves new document highlight/position or acquires focus; valid old shared cache result allowed only under old identity |
| New live session before old inference finishes | New epoch wins; old media and native events ignored; no duplicate load, concurrent host or double speech |
| Delete edition during segment inference | Durable tombstone/epoch invalidation wins CAS; no section recreation; pending temp/orphan cleanup; source document retained |
| Delete edition while ready section plays | Existing owner retires/checkpoints, releases lease and prunes Queue; file unlinks only after release, no abrupt use-after-delete |
| Change global narrator/model while edition runs | Existing edition uses original snapshot; future live sessions use new preference; switching would require explicit new edition/plan, not mixed narrator chapters |
| Shutdown during WAV write | `.part` never ready; ready checkpoints retained; restart discards incomplete bytes and resumes from valid segment |
| Crash after rename but before SQL commit | File is unreferenced/reconciled, not playable ready metadata; retry is idempotent and cleanup never removes a leased asset |
| Crash after SQL commit before event | Restart loads valid ready segment once and does not resynthesize it |
| Model uninstall during active job/load | `in_use` result; Pause/unload action safely removes leases before delete. After uninstall ready edition audio plays, unfinished job waits for exact revision |
| New edition while live TTS plays | Silent enqueue, no audio focus theft; live buffer has priority and edition yields/continues only in safe windows |
| Rapid seek/stop/voice/provider changes | Detach old media handlers, cancel old consumers, one current output; old `onended` cannot auto-advance or flip state |
| One of two identical consumers cancels | Remaining consumer completes; exactly one inference/asset; no revoke while retained |
| Partial ready section gap | Existing player plays requested ready section/contiguous prefix, waits at unavailable section without skipping failed text; later readiness extends playlist without rewind |
| Sleep/wake / output disconnect | Pause/checkpoint; files/plan retained; no automatic wake speech, no stale producer output; resume revalidates devices and config |
| Disk becomes full after preflight | Native commit fails closed, paused actionable job, previous ready files intact, no “ready” with zero bytes or unbounded retry |
| App/runtime upgrade invalidates contract | Preserve installation and ready audio, disable incompatible inference with remediation; do not reinterpret model as another provider |

## Packaged user acceptance

For each claimed desktop OS/backend, record a screen/audio trace and resulting manifest/assets:

1. Fresh user selects LFM3; sees optional full-size download/license; cancel midway, retry, install exact artifacts. Corrupt/missing/wrong projector is blocked. Test no disk space without changing source documents.
2. Read a PDF from page 37 midway down the visible page; selected word and repeated passage resolve to that occurrence. Switch between LFM3 and an existing provider; stop/pause/resume/seek/next remain correct.
3. Create an edition from saved article/RSS/Queue identity; audition actual article text; see local time/disk estimates and no recurring API fee. First complete section enables playback while remaining sections generate, without changing an already playing audiobook.
4. Generate an EPUB with nested/repeated TOC labels, fragments within one XHTML file and untitled spine content. Validate every source range is covered once, chapter order/titles retained, no dropped/duplicate paragraphs, voice stable and no clicks/transport gaps.
5. Generate a text PDF and a scanned PDF using existing OCR. Unsupported/unprocessed scan clearly requests extraction; no invented audio. Normalize formatting without source mutation or anchor drift.
6. Listen while navigating to RSS/library/notes/another document, closing the source tab, minimizing and using headset/lock-screen/desktop controls. Read article A while book B continues; reading position stays independent.
7. Kill/reopen during generation and during playback, verify paused playback restore, correct section/offset, automatic generation recovery only for desired-running jobs and zero regenerated ready segments.
8. Disable internet, restart and repeat live/cache/edition playback and new edition generation. Verify no outbound speech traffic, no document text in logs, no microphone prompt and no exposed inference port.
9. Cancel, retry failed section, edit one source section, change default narrator, delete generated edition audio, uninstall model and restore exact model. Retain source, unrelated sections/bookmarks and correct missing-model messages.
10. Run 30-minute/2-hour memory and interaction tests, generation while listening to existing audio, rapid-control race suite and two-voice/validated-locale quality review.

## Local repository checks for implementation

At minimum run affected Vitest/Rust/native protocol suites, `npm run test:scripts` when packaging/install scripts change, type/lint/build checks applicable to touched files, Settings search gates from `docs/settings-search.md`, and **`npm run bench:check`** for the implementation. New `src/**/*.bench.ts` use seeded fixtures from `src/test/bench-support.ts`, consume results, return void and never invoke native/network/fs; hardware inference benchmark is a separate opt-in harness. Intentional performance/bundle changes update `scripts/perf-baselines.json` / `scripts/bundle-budgets.json` with rationale; do not silently accept regressions or rely on GitHub Actions as the gate.

For this planning-only change, run `openspec validate add-lfm3-audio-local-tts --strict`, status/artifact consistency and local reference checks. No application dependencies, binaries, production code or canonical specs are modified and full application benchmarks are not evidence for this proposal.
