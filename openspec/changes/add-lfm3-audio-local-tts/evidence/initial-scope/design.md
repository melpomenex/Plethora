## Context

See [proposal.md](proposal.md) for scope, [audit.md](audit.md) for source-verified implementation status and [research.md](research.md) for pinned upstream evidence. This design describes **proposed interfaces**; names introduced below do not imply working modules or commands already exist.

The integration has three missing boundaries: the provider API has no producer cancellation/file asset contract; generated editions do not durably commit audio; reader playback is view-owned while global playback is gated. Adding a dropdown cannot solve these. The existing registry, text/anchor index, HF installer, edition repository and audio owner remain the integration points.

## Goals / Non-Goals

**Goals:** one native model instance shared by live narration, auditions and edition generation; exact request/configuration identity; truthful backend readiness; bounded memory/queues; restart-safe native audio assets; navigation-independent listening through existing app playback ownership. Every release claim has an acceptance gate in [validation.md](validation.md).

**Non-Goals:** a generic inference framework, codec reimplementation, model training, microphone/ASR, a second player, automatic cross-provider fallback, new OCR, mandatory audio compression or unverified mobile execution. PCM streaming support in upstream is not exposed as an app capability until the playback transport is implemented and validated.

## Decisions

### D1. One supervised native host over pinned libmtmd

ADR-1 in research selects llama.cpp/libmtmd for actual speech generation. Proposed new implementation locations:

- `native/lfm3-host/`: small C++ host/CMake target using a pinned llama.cpp source dependency and its helper APIs. Build with only required runtime facilities and audited prompt/template helpers. No network downloader or inference HTTP server.
- `src-tauri/src/tts/lfm3/`: Rust supervisor, protocol DTOs, queue, cancellation, runtime probe and managed state; register commands in `src-tauri/src/lib.rs` alongside existing sherpa commands.
- Extend existing `src-tauri/src/tts/wav.rs` for bounded PCM writing/validation where useful. Keep sherpa's engine/ABI independent; do not retrofit its superseding queue to implement LFM3 fairness.

Use one private child process, spawned through the existing Tauri shell sidecar mechanism, with one native inference worker and one lightweight control reader. Rust owns the bounded queue. Child stdin/stdout carry size-bounded newline-delimited control JSON (64 KiB/frame maximum); document text is at most one bounded segment and is never printed to stderr. PCM stays in native files. Protocol handshake verifies protocol version, source commit, build manifest, backend list and architecture before model load. User-provided executable paths are forbidden. Do not invoke a shell or upstream `-hf`.

Supervisor states: `unavailable → stopped → starting → idle → loading → ready → synthesizing → ready`, with `unloading`, `stopping`, `failed` exits. `idle` has a running host but no model. Model configuration key = immutable install identity + runtime build + effective backend/device/context configuration. Concurrent requests for the same key await one load future. A different model configuration drains/cancels current work, waits for teardown, then loads; never two simultaneous LFM3 models. The host can retain a loaded model through ordinary voice/locale changes because those reset utterance state, not weights.

Keep backbone weights, llama context and mtmd context loaded. For every utterance reset sequence/KV/recurrent state, sampler history, helper/codec state and seed. Apply the GGUF TTS chat template with escaped user text, voice and locale; user text cannot inject system/control tokens. Enable the embedding path required by the helper. Probe `MTMD_GEN_AUDIO_TYPE_LFM3A`, 24 kHz output and required control tokens/template before readiness. Audio processing must include depth prediction and codec/ISTFT, not merely tokens from the backbone.

Cooperative cancel is checked between bounded prompt batches and acoustic frames, including during output writing. Model-load callbacks are used if available in the pinned version. A blocked load/kernel is not assumed interruptible: supervisor stops accepting new work, rejects the cancelled request, sends cancel and after **2 s** without acknowledgement terminates/reaps the child. A new host is permitted only after confirmed process exit. A pipe-close/heartbeat failure similarly quarantines and reaps. Job checkpoints survive a host crash. No thread force-kill, abandoned child or unbounded automatic respawn. One automatic host restart per user operation; a second crash requires an explicit Retry. App exit pauses durable jobs, cancels active work, requests unload/shutdown, then kills/reaps after the same deadline. Memory reclamation is confirmed by process death when cooperative teardown fails.

Explicit unload, provider switch with no remaining generation lease, memory pressure and app exit release weights. Do not choose a speculative idle-unload timer: default retain while feature is active, release when unused or under pressure; collect model-load and idle-memory evidence before adding a configurable timeout. Stop can leave a healthy model warm but must stop the current producer and playback immediately.

### D2. Separate inference admission from playback ownership

The native supervisor schedules inference only. Reader/global audio logic schedules what is heard. No host playback, media session, chapter controller or inference-owned autoplay.

```mermaid
flowchart LR
  Reader[Reader or global narration session] --> Speech[generateSpeech / provider registry]
  Edition[Existing Audio Edition job coordinator] --> Registry[TTSProviderAdapter registry]
  Speech --> Registry
  Registry --> Adapter[LFM3 adapter]
  Adapter --> Native[Rust supervisor and bounded admission]
  HF[HF registry and verified artifacts] --> Native
  Native --> Host[One native libmtmd host]
  Host --> Files[App-managed temporary WAV]
  Files --> Commit[Native validation and durable asset commit]
  Commit --> Cache[Existing TTS cache facade]
  Commit --> Manifest[Existing edition repository]
  Cache --> Owner[Existing application audio owner]
  Manifest --> Owner
  Owner --> UI[Reader / mini player / OS controls]
```

One active synthesis, at most **8 queued native requests**, at most **2 pending segments per live session**, and one admitted live narration owner. An edition contributes at most one pending segment; other editions remain durable queued descriptors, not resident audio/text. Reject over-cap requests with typed `busy` plus retry guidance; callers retry through their existing coordinator, never recursive immediate loops.

Admission order: missing active-playback segment → one foreground audition initiated by the user → live look-ahead → edition work. Dedup equal identities first. Prefetch stops when ready audio reaches **30 s or 8 MiB**, whichever comes first. Generated reader chunks stay under existing packer limits, but the native engine concurrency is always one despite the reader's current three-call waterfall. Prefer one sentence, combine short sentences only within the validated target; first request is one short natural sentence rather than a 700-character paragraph. Oversized sentences split at anchored clause/word boundaries; splitting never drops a word or splits a Unicode grapheme.

Edition fairness is round-robin at segment boundaries when foreground buffer is safe; while foreground falls below a provisional 5 s low-water mark, edition synthesis yields. A queued edition requiring a different loaded model/backend configuration waits until the foreground narration session releases its configuration lease; safe look-ahead gaps do not permit swapping multi-gigabyte models back and forth. Voice/locale changes on the same weights do not require a reload. If an edition is already running when foreground arrives, cancel it and retain only previously committed checkpoints. Preemption discards its incomplete segment; it cannot serve half an utterance. Bound each segment to ≤700 characters, ≤512 input tokens including rendered prompt, ≤375 audio frames (30 s at 80 ms) and **60 s wall time** as initial spike limits; exceeding any cap fails the segment as `output_limit`/`timeout`, not success. Phase 1 must validate or tighten these limits, especially for non-Latin scripts. Context allocation is a measured small working context (candidate 2K) with explicit output reserve, never automatic 32K. Rejected input is resegmented by the existing anchored planner, not truncated by the host.

Playback of existing files uses no inference. If both require the same GPU/CPU resources, ordinary listening wins and generation is throttled/paused before playback underruns. When continuous live listening leaves no safe generation window, show “Waiting for live narration”; do not promise progress or spin. Equal-priority admitted foreground clients are FIFO; stale clients are cancelled rather than allowed to starve the current user intent.

### D3. Additive provider contracts, with explicit availability

Add provider ID `lfm3`, label **LFM3 (On-device)**, `kind: local`, `auth: none`, to actual union/default/registry/catalog surfaces. Proposed adapter `src/api/tts/providers/lfm3.ts` calls Rust through `src/api/lfm3Tts.ts`. `listModels` uses HF registry models with valid LFM3 contracts, not raw IDs. Unavailable models may be displayed disabled with reason, never synthesized through `getAdapter` fallback.

Extend current types minimally:

| Contract extension (proposed) | Behavior |
|---|---|
| `TTSSynthesizeRequest.signal?`, `requestId?`, `sessionId?`, `generationEpoch?`, `priority?`, `language?` | Optional for existing providers. LFM3 propagates cancellation/identity; direct edition and preview calls pass these too. |
| `TTSAdapterCapabilities.delivery?`, `speedControl?`, `supportsAudioExport?` | Defaults preserve existing adapters. LFM3: `complete-segment`, `playback`, true. Existing System/Android native marker adapters explicitly cannot export audio. Do not change semantics of existing `supportsSpeed` globally. |
| Optional model availability details | `runtime_missing`, `download_required`, `incompatible`, `insufficient_memory`, `edition_only`, `ready`, with safe diagnostic code and runtime/model revision; runtime and install status remain device-local. |
| `TTSAudioResult.asset?` and generated-result equivalent | `{assetId, mimeType, durationSec, sampleRate, byteLength, releaseToken}`; `audioUrl` remains a bounded playable file URL for compatibility. No `audioData` required for native results. |
| Synthesis identity input | Explicit immutable model/runtime/config identity used by generic dedup/cache; not hidden solely in `rawOutput`. |

LFM3 capabilities: WAV/24 kHz mono PCM16 files, female/male, validated locales, no measured word timing, no native speed, no instructions/pitch/style/cloning/custom voice IDs. `supportsSpeed=false` because generation speed is not controllable; existing player rate remains available via `speedControl: playback`. Optional empty `wordTimings`; do not synthesize word estimates in the provider. `maxInputChars=700` is an initial app safety bound, not an upstream maximum, and native token/frame bounds are authoritative. Backend/format/language limits come from the pinned operational manifest after Phase 1. No generic preset values are forwarded when the model does not support them.

Settings persist a namespaced LFM3 model install ID, `female|male`, canonical locale and validated generation-profile version. Provider-aware normalization avoids today's Fal-only language enumeration. Preserve old selected provider/default voice/presets exactly; initialize missing LFM3 config without selecting it. Invalid voice/locale produces validation UI, never a silent accent/narrator change. Local provider errors never request cloud credentials or incur cloud consent fallback.

TTS settings show download state, two voice choices, language, document-text Preview and actionable diagnostics. Backend/device/build diagnostics live in model details, not ordinary reader controls. Add stable search targets and catalog/coverage tests: `tts.lfm3`, `tts.lfm3.model`, `tts.lfm3.voice`, `tts.lfm3.language`, `tts.lfm3.preview`; reuse an existing generic target instead where it already wraps the actual shared control, and record coverage exclusions explicitly. Any advanced backend selector introduced later needs its own target. No control is added by this proposal.

### D4. HF artifacts, identities and native runtime packaging

Add specific `HfRuntime::LlamaCppTts` and tagged `RunContract::Lfm3AudioTts` variants (proposed), mirrored in `src/api/hfModels.ts`. Do not put GGUF under SherpaTts. Contract fields: schema version, architecture `lfm3-audio`, backbone path/quantization/SHA, projector path/quantization/SHA, source repo and resolved commit SHA, output rate, required host protocol/runtime build compatibility, supported locale/voice manifest and contract digest. Reuse `ArtifactFile`, `required_files`, containment and adapter detection patterns.

First supported pair is exactly the Q4_K_M + Q8_0 pair in research. Validate GGUF architecture/pipeline metadata and cross-file compatibility in the trusted host before “ready”; filenames/tags/extension alone are insufficient. Wrong projector, missing decoder tensors, unknown architecture, mismatched revisions and unsupported quantizations are blocked, with no advanced force-run bypass. Inspection can describe an unavailable runtime, but Install is enabled only for a packaged runtime/backend with a validated complete contract on that target. “Files present” and “operational” are separate states.

HF input refs are resolved to immutable commit SHA at inspection; installation rechecks the same SHA and digest, rejecting changed inspected assets. Fix the current metadata client's query-parameter ref lookup to the revision-specific API endpoint and reject nonexistent refs; audit records live evidence that the query parameter can return main instead. Existing models retain their IDs. LFM3 needs multiple quantization variants per repo/revision/runtime: extend common identity helpers with optional artifact discriminator, preserving byte-for-byte legacy outputs when absent. New ID convention: `hf:llama-cpp-tts:<repo>@<sha>#<variant>`; install directory = existing TTS root plus safe repo/revision name and sanitized variant/contract digest. Never use raw repo/voice/path components as filesystem names. Host is given only canonical installed paths resolved by Rust, not frontend paths. Variant deletion must not remove a shared sibling installation.

Installer reuses streaming/progress/Range/retry/SHA pipeline. Multi-file publication uses a staging directory plus verified manifest and atomic registry publication; a model is never registered when only its backbone finished. Preserve old installation on interrupted upgrade. Cancellation removes unpublished stage; retries within one download may reuse verified `.part` ranges, but no promise of cross-restart download resumption unless persisted metadata matches revision/hash. Preflight free disk for remaining weights, runtime pack, staging overhead and safety reserve; do not require 2× all weights if staging is renamed on the same filesystem. Require known SHA for every LFM3 binary asset. Store license/NOTICE text and its digest too.

Model leases protect loaded/queued work. Uninstall returns `in_use` and names affected jobs; UI offers Pause generation and unload, then uninstall. Completed edition files remain playable without weights. Resuming missing-model work waits for the exact install, not “latest” or another quantization. App/runtime upgrades re-probe old contracts; incompatible installs stay on disk with explanation until a validated runtime or explicit reinstall, never execute through an unknown ABI.

Package a CPU host and platform acceleration from the **same** pinned llama source/build manifest. Metal on macOS; optional verified CUDA pack on Linux/Windows if distribution size requires it. Do not reuse transcription CUDA/ORT readiness or mix ggml shared libraries with whisper's copies. Process isolation plus absolute dependency directories prevent ABI collisions. Use target-suffixed Tauri externalBin, Windows DLL directory isolation, Linux `$ORIGIN` paths and macOS signed/notarized nested binaries/Metal resources. Existing `scripts/download-sidecars.js`, `build.rs`, platform Tauri resource maps and release checks are the extension points. End users need no CMake/compiler/Python/CUDA toolkit; required driver/version is reported by the runtime probe. CUDA pack hashes, driver minimum and compiled SM list are release artifacts. If not distributable or runnable, CPU/edition-only remains explicit; no hidden native-stack fallback.

Reuse HF `SystemInfo` as evidence, then run a complete LFM3 synthesis probe. File size is only a lower bound for RAM/VRAM. Proposed preflight reserve: measured peak working set plus max(1 GiB, 20% measured peak) and 2 GiB available for app/OS; unified RAM is counted once on Apple. These conservative starting budgets require Phase 1 evidence. Unknown available-memory readings produce unverified suitability, not Recommended. Recheck before load, catch allocation errors, unload safely and retain valid assets. Backend auto-selection tries only validated local backends; CPU fallback requires a visible notice and valid edition/live classification, with its actual backend included in identity.

### D5. Live request flow and global playback dependency

```mermaid
sequenceDiagram
  participant R as Reader surface
  participant O as Existing app audio owner
  participant P as Generic TTS/cache
  participant N as Native supervisor
  R->>O: Start at selection / viewport anchor
  O->>O: Acquire focus; create narration epoch
  O->>P: Current anchored segment + immutable identity
  alt durable cache hit
    P-->>O: Leased file asset
  else synthesis required
    P->>N: Admit bounded request
    N->>N: Single-flight load; synthesize; validate/commit
    N-->>P: Asset handle + actual duration
    P-->>O: Current-epoch leased asset
  end
  O->>O: Play; schedule bounded look-ahead
  O-->>R: Position/anchor observations
  R->>R: Surface unmounts during navigation
  O->>O: Continue playing; surface is only a subscriber
```

The global playback change must complete its desktop parity gate first. That is insufficient alone: its owner currently handles ready media. Extend that same owner/runtime with an application-lifetime **generated-reader source** carrying document revision, anchored segment plan, current segment/offset and bounded provider prefetch. Extract the non-DOM playlist/clock/generation state from ReaderTTSControls into that owner path; reader retains viewport resolution, locators/highlighter, controls and subscriptions. Share the existing audio engine, command serialization, focus leases, checkpoint writer, mini player and remote adapter. Do not keep a hidden reader mounted, attach a second audio element owner, or start a separate LFM3 global session singleton. Generic short `useTTS` utterances remain supported through focus arbitration.

Cold start priority remains explicit selection → actual visible viewport → authoritative reader position → reconciled saved listening/reading fallback → beginning. Mid-chunk starts slice at exact anchored word and generate their own clip/cache key; without measured alignment do not seek into a full clip by proportional word time. Pause/resume within an already playing clip preserves its media-clock offset. Seek/skip to another source location changes narration epoch, aborts obsolete consumers/prefetch and requests the appropriate anchored slice. Playback speed changes media rate and buffering in wall-clock seconds, not synthesis voice or audio hash.

Every request/result/event carries session ID, document revision, configuration digest, request ID and epoch. An old result may enter the cache under its own complete identity if another consumer needs it, but cannot play, update current position, mark a deleted edition ready or change newer UI state. Detach media handlers before stopping old output, and test stale `ended`, `pause`, error and model-load completions. Dedup tracks subscriber cancellation separately; cancel native production only when all consumers withdraw. An edition consumer cannot be cancelled merely because its identical live-preview consumer stopped.

Focus belongs to `appAudioFocus`: generation is silent and never acquires output focus. Preview is explicit output and must acquire focus/pause the prior source; it never automatically resumes that source. Live TTS and editions cannot compete audibly. A user reading article A while book B plays causes no narration or position changes until explicit Play. Focus revocation immediately suppresses old playback, cancels producer consumers and waits for acknowledgement before new output; inference cleanup can finish under the supervisor deadline without allowing stale sound.

Desktop media commands target the current owner/session, not the active tab. Headphone unplug/permanent focus loss pauses with checkpoint; output device change and sleep pause/reprobe the decoder and native engine, retaining generated files. Wake restores paused, never auto-speaks. Existing navigation is not an interruption. Cold restart restores narration location paused, re-resolves source/hash and loads only on explicit Play; OS controls may resume that existing owner. App shutdown flushes checkpoints and pauses jobs. Mobile interruption semantics are tested only when future native inference is pursued; this desktop change preserves current Android behavior.

Initial files use gap-minimized existing media transition/preload paths. Measure trailing/leading natural pauses separately from transport gaps. No default crossfade over speech, arbitrary silence deletion or overlapped words. If the current HTML owner cannot meet the seam gate, improve its bounded preload/scheduling path for all generated clips before claiming seamless LFM3; do not claim `new Audio()` transitions are gapless without evidence.

### D6. One immutable Audio Edition plan and recoverable coordinator

Reuse `CreateAudioEditionDialog`, `audioEditionGenerationStore`, `src/api/audioEditions.ts` and Rust edition repository. The store becomes an app-lifetime coordinator/projector over durable native job state for LFM3; it still dispatches through the registry. It does not become a second runtime scheduler. Preserve legacy provider paths while incrementally adding the generic exportable-file/commit contract. LFM3 direct worker calls must receive exactly the same normalized settings/identity/signal as live calls and previews, including durable cache lookup; no bespoke provider-ID branch in unrelated viewers.

Creation sequence:

1. Resolve canonical readable text and semantic sections through existing article/RSS/EPUB/PDF extraction. Fetch actual EPUB spine bodies and TOC fragments, including untitled/non-TOC content in spine order. Prevent nested TOC duplication/overlap; retain hierarchy, titles, href/CFI or PDF word/page boundaries. Scans require existing OCR/reflow or a clear “Text/OCR required” block. Resolve saved RSS/queue items to the same source document identity, not a second article import.
2. Run provenance-preserving normalization and stable bounded segmentation. Keep semantic chapter identity distinct from inference segments. Existing oversized-section support can create titled subparts for huge chapters, retaining parent chapter key and order. No random segment identity or timestamp revision fallback.
3. Snapshot edition configuration and canonical source/section SHA-256. Store a versioned structured value in existing `generationSettings` JSON plus additive provenance/section fields below. A full document/model copy is unnecessary: persist source references/ranges and text/config hashes. On resume re-extract the same source version; if unavailable/changed, wait or mark affected sections stale. One current section's text may be held at a time. Do not depend on `jobSectionTextMaps` surviving restart.
4. Persist edition/sections, immutable plan descriptors and job control in one SQLite transaction, then enqueue. Model load is a visible runtime phase. Preview used a separate transient asset and does not automatically create a chapter.
5. Re-resolve one segment's text, check its hash, synthesize via normal adapter/cache and commit that segment checkpoint in native storage. Keep committed segments across cancel/failure. Assemble section WAV incrementally on disk; only after all its segments validate/commit does the section become ready. Earliest ready section enables Play now; generation does not autoplay.
6. Publish ready assets/anchors/progress to shelf/Queue/current player. Job progress uses committed normalized character weights with completed sections listed; ETA uses measured backend throughput and remaining work, labeled approximate. A paused/preempted/thermal-limited job does not keep a false countdown. All ready yields edition ready; mixed ready/failed yields visible Partial and Retry.

Proposed additive storage, within the existing edition schema/migration runner:

| Location | Fields / invariant |
|---|---|
| Existing edition generation settings | Versioned `narration` snapshot: provider, canonical install ID, repo/SHA, two artifact hashes/quantizations, runtime build/protocol/backend, voice, locale, sampling-profile version, seed strategy, normalization/segmentation versions, output format; config SHA-256. Existing keys remain readable. |
| Existing sections | Nullable `sourceTextHash`, parent chapter/source key, plan digest, `assetId`, `alignmentKind`; retain current ordered IDs, `audioFilePath`, MIME, actual duration, status and anchors. No duplicate source document record. |
| `audio_edition_generation_jobs` (proposed additive table) | One row per edition, persisted existing job status (`idle/generating/paused/completed/error`), desired action (`running/paused/cancelled`), reason/phase, generation epoch, config/plan digest, worker lease, retry/error metadata and timestamps. SQLite is authoritative; Zustand/localStorage summary is a compatibility projection. |
| `audio_edition_generation_segments` (proposed additive table) | Edition/section/ordinal, stable source range anchors, raw and normalized SHA-256, segment key, existing section-status vocabulary, asset ID/digest, frames/duration, retry count, seed, generation epoch and error. No entire-book PCM or duplicate full source text. Unique `(section_id, plan_digest, ordinal)` and idempotent commit key. |
| Existing anchors, additive nullable precision | Exact segment-boundary intervals from actual concatenated sample counts; sentence anchors within a multi-sentence segment explicitly approximate. No estimated `WordTiming` persisted. Legacy unlabeled anchors interpreted as approximate. |

UI states map onto existing public enums; no incompatible new edition lifecycle:

| User label | Edition status | Existing job status / persisted control |
|---|---|---|
| Queued | `draft` (or `generating` if some work exists) | `idle`, desired running, queued reason |
| Loading model | `generating` | `generating`, loading phase |
| Generating | `generating` | `generating` |
| Paused / Waiting for playback | `generating` or initial `draft` | `paused` or `idle`, reason and desired action distinguish user pause from preemption |
| Partially complete | `generating` with ready and nonready sections | `error` if failures require action; otherwise queued/generating/paused projection |
| Ready | `ready` | `completed` |
| Failed | `failed` only if no ready sections; otherwise Partial | `error` |
| Cancelled | `draft`, preserving ready sections/assets | `idle`, desired cancelled, no active lease |
| Source changed | `stale` if source impact requires it | `paused`, source mismatch reason; unchanged sections remain ready |

Persist pause/cancel intent and bump job epoch **before** cancelling native work. Any completion uses a compare-and-swap on edition existence, desired action, epoch and plan/config digests; a late success cannot undo cancellation/deletion/stale state. Simultaneous Start/Resume dedup by durable job lease. Model/default narrator changes affect future sessions only. To change an edition narrator, explicitly create a new edition/configuration or confirm regenerating affected work; never mix voices/quantizations under one immutable plan. Backend/runtime changes similarly require the original pinned profile or a new explicit plan, keeping prior ready sections playable.

Recovery runs once at app startup independently of dialog mount. Expired `generating` leases become queued, retain verified ready segments and reconcile assets. Rebuild remaining text from canonical source and compare hashes before resuming; partial changes mark only affected sections stale. Unchanged descriptors and ready section/bookmarks survive. Missing source text, unavailable model or invalid configuration pauses with an action; it does not use the newest global defaults. Restart automatically resumes jobs whose persisted desired action was running after checks; it never starts playback. User-paused/cancelled jobs stay so. Cache/model directories and durable job metadata must not be cloud-synced as device availability; synced preferences can display download required.

### D7. Atomic audio publication and recovery

Create asset services within existing native audio/edition persistence, not a second audiobook store. Proposed root under the existing app-managed audio area: `audio/tts-cache/` for evictable files and `audio/editions/<edition-id>/` for durable section/segment files. IDs are opaque, validated, app-generated; resolved roots are canonical. No caller may choose an arbitrary output path.

Commit protocol (files and SQLite cannot share a single atomic transaction):

1. Reserve quota/disk and a unique temporary output token in an app-owned staging root; worker writes mono PCM16 WAV incrementally, with bounded buffers. The host reports only the token/metadata; supervisor never trusts an arbitrary returned path.
2. Close/finalize WAV header, validate rate/channels/sample count/duration/size, non-empty finite signal and decodeability; reject output cap without EOS as truncated. Compute SHA-256, flush file (`fsync` equivalent) and atomically rename on the same filesystem to an immutable asset name. Sync the containing directory where supported.
3. In a SQLite transaction, revalidate epoch/config/source hashes/existence, insert/retain asset reference, set segment ready or section ready with anchors and actual duration, update committed progress. Failed CAS leaves an unreferenced asset eligible for cleanup, not a visible ready section.
4. Emit success only after transaction commit. Consumers obtain an asset lease; native/desktop file resolution returns a playable URL. Section assembly streams valid WAV payload frames into a new output with one header; never concatenate WAV headers or load a whole chapter into JS. Preserve segment offsets from actual sample counts. On failure retain valid segment checkpoints and retry assembly.

Startup reconciles DB/files: ready references with missing/corrupt files become recoverable failed segments/sections; `.part` outputs of expired leases are removed; renamed unreferenced files are reclaimed after a 24 h grace unless an active lease/recovery record exists. Exclude installation files/foreign roots. A process crash after rename/before SQL is safe because the file is never falsely ready. Never delete a playing asset; deletion marks an edition tombstoned, cancels its job and retires the current audio owner through existing deletion hooks before final removal. Queue/reference cleanup and manifest deletion occur transactionally; file unlink waits for playback/export/commit leases. Failed deletion remains pending cleanup, does not resurrect metadata, and never deletes the original source.

### D8. One synthesis identity and durable cache facade

Extend `src/utils/ttsCache.ts` and generic `generateSpeech` to support native file assets without `fetch(file).arrayBuffer()` round trips. Preserve V2/legacy IndexedDB reads for existing providers; LFM3 uses a new versioned namespace and never falls through to a legacy cache key lacking revision/language. Edition worker/preview must use this same cache facade rather than direct uncached synthesis. Existing in-flight dedup is extended to reference-count consumer cancellation and native producer lifetime.

Canonical SHA-256 key inputs: provider; source model repo and immutable revision; both artifact hashes/quantizations; runtime build/compatibility profile; effective backend/device profile where output differs; voice/locale; normalized text bytes; normalization/segmentation versions; supported sampling defaults/profile; deterministic per-segment seed; output sample rate/channels/format; optional future adapter digest (empty today). The source range is kept separately for mapping, permitting dedup of identical spoken text across sources. A sliced leading chunk naturally has different normalized text. Narrator speed is excluded for LFM3 because playback alone changes rate. Existing provider cache keys retain current speed semantics.

Use canonical serialized field ordering and locale mapping; do not hash fold-for-search text that loses meaningful punctuation/case. Pronunciation substitutions that change speech are included through transformed bytes/profile digest. Stable seed derives from model/voice/locale/text/profile before final key; no circular key/seed dependency and no GPU bitwise-reproducibility promise. First successfully committed asset wins single-flight; retries record seed/attempt and never overwrite a leased immutable asset.

Native file metadata/index lives in SQLite and is accessed through the existing cache facade, which still exposes one configured logical cache budget (default 500 MiB). Aggregate IndexedDB and native asset byte counts; reserve native quota against remaining logical capacity using serialized facade writes, refresh native stats on startup, and bound the native backend independently as defense in depth. A cache clear/eviction removes eligible cache references and schedules unleased files for removal. Existing IDB entries migrate/read through as before; no mass migration or change of cloud semantics is required. Keep at most a bounded working set of playable URLs. Cache data is a performance aid; a corrupt/missing cache entry is a miss and cannot mark an edition ready.

When an edition adopts a cached segment, promote via same-filesystem hardlink where supported or bounded native copy into edition ownership with its own durable reference; no full-book copy in memory. Permanent assets are exempt from TTS cache eviction/clear and model uninstall. Physical dedup is optional where ownership-safe; do not make correctness depend on cross-platform hardlinks. Show permanent storage separately. At 24 kHz mono PCM16, generated audio is **48,000 bytes/s, 172.8 MB/hour** before headers. Ten hours is about 1.728 GB, independent of 1.437 GB weights. Estimate with measured actual duration when possible, reserve remaining-section space before starting, recheck at commits and pause on ENOSPC with completed work retained.

### D9. Text quality, alignment and output validation

Extend existing normalization with an explicit mapping from normalized spans to original anchors. Never normalize a document in place or treat text cleanup as a measured alignment source. Reuse canonical HTML/Markdown/PDF text and shared packer; preserve source revision/section identity through transformations.

| Input | Initial narration policy |
|---|---|
| Abbreviations/acronyms, dates/numbers | Reuse abbreviation-aware boundaries; preserve ambiguous forms, locale context and exact values. No guessed expansion such as ambiguous dates; add test fixtures per validated locale. |
| HTML/Markdown/links/headings | Read visible labels/headings once, omit formatting syntax and hidden/navigation text; no reading full link URLs by default. |
| Citations/footnotes/endnotes | Preserve meaningful inline markers, do not inject long notes into sentences; retain source anchors and explicit existing preference for inclusion. Never silently drop substantive source paragraphs. |
| Code/math | Honor existing code skip/summary/read and math behavior, but audit destructive regex math expansion; preserve unresolved formulas verbatim or a clearly identified nonspoken span instead of deleting unknown symbols. No invented mathematical meaning. |
| Tables | Reuse canonical cell order with header context where available; disclose structural fallback, never invent row/column associations. |
| Non-Latin/mixed-language | Grapheme-safe segmentation and locale-appropriate punctuation (including CJK); explicit selected locale with validated script coverage. No fabricated per-word timing for whitespace-free scripts; sentence/block fallback. |
| PDF line breaks/hyphenation | Join only where canonical layout supports a broken word; preserve lexical hyphens and uncertain boundaries. Reuse OCR, no second OCR pass. |
| Long paragraphs/titles/punctuation | Split stable sentence/clause spans within both token and frame budgets; titles retained once with natural pause, not duplicated at every subpart. |

There is no reliable word alignment in verified LFM3 output. Persist exact segment start/end audio offsets with source start/end anchors and `alignmentKind=segment`; where a segment spans sentences, interpolated sentence anchors are `estimated`. Live UI uses existing `WordTiming.source=synthesized` transient estimates from actual clip duration, with softer highlighting and no persistence. If normalization changes positional word count, use transformed span mapping; if absent, degrade to sentence/block highlight. Forced alignment is deferred because it adds compute/model/storage and may violate latency goals; existing alignment proposals can provide it later with measured quality.

Generation uses upstream GGUF sampling defaults, not generic UI top-k/top-p knobs: audio temperature 1.0, top-k 128, repetition penalty 1.1, window 4096 unless pinned conversion metadata says otherwise. Capture effective values in profile provenance; verify the host actually honors them. Limits and quality handling apply before publication: empty/invalid duration, NaN/Inf, missing EOS, clipped/near-silent pathological output or known endless code repetition fail with a typed error. Candidate quality thresholds (e.g. >1% full-scale samples or >95% near-silent frames on an expected spoken fixture) require calibration; do not reject normal punctuation pauses solely by heuristic.

One automatic retry per segment for retryable runtime/invalid-output failure, with the same recorded seed/identity. It may recover a transient failure; it is not assumed to repair deterministic bad output. A user-requested new seed/profile is a distinct synthesis identity. No retry on user cancel, unsupported model, missing permissions or ENOSPC. Continued failure leaves the segment failed, retains successful work and offers Retry. Acoustic checks cannot prove words were not omitted/repeated/hallucinated: human and optional offline evaluation corpus in validation is the release gate. Never synthesize replacement filler or silently skip a failed segment. Preserve narrator/config consistency across chapters, reset state between utterances, test joins and natural pauses; no per-chapter random voice selection.

### D10. Security, privacy and licensing

No remote speech request, implicit cloud fallback or document upload. Explicit model/runtime download action displays bytes/license and contacts only approved artifact hosts; installed synthesis works with networking disabled. Runtime/source artifacts are pinned trusted release inputs; HF repos supply data only. No repository scripts, pickle, remote imports or `trust_remote_code`. Validate GGUF sizes/tensor metadata, canonical paths, symlink containment and output quotas; process isolation reduces native crash impact but is **not** a claim of OS sandbox confinement. Restrict host inputs to model files and an output staging token/root; remove arbitrary path/open functionality.

Use `env_clear` with existing per-platform whitelist plus explicit verified native-library paths. Never inherit unrelated auth secrets, arbitrary `LD_PRELOAD`, DLL search paths or model-provided environment values. Bound pipe frame sizes, requests, buffers, model loads and child lifetime. Diagnostic logs contain request IDs, hashes, timings and codes, not private text/audio; detailed error strings are scrubbed. No new unauthenticated HTTP listener; existing media serving is not extended into an inference API. No microphone permission.

Model LFM Open License v1.0 and runtime MIT terms remain distinct. Follow research licensing release gate; store exact model license and applicable NOTICE and include runtime/dependency notices. Commercial publisher/customer eligibility and the threshold-boundary ambiguity require resolution before commercial enablement; no assumption that download delegation grants rights. Training/redistribution/adapter use is outside initial scope.

### D11. Performance, rollout and export

Use [validation.md](validation.md), not vendor claims, to select backend defaults. Phase 1 validates CPU and available accelerator, measured memory/latency/cancel and real audio; Phase 2 registers verified desktop provider/cache/live owner; Phase 3 completes edition durability/UX and release acceptance; Phase 4 optimizes only measured gaps (PCM transport, aligned text, optional fast path); Phase 5 revisits native mobile as a separate change. Live and edition-only classifications are separate per device/backend. An edition-only platform is not counted as completion of the full live reading vision. If no reference backend passes feasibility, stop integration at an evidence report and revise ADR/specs rather than shipping an unsupported runtime.

No mandatory encoder dependency. Initial in-app files are standard WAV. A follow-up can export ordered WAV chapter files plus source/chapters metadata through existing export/file dialogs after all assets are ready. M4B/AAC requires separately established encoder availability, licensing, streaming encode and chapter metadata tests; imported M4B support proves none of these. Export never requires rereading model weights or regenerating valid audio.

## Risks / Trade-offs

- [Experimental helper ABI and model-specific kernels] → Pin source/host protocol and full artifact pair; smoke actual model for every backend/build; fail closed on mismatch.
- [Sentence files add onset/join latency despite upstream PCM streaming] → Short natural first segment, bounded look-ahead and owner preload; enforce live gates or expose edition-only. Incremental transport is a measured follow-up, not a claim about v1.
- [Native process and GPU pack increase package size] → One inference stack, isolated libs, optional CUDA pack, explicit source/dependency manifests and installer budgets.
- [Preemption recomputes incomplete edition segment] → Small bounded segments and durable successful checkpoints; prefer listening continuity over background throughput.
- [Existing global/edition systems incomplete] → Required dependencies/tasks and source-specific tests; do not enable LFM3 by toggling global rollout alone.
- [Cross-filesystem/DB crash window] → Rename-before-transaction, immutable content identities, CAS and orphan reconciliation; ready always implies valid durable asset.
- [No native word times] → Exact segment boundaries, approximate transient word UI, explicit precision metadata; no alignment model in critical path.
- [Model memories/quality differ by backend] → Per-backend profiles/gates, no universal device claim or silent backend/narrator mixing.

## Migration Plan

1. Complete spike/release eligibility checks and rebase shared HF/audio code. No production dependency is introduced before the spike decision.
2. Add nullable provenance/job/segment/asset metadata using the existing ordered migration runner; old edition/status rows remain valid. Old `generationSettings` without version keep legacy interpretation. New snapshots have an explicit schema version; unknown versions are non-runnable but existing audio remains playable.
3. Preserve previous provider selections and old cache namespaces. New LFM3 preference can sync, but runtime/device/model state is local. Unknown-provider fallback must not silently run an unavailable LFM3 preference.
4. Validate legacy generated `blob:`/marker paths on access/recovery. Recover bytes only if the original current-process object URL is still valid and user opts to preserve them; after restart mark missing audio with recoverable status, keeping manifests/bookmarks/source. Do not label an old blob-backed section as durably ready or attempt to fetch a dead URL indefinitely. Imported durable assets are untouched.
5. Enable a target only after runtime/package/live/edition acceptance and upstream desktop ownership parity. Keep platform/workflow feature gates independently reversible. Rollback disables new synthesis and preserves durable WAV playback, manifests and old provider settings. Do not downgrade unknown contracts into sherpa/System or destructively reverse schema migrations.

## Open Questions

Ranked execution evidence to collect; each has a prescribed decision rather than an undefined implementation choice:

1. **P0 full-pipeline/backend feasibility:** Phase 1 must measure M4 Metal, RTX 2060 SUPER CUDA and CPU including codec/cancel. Failures disable that backend/workflow; no runtime substitution without a revised ADR.
2. **P0 commercial eligibility:** Resolve applicable publisher/user/entity and threshold-boundary interpretation with controlling terms/review. Commercial enablement waits for this result; engineering can prepare the optional download path.
3. **P1 live onset/seams:** If complete-segment transport fails live gates, keep edition-only for that profile and scope native PCM transport into the existing owner before claiming live support.
4. **P1 locale and quantization quality:** Validate exact locale roster/voice stability and candidate Q4_K_M/Q8 projector. Disable failing locales/variants; adding a new validated pair requires a new contract digest and repeat tests.
5. **P2 idle memory optimization/export:** Choose unload timeout, compression or M4B only after measurements and separate dependency review. None blocks a correct WAV-based release.
