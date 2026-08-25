# Memory Profile

This document is the evidence home for Incrementum's runtime memory behavior on
Linux, and for the macOS long-running growth investigation (2026-08, below).
The Linux phases are written by the change
`bound-runtime-memory-and-gate` (see `openspec/changes/bound-runtime-memory-and-gate/`):

- **Phase 1 (this file's first section):** how tabs, document bytes, and
  process-global state are structured today — the data-flow map.
- **Phases 2–4:** the reproduction numbers and the per-process profiling
  findings (Heaptrack + WebKit heap snapshots) that justify each fix.
- **Phase 5+:** the fixes, the measured delta each one contributes, the
  post-fix baseline, and the thresholds derived from it.

Every fix task in the change cites a finding from this document.

---

## macOS long-running growth — ~74 GB incident (2026-08)

Evidence home for the change `eliminate-long-running-memory-growth`
(see `openspec/changes/eliminate-long-running-memory-growth/`).

### Incident

- **Observation:** macOS reported a footprint of approximately **74 GB** for
  the Plethora process tree after the app was left running **~10+ hours
  overnight** with no deliberate workload.
- **Machine:** Mac mini, Apple silicon (ARM64), macOS (version recorded with
  the first harness run — Phase 1 task 2.6). Web engine: WKWebView via
  Tauri **2.11.0** (pinned `=2.11.0`) / wry **0.55.1**.
- **Build:** debug build at the 2026-08-23 batch (HEAD of the incident window;
  exact commit not recorded — the session was not instrumented).
- **Not captured:** no per-process breakdown, no vmmap/leaks/sample artifacts,
  no JS heap snapshots. **Attribution to a process, resource category, or
  leak-vs-high-water class is not established.** Every finding below is marked
  **verified code hazard, magnitude unattributed**.
- **If it recurs before the harness lands:** run
  `bash scripts/memory-bench/capture-tree.sh` immediately (see below) — it
  captures the per-process artifacts this incident lacks.

### Verified findings at HEAD (2026-08-24), with introduction evidence

`git log -S` was run for each mechanism (evidence recorded 2026-08-24).
Mechanisms 1, 2, 4 (hardening), 5, and 7 entered in the 2026-08-19 →
2026-08-23 reliability/feature batch. Mechanisms 3 and 6 predate the window —
they are long-standing hazards the audit surfaced, not fresh regressions, and
they are in scope because the incident platform (macOS/WKWebView) was never
measured before.

| # | Mechanism (**verified code hazard, magnitude unattributed**) | Location (HEAD) | Introduced (`git log -S`) | Bounded? |
|---|------|----------|-----------|----------|
| 1 | Global error/rejection history pushed per occurrence in **every build incl. production**; a repeating error grows it without limit (10 h × ~2 M frames ≈ millions of `{type,message,stack}` objects) | `src/main.tsx:91-93,115-117` (`window.__plethoraTestErrors`) | `4570af60` 2026-08-23 (iOS reliability harness) | No — no cap, no dedup |
| 2 | Module-global `Map` of section-id → `blob:` URL for synthesized audio; no cap, no revoke on replace (re-synthesis orphans the old URL's Blob), none on edition delete/cancel/teardown; `AudiobookViewer` pins every ready section as a live playlist source | `src/stores/audioEditionGenerationStore.ts:58,232`; consumed at `src/components/viewer/AudiobookViewer.tsx:939-960` | `acf89b62`/`58fef98e` 2026-08-19 (audio editions) | No |
| 3 | TTS cache opens a **new IndexedDB connection per operation** (`indexedDB.open` per call) and never `close()`s it; repeated lookups accumulate `IDBDatabase` handles | `src/utils/ttsCache.ts:26-48`; call sites `ttsCache.ts:232,258,297,309,326,343` | `0fffab9d` 2026-04-26 (predates window) | No |
| 4 | TTS cache eviction cursoring the **entire store and materializing every cached `ArrayBuffer`** into a JS array to pick victims; triggered after every over-size put — steady-state synthesis re-reads up to the whole 500 MB cache into the WebContent process per put | `src/utils/ttsCache.ts:175-228` (`ensureCacheSize`), triggered at `:283` | payload materialization: `271115f8` 2026-08-19 (cache itself `0fffab9d` 2026-04-26) | No |
| 5 | Permanent 1 s `setInterval` heartbeat for the whole app lifetime in all builds (`data-plethora-heartbeat`); the bootstrap twin correctly stops on settle | `src/main.tsx:580-583`; bounded twin `src/main-bootstrap.ts:86-114` | `4570af60` 2026-08-23 | Lifecycle only |
| 6 | Desktop (incl. macOS) audiobook/podcast playback reads the **entire file** into an `ArrayBuffer` → `Blob` → object URL; mobile already streams via `get_media_stream_url` | `src/components/viewer/AudiobookViewer.tsx:1685-1696`; podcast-download fallback sibling above it | `078ee133` 2026-04-21 (predates window) | No |
| 7 | ~40 `URL.createObjectURL` call sites / ~50 revokes with no central ownership; every persistent-cache hit mints a fresh Blob+URL from the stored `ArrayBuffer` | e.g. `src/api/tts.ts:211,217`, `src/api/tts/providers/shared.ts:85`, `providers/openrouter.ts:102`; correct pattern at `src/components/common/ReaderTTSControls.tsx:994-996` | cache-hit minting: `271115f8` 2026-08-19; provider sites `bf910d38` 2026-07-31 | Per-site |

### Accumulator audit of the 2026-08-19 → 2026-08-23 batch (Phase 0, task 1.3)

Every module-level `Map`/`Set`/array and `window.*` assignment added to `src/`
in that window was enumerated from the diff
(`git diff 91d04a40..122ce6bd -- src/`, where `91d04a40` is the last commit
before 2026-08-19) and each site read and classified (audit run 2026-08-24):

| Module-level state introduced in the window | Verdict |
|---|---|
| `src/main.tsx` — `window.__plethoraTestErrors` array | **Unbounded** — finding 1 |
| `src/stores/audioEditionGenerationStore.ts` — `sectionAudioBlobCache: Map<string,string>` | **Unbounded** — finding 2 |
| `audioEditionGenerationStore.ts` — `pausedJobIds`/`cancelledJobIds: Set` | Bounded — ids removed on resume/restart; tracks live jobs |
| `src/api/audioEditions.ts` — `browserEditionStore`/`browserSectionStore`/`browserAnchorStore` (PWA in-memory backend) | Bounded-by-usage — mirror persisted entities, deleted in `deleteAudioEdition`; browser mode only |
| `src/api/listeningSessions.ts` — `browserSessionStore`/`browserSessionItemsStore` | Bounded-by-usage — same pattern |
| `src/utils/listeningSessionService.ts` — `activeSessions: Map` | Bounded — closed on inactivity (2 min)/content change |
| `src/utils/remoteMediaDispatcher.ts` — `acceptedEventIds: Map` | Bounded — pruned past a dedupe window; `lastCaptureBySession` one entry per session, cleared |
| `src/utils/firstViewDiagnostics.ts` — `samples` array, `seenChunks`/`seenViews` Sets | Dev/opt-in gated — inert in production builds (no pushes when the gate is off) |
| `src/stores/documentStore.ts` — `threadCache: Map` | Bounded — TTL-evicted on access |
| `src/api/tts/dedup.ts` — `inflight: Map` | Bounded — deleted in `finally` |
| `src/utils/aiBillingConsent.ts` — `deniedThisSession: Set` | Bounded — one entry per provider |
| `PAID_PROVIDERS`, `STOPWORDS`, `BLOCK_TAGS`, `OS_VISIBLE_STATES`, `CATALOG_BY_ID` | Bounded — static constants |
| mock-db maps (`mockEditions` etc.) | Test/bench files only — never shipped |

No *additional* unbounded global accumulator beyond findings 1 and 2 was found
in the window. The only new `window.*` assignments were
`__plethoraReactRoot` (a root handle) and feature-detect polyfills.

### Phase 0 capture tooling

`scripts/memory-bench/capture-tree.sh <rootPid>` snapshots the whole Plethora
process tree: `ps` table, per-pid `vmmap -summary`, `leaks`, and a 10 s
`sample`, timestamped into `.bench/tree-captures/<UTC-timestamp>/`. It is a
**manual diagnostic artifact, not a collector** — run it first if the incident
recurs. (See also Phase 4 §"manual deep-attribution workflow" for the
checkpoints A–F protocol.)

### Object-URL ownership conversions (Phase 4-fix, task 5.7)

| Site | Owner | Bounded by what |
|---|---|---|
| TTS provider results (`providers/shared.ts` `binaryResult`, `providers/openrouter.ts`) | `tts-synthesis` | caller revoke (ReaderTTSControls already does) + registry observability |
| Persistent-cache hits (`api/tts.ts`, v2 + legacy keys) | `tts-cache-hit` + cache key | caller revoke; every playback's mint is now observable |
| Synthesized section audio (`audioEditionGenerationStore`) | `edition-section` + section id (via the store LRU) | LRU caps (24 entries / 192 MB), revoke on evict/replace, revoke on edition delete / job cancel / source-document delete |
| Desktop whole-file playback fallback (`desktopAudioSource.ts`) | `desktop-audio-fallback` | streaming default; fallback materialization refused >256 MiB by the backend before transfer |
| Edition-dialog voice audition (`CreateAudioEditionDialog.tsx`) | `edition-audition` | revoke on replace / ended / error / dialog dismiss (previously never revoked) |

Audit verdicts for the remaining media-path `createObjectURL` sites (no
conversion needed — each is already bounded): `localMediaSource.ts` (one URL
per viewer; `revokeSrcOnDispose` honored on source swap and unmount in
`DocumentViewer.tsx:1068,2704`), `MediaLibrary.tsx` and `RSSReader.tsx`
(download-link pattern, revoked immediately after click), `VideoPlayer.tsx`
(screenshot download, revoked after click).

None of the findings above is yet shown to *be* the 74 GB; each is a verified
code hazard whose magnitude the change's attribution phases must establish.
macOS measurement, soak tiers, resource diagnostics, and the fix/verification
phases are specified in the change above; results land here as they are
produced.

### macOS harness status — WORKING; first before-numbers recorded (2026-08-25)

The e2e harness now runs the full scenario reliably on macOS. Getting here
required fixing a chain of latent defects, each surfaced by the harness
itself (all fixed in-tree):

1. **Bare `cargo build` keeps `devUrl`** — the webview pointed at a
   non-running dev server, so no JS ever executed. Build via
   `npm run tauri:build:local:debug` (embeds `dist`).
2. **Step-delivery shape mismatch (predecessor latent bug)**: the control
   server sent `{step:{...}}` (nested) while the app's `normalizeStep`
   expects flat fields — every step was silently treated as idle. The
   predecessor's e2e had never run against the real app.
3. **CORS**: with embedded assets the page originates from
   `tauri://localhost`; the control server now sends CORS headers +
   preflight, drops disconnected long-poll waiters, and uses tiny holds +
   `Connection: close` (WKWebView swallows responses written to connections
   that waited).
4. **Self-blocking quiescence (predecessor latent bug)**: the host kept the
   activity counter raised through the settle step's own quiescence wait —
   a settle could never report quiet. The busy window now covers only step
   execution.
5. **Fixture PDFs had 8-byte-short xref offsets** (the header line's length
   was never counted): pdf.js tolerated it, Rust `pdf-extract` refused
   ("Invalid file trailer"). Generator fixed; corpus hashes updated.
6. **Edition-cycle fixture defects**: FK violation on a synthetic document
   id (now anchored to the real corpus document) and re-creating the same
   edition id on retry (unique-constraint; the retry now uses its own id).
7. **macOS 26 process attribution**: `kern.procargs2` is denied system-wide
   (the run-ID environment marker is unreadable — D3's open question
   resolved), and WKWebView helpers are XPC services reparented to launchd
   (PPID 1, own process group). Per-role attribution uses a DIFFERENTIAL
   baseline: the driver snapshots pre-existing WebKit helpers before
   launch; WebKit processes appearing after launch belong to the app. The
   pre-launch snapshot still guarantees an already-running application's
   helpers are never absorbed; a foreign app spawning helpers DURING the
   run is the documented blind spot (acceptable on a dedicated bench
   machine). Process-info syscalls also require an unsandboxed context —
   run the driver from a normal terminal.

**First "before" numbers (tasks 2.7/2.8/4.4)** — `.bench/memory-result-macos-before.json`,
Apple M4 / 16 GiB / macOS 26.5.1, debug build, 2026-08-25, all stages
settled, `reliable: true`:

| Stage | Total | native | web-content | GPU (other) | network |
|---|---|---|---|---|---|
| idle-fresh | 1.09 GB | 607 M | 371 M | 99 M | 9 M |
| one-doc | 1.92 GB | 610 M | **1194 M** | 102 M | 9 M |
| two-tabs | 1.87 GB | 611 M | 1151 M | 104 M | 9 M |
| four-tabs | 1.88 GB | 611 M | 1155 M | 104 M | 9 M |
| all-closed | **1.92 GB** | 611 M | **1192 M** | 112 M | 9 M |
| single-cycles/0 | 1.93 GB | 611 M | 1194 M | 112 M | 9 M |
| single-cycles/3 | 2.02 GB | 612 M | 1236 M | 159 M | 9 M |
| multi-cycles/3 | 2.03 GB | 612 M | 1250 M | 159 M | 9 M |
| tts-cycles/0..3 | 2.03 GB | 613 M | 1245–1250 M | 158 M | 9 M |
| edition-cycles/0..1 | 2.03 GB | 613 M | 1247 M | 157 M | 9 M |
| idle-final | 2.03 GB | 613 M | 1248 M | 157 M | 9 M |

Readings (verified code hazards, magnitude now partially attributed):

- **First-PDF cost is +823 M in the WebContent process** (371→1194 M) and
  **closing does not return it** (1192 M at all-closed). Whether this is
  WebKit backing-store high-water or live retention is exactly what the
  Phase 4 Instruments/heap-snapshot workflow must classify.
- **Open/close cycles ratchet web-content ~7 M/cycle** (1194→1250 M across
  8 single + 8 multi cycles at this scale). This is the leak-shaped signal
  the ratchet gate exists to catch; the nightly soak quantifies the idle
  slope.
- **TTS and edition cycles are FLAT** (1245–1250 M throughout): the new
  bounded paths (owned URLs, LRU section cache, single IDB connection,
  metadata-only eviction) hold at bench scale — the 4.1/4.2 reproduction
  stages show no unbounded growth from these subsystems on their own.
- **Diagnostics stay bounded in the real app**: live owned URLs return to 0
  after every stage, TTS cache connections stable at 1, error aggregates 0,
  section cache within caps.

```bash
# Reproduce (build embeds dist; run from a normal, unsandboxed terminal):
npm run tauri:build:local:debug
node scripts/memory-bench/driver.js --output .bench/memory-result-macos-before.json > .bench/before.log 2>&1
node scripts/memory-bench/driver.js --soak nightly --output .bench/soak-before.json > .bench/soak-before.log 2>&1
```

(The soak flag takes a SPACE-separated argument: `--soak nightly`. The
`--soak=nightly` form prints usage and exits — a run lost to exactly this
on 2026-08-25.)

### Release-build comparison (2026-08-25)

`.bench/memory-result-macos-release.json` — same machine, same scenario,
release build (`npm run tauri:build:local`, binary passed via `--app
src-tauri/target/release/plethora-tauri`), `reliable: true`:

| Stage | Total | native | web-content | GPU (other) | network |
|---|---|---|---|---|---|
| idle-fresh | 1.03 GB | 462 M | 437 M | ~107 M | 21 M |
| one-doc | 0.83 GB | 215 M | 485 M | ~112 M | 21 M |
| four-tabs | 0.85 GB | 170 M | 544 M | ~112 M | 22 M |
| all-closed | 0.92 GB | 170 M | 609 M | ~113 M | 22 M |
| single-cycles/3 | 1.10 GB | 170 M | 708 M | ~203 M | 22 M |
| multi-cycles/7 | 1.03 GB | 173 M | 718 M | ~120 M | 22 M |
| tts-cycles/0 | 1.03 GB | 174 M | 719 M | ~119 M | 22 M |
| tts-cycles/11 | 1.06 GB | 174 M | 745 M | ~121 M | 23 M |
| edition-cycles/5 | 1.09 GB | 175 M | 770 M | ~119 M | 23 M |
| idle-final | 1.09 GB | 175 M | 772 M | ~118 M | 23 M |

Comparison readings:

- **The debug build was ~440 M of the native footprint** (613 M → 173 M
  steady-state release). Normal-use idle total is ~1.0 GB, not 1.1–2.0 GB.
- **The +823 M debug first-PDF spike is largely a debug artifact**: the
  release WebContent process pays ~+50 M for one fixture document (437→485 M).
  The debug web-content numbers are inflated by unoptimized JS/WASM paths.
- **The retention/ratchet signal SURVIVES in release**: closing the document
  leaves web-content at 609 M (vs 485 M open), and it never returns to the
  437 M baseline, climbing to 772 M by idle-final (+335 M over the run).
  The leak-shaped behavior the fix phases target is real, not build noise.
- **TTS/edition cycles remain near-flat in release** (719→745 M over 12 TTS
  cycles is mostly the same slow ratchet seen in open/close cycles, ~2 M per
  cycle, not a TTS-specific slope).

```bash
npm run tauri:build:local
node scripts/memory-bench/driver.js --app src-tauri/target/release/plethora-tauri --output .bench/memory-result-macos-release.json > .bench/release-before.log 2>&1
```

### Manual deep-attribution workflow (task 6.1, design D10)

Fixed checkpoints over one profiling session on macOS, executed with
Instruments + Safari Web Inspector against the debug build:

| Checkpoint | State | Capture |
|---|---|---|
| **A** | Fresh idle, 60 s after launch | Allocations generation mark, VM Tracker, WKWebView heap snapshot, `capture-tree.sh` |
| **B** | One document open (large PDF), settled | same set |
| **C** | Document closed, 60 s idle | same set — *everything unexpected still alive here gets its retaining path recorded* |
| **D** | 25 open/close cycles | same set |
| **E** | 100 open/close cycles (or 25 TTS + 25 edition cycles) | same set |
| **F** | Idle soak ≥ 1 h (or the tail of a `nightly` tier run) | same set |

Procedure:

1. **Instruments** (Xcode → Open Developer Tool → Instruments), attach to the
   `plethora-tauri` process:
   - **Allocations** with *generation marks* at every checkpoint — the
     generation delta between C→D→E separates steady-state churn from
     retained growth.
   - **Leaks** at C and E — names non-JS native leaks.
   - **VM Tracker** at every checkpoint — classifies dirty/clean/swapped per
     region (WebKit backing stores show up here).
2. **WKWebView JS heap snapshots**: run the app, then Safari → Develop →
   [Mac mini] → Plethora webview → heap snapshot at each checkpoint. Compare
   A/B/C/D/E for: `ArrayBuffer`, `Uint8Array`, `Blob`, strings, detached DOM
   nodes, `HTMLCanvasElement`, `ImageData`, pdf.js objects
   (`PDFDocumentProxy`, page buffers), media elements (`HTMLAudioElement`),
   listener closures, reader/store objects.
3. **CLI artifacts** at every checkpoint:
   `bash scripts/memory-bench/capture-tree.sh <pid>` (ps + vmmap + leaks +
   10 s sample, timestamped).
4. **Retaining paths**: for everything unexpected alive at C, record the
   retaining path from the heap snapshot (who holds it: URL registry? store
   state? closure? WebKit internal?).

**Classification buckets** (task 6.2): for each finding, record one of —
*live-reachable* (JS/DOM retains it), *allocator high-water* (freed but not
returned; VM Tracker shows it), *WebKit backing store* (dirty memory outside
the JS heap), *reclaimable cache*, or *true native leak* (Leaks tool).
Allocator remedies remain forbidden without high-water evidence
(predecessor D13). **Status: documented; execution pending an attended
session (see harness status above).**

### Gate self-test and baselines (tasks 8.3/8.4 — procedure)

1. Run the harness with
   `node scripts/memory-bench/driver.js --synthetic-leak-mb 1 …` sized to
   stay under every peak ceiling: `check-memory-budget.mjs` must FAIL on
   `idle-growth-per-hour` / the cycle ratchets while every peak metric
   passes — proving the slope catches what the ceiling hides (the slope math
   itself is unit-tested on linear / plateau / noisy fixture series).
2. Record macOS baselines into `scripts/memory-baselines.json` per the
   existing conventions (machine profile with `platformKind: "darwin"`,
   per-metric baseline + allowances, ratchet parameters, soak parameters),
   then sanity-check: doubling a gated metric fails; repeated unchanged runs
   on the same machine pass.
3. Nightly soak on the Mac mini against the fixed build, artifacts kept on
   failure (per README §"Operating procedure").

**Status: procedures implemented; empirical runs pending the attended
session.**

### Architecture/lifetime model as implemented (task 8.6, code state)

- **URL ownership**: every synthesized/cache-hit audio URL is created through
  the owned-URL registry (`src/diagnostics/ownedObjectUrl.ts`) with an owner
  category; the registry stores metadata only (never the Blob), is inert in
  production (no bookkeeping writes when the gate is off), and reports
  per-owner counts/bytes through `getDiagnosticSnapshot()`.
- **Section audio cache**: bounded LRU (24 entries / 192 MB documented caps)
  with revoke on evict/replace, and revoke-all on edition deletion, job
  cancellation, and source-document deletion. Playback resolves a working
  set (current + next 2 sections) from section records with boundary
  prefetch; an N-section edition no longer pins N blob URLs.
- **TTS cache**: one promise-cached shared IndexedDB connection (closed on
  `clearAudioCache` and pagehide); eviction picks victims from a metadata-only
  index and deletes by key — payload ArrayBuffers are never materialized to
  choose victims; cache hits update metadata instead of rewriting payloads;
  a one-time key-only backfill sizes pre-v3 entries on first access.
- **Error recording**: bounded signature aggregation (≤64 distinct,
  lowest-count-oldest evicted; messages normalized and truncated; one sample
  stack per signature), inert in production unless the diagnostics switch is
  armed; the iOS reliability harness contract moves to
  `getDiagnosticSnapshot().errors`.
- **Test-only timers**: the permanent heartbeat installs only behind the
  same gate (`src/diagnostics/livenessHeartbeat.ts`).
- **Desktop audio playback**: streams through the native media server by
  default; the whole-file fallback is bounded by the backend's 256 MiB
  pre-materialization refusal.

### Remaining limitations (honest state at close of implementation)

1. The macOS **before/after numbers, attribution, Instruments workflow
   execution, nightly soaks, and baselines** are pending a run against an
   embedded-dist build (`npm run tauri:build:local:debug`): the earlier
   failures were devUrl-only binaries, not a harness defect (see "macOS
   harness status").
2. The synthetic-leak **gate self-test run** (live harness + comparator) and
   the optional CI macOS soak job decision (task 8.5) are likewise pending;
   the slope/ratchet math itself is fixture-tested.
3. `sectionAudioBlobCache`'s byte cap uses the adapter-reported
   `audioData.byteLength` (falling back to registry estimates) — providers
   that return URLs without `audioData` size their entries by count only.
4. Edition `audioFilePath` values persisted in the DB are session blob URLs;
   the working set re-resolves through the live cache first, but a section
   never re-synthesized after its URL's session died falls back to the stale
   path (pre-existing behavior; the disk-backed edition target in D7 is the
   systematic fix).

---


## Phase 1 — Data-flow map (how memory is held today)

All file:line references are to the repository at the time of writing (change
`bound-runtime-memory-and-gate`, Phase 1).

### 1.1 The tab model

Incrementum runs **one Tauri window with one WebView**. There is no
multi-process or iframe-based tab system; "tabs" are React subtrees rendered by
`TabContent` (`src/components/common/Tabs/TabContent.tsx`) inside a single pane
div.

- A tab **mounts only after it has been active once**: `TabContent` keeps an
  `activatedRef: Set<string>` of tab ids it has rendered while active
  (`TabContent.tsx:204`), and `isMounted = isActive || (activatedRef.has(id) && !evictedTabIds.has(id))`
  (`TabContent.tsx:223-224`). Session restore therefore mounts only each pane's
  active tab, not every restored tab (`tabsStore.ts:1648-1656`).
- Once mounted, a tab **stays mounted** when it becomes inactive. Inactive tabs
  are merely CSS-hidden: `className={isActive ? "h-full w-full animate-tab-enter" : "hidden h-full w-full"}`
  (`TabContent.tsx:228`). The component tree, its effects, its subscriptions,
  and its loaded document stay alive. The only thing that unmounts an inactive
  tab is membership in `evictedTabIds`.
- `evictedTabIds` is a runtime-only set (`tabsStore.ts:150-162`) computed by
  `applyResidentCap` (`tabsStore.ts:356-385`), which runs **only in
  `setActiveTab`** (`tabsStore.ts:866-899`) — activation is the only moment the
  resident set can grow. The cap is `general.residentTabCap` or
  `DEFAULT_RESIDENT_TAB_CAP = 8` (`tabsStore.ts:328-334`).
- **Only three tab types are evictable today**: `dashboard`, `analytics`,
  `continue-reading` (`EVICTABLE_TAB_TYPES`, `tabsStore.ts:311-315`).
  **`document-viewer` is not on that list**, so no document reader can ever be
  evicted by the cap — the cap is about cheap, re-fetchable views, not about
  expensive readers. With the default cap of 8 and only three evictable types,
  a four-tab reading session never unmounts anything.
- Active tabs (each pane's `activeTabId`) are exempt from eviction
  (`collectActivePaneTabIds`, `tabsStore.ts:337-344`).
- **Close** (`closeTab`, `tabsStore.ts:796-863`) removes the tab from `tabs`,
  `rootPane`, and `activeTabHistory`, and clears it from `evictedTabIds`.
  Because `TabContent` renders only tabs present in `tabs`, closing a tab does
  unmount its subtree — close is the only path that tears a mounted reader
  down today. What that teardown does and does not release is documented in
  §1.4.

**Consequence for memory:** "four tabs open" means four fully mounted,
fully live reader component trees in one WebView, and no mechanism — short of
closing tabs — ever unmounts them. This confirms the architecture claim in
`proposal.md` ("Four simultaneously live readers") and `design.md` Context
constraint 1 ("the only unmount mechanism is `tabsStore`'s resident cap ... at
four tabs nothing is ever unmounted").

### 1.2 Desktop PDF byte path (whole-file path)

The desktop PDF load path materializes the entire file, in several simultaneous
copies. End to end (file size N):

| # | Where the copy lives | How | file:line |
|---|----------------------|-----|-----------|
| 1 | Rust native heap | `tokio::fs::read` → `Vec<u8>` | `src-tauri/src/commands/document.rs:1320` |
| 2 | IPC message buffer (native) | `tauri::ipc::Response::new(bytes)` raw binary response | `document.rs:1336` |
| 3 | WebView main-thread JS heap | `ArrayBuffer` deserialized from IPC | `src/api/documents.ts:365` |
| 4 | WebView main-thread JS heap | `new Uint8Array(rawBytes)` (independent buffer) → React state `fileData` | `src/components/viewer/DocumentViewer.tsx:2110-2111` |
| 5 | WebView main-thread JS heap | `clonePdfData` → `new Uint8Array(fileData)` | `src/components/viewer/pdfLoadSources.ts:13-15, 40` |
| 6 | pdf.js worker heap | postMessage transfer of copy 5's `ArrayBuffer` (`data`) | `PDFViewer.tsx:1302` (getDocument data source) |

Flow: `DocumentViewer.loadDocumentData` calls
`documentsApi.readDocumentFile(doc.filePath)` (`DocumentViewer.tsx:2099`), which
invokes the Tauri command `read_document_file` (`src/api/documents.ts:361-367`)
→ Rust `read_document_file` (`document.rs:1264-1337`) reads the whole file
(capped at **256 MiB** on desktop, `document.rs:1309`; 16 MiB on Android,
`document.rs:1283`). The bytes return as a raw binary IPC response (no
base64/JSON), deserialize into an `ArrayBuffer` (copy 3), are defensively copied
into `fileData` (copy 4 — the comment at `DocumentViewer.tsx:2107-2109` says the
copy exists because WebView2 can detach the buffer during IPC transfer), stored
in React state, and passed to `PDFViewer` as `fileData`. `createPdfLoadSourceFactories`
clones it once more (`clonePdfData`, `pdfLoadSources.ts:13-15`) and hands that
clone to `pdfjsLib.getDocument({ data })`, whose `postMessage` **transfers** the
clone's `ArrayBuffer` to the pdf.js worker (copy 6).

- **Peak simultaneous whole-file copies: ~6** (2 native: Vec + IPC buffer; 3
  webview main-thread JS: IPC ArrayBuffer, `fileData`, clone; 1 worker).
- **Steady state after load:** copies 2 and 3 are freed and copy 5 is detached
  by the transfer, leaving **two persistent full-file copies**: `fileData` in
  the webview main-thread JS heap (held by React state for the tab's lifetime)
  and the transferred buffer in the pdf.js worker heap (held by the
  `PDFDocumentProxy`/loading task — see §1.4 for why it is never released).
- pdf.js's worker is configured via `workerPort`/`workerSrc`
  (`PDFViewer.tsx:291-296`).
- The **mobile range path** (`PDFDataRangeTransport`) exists and avoids all of
  this: `NativePdfRangeTransport` (`src/components/viewer/nativePdfRangeTransport.ts`)
  fetches ≤512 KiB chunks (`MAX_PDF_RANGE_BYTES`, `src-tauri/src/commands/pdf_mobile.rs:13`)
  via `read_pdf_document_range` with identity re-validation
  (`pdf_mobile.rs:288-319`), and caches at most 24 chunks
  (`nativePdfRangeTransport.ts:12`). But it is gated to native mobile:
  `shouldUseNativeMobilePdfSource` returns `nativeMobile && fileType === "pdf" && isPdfFeatureEnabled("nativeMobileRangeSource")`
  (`src/components/viewer/pdfFeatureFlags.ts:24-31`, flag default `true` at
  `:11`), and the call site is inside `if (isNativeMobile() && inferredType === "pdf")`
  (`DocumentViewer.tsx:2049-2058`). **Desktop never enters that branch**; every
  desktop PDF goes through `readDocumentFile`.

**Confirmed against the proposal/design:** `proposal.md` Why bullet 2
("Whole-file PDF transfer on desktop") and design D10 are accurate as written:
two defensive copies exist solely to survive buffer detachment
(`DocumentViewer.tsx:2107-2109`, `pdfLoadSources.ts:13`), the streaming range
path is mobile-only, and `clonePdfData`'s copy sits on the whole-file path only.

### 1.3 EPUB and other content byte paths

**EPUB — streams; no whole-file copy.** The loopback `epub_server`
(`src-tauri/src/epub_server.rs`) is merged into the shared media-server
listener (`media_server.rs:91-94`). `epub_handler` never reads the whole file:
it opens `tokio::fs::File` (`epub_server.rs:99`), serves `Range` requests via
`seek` + `ReaderStream::new(file.take(length))` (`epub_server.rs:149,172`) and
non-range requests as a stream (`:187`). `get_epub_stream_url`
(`epub_server.rs:277-306`) returns `http://127.0.0.1:<port>/epub/book.epub?path=…`;
files outside app roots are mirrored to disk, not to memory
(`mirror_epub_into_app_storage`, `epub_server.rs:206-248`). Frontend:
`DocumentViewer` calls `getEpubStreamUrl` and sets `epubUrl`
(`DocumentViewer.tsx:2070-2076`); `EPUBViewer` opens it with `ePub(fileUrl, { openAs: "epub" })`
(`EPUBViewer.tsx:798-799`), and epub.js/JSZip issue their own byte-range
requests. A whole-file fallback exists (`fileData.slice().buffer`,
`EPUBViewer.tsx:800`) but is only used when no URL exists (web mode / legacy
callers). **Verdict: EPUB cannot hold the whole file in memory on the Tauri
path.** Rust tests assert a 64 MiB response is constructed lazily
(`epub_server.rs:526-564`, `media_server.rs:633-671`).

**Image registry — whole-file copies everywhere.** `list_image_assets`
(`src-tauri/src/commands/image_registry.rs:264-271`) materializes a data URL
for every asset: a ≤256 px thumbnail (`thumbnail_data_url`, `:380-392`) with
**full-base64 fallback** (`encode_data_url`, `:375-378`) when decode fails, and
`get_image_asset` (`:273-280`) always emits full base64
(`to_dto_with_usage`, `:339-354`). The repository layer does `SELECT *`
including the BLOB column on list (`repository.rs:3037-3078`), so every asset's
full bytes land in the Rust heap on every list call, become a ~4/3× base64
string, cross IPC, and are re-decoded by the browser. Images are ingested with a
10 MiB cap (`image_registry.rs:14`). **Verdict: the image registry can hold
whole files in memory (Rust heap + JS heap string) for every listed asset.**

**Audio/audiobook — streams; whole-file only in a desktop fallback.**
`media_server` (`src-tauri/src/media_server.rs`) streams `tokio::fs::File` +
`ReaderStream` with Range support (`media_server.rs:318,346,392,407`); it never
materializes the file. `get_media_stream_url` (`:421-489`) returns a loopback
URL; `AudiobookViewer` uses it as the primary source
(`AudiobookViewer.tsx:534-635`). The desktop **fallback** path
`loadFallbackAudioSource` uses `readDocumentFile` → `Uint8Array` → blob URL
(`AudiobookViewer.tsx:1345,1398-1403`; `localMediaSource.ts:256-279`), which
does hold a whole-file JS copy. Mobile throws instead of reading whole files
(`localMediaSource.ts:243-245`).

**Local video — streams.** `DocumentViewer` resolves `resolveLocalMediaSource(doc.filePath, "video")`
(`DocumentViewer.tsx:2158-2173`) to a loopback URL (or a desktop blob-URL
fallback that holds a whole-file JS copy, `localMediaSource.ts:260-263`);
`LocalVideoPlayer` binds `<video src>` (`LocalVideoPlayer.tsx:1170-1194`) and
never reads bytes itself. The `<video>` element handles range streaming.

**Transcripts — text, not binary.** YouTube transcripts come via IPC or HTTP
as JSON segments (`src/api/youtube.ts:290-312`,
`src/lib/transcript/sourceChain.ts:173-199`); doc transcripts via
`getTranscript`/`saveTranscript` IPC (`src/api/transcription.ts:89-106`) and
`getVideoTranscript` (`src/api/video-extracts.ts:293-305`); stored in SQLite
(`commands/video.rs:232-241`, `repository.rs:5253,5303`). Whole-string in the
JS heap but text-sized relative to media; **no binary file materialization**.

**Summary of whole-file-in-memory surfaces:** the desktop PDF path
(`readDocumentFile` for PDFs) is the biggest one during a reading session,
followed by the image registry's list/grid view and the desktop blob-URL
fallbacks for audio/video. EPUB, audiobook, and video on their primary paths
stream from disk.

### 1.4 Frontend retention inventory

**PDF viewer (`src/components/viewer/PDFViewer.tsx`) — the retention hotspot.**

| Object | Held where | Disposal |
|---|---|---|
| `PDFDocumentProxy` (`pdfDoc`) | React state `pdf` (`:467`), set via `setPdf(pdfDoc)` at `:1340` | **Never destroyed.** `pdfDoc.destroy()` is called nowhere in the file (grep: no `.destroy(` on the document; only per-page `PDFPageView.destroy()` and EPUB `Book/Rendition.destroy()` exist elsewhere). The unmount cleanup at `:1395-1399` only does `mounted = false; for (const transport of nativeTransports) transport.abort(); passwordSubmitRef.current = null;`. |
| `loadingTask` | Local variable inside `loadPDF`/`loadDocument` (`:1261,1302,1318`) | **Never destroyed** (`loadingTask.destroy()` called nowhere). Not even stored in a ref. If the tab unmounts mid-load, the `mounted` flag stops `setState`, but the task keeps fetching and parsing. |
| `NativePdfRangeTransport[]` | closure (`:1220`) | `transport.abort()` in unmount cleanup (`:1397`) ✅ |
| Page views / canvases | per-page `PdfPageView` in `PdfPageView.tsx`; `canvasRefs` (`:536`) | `PdfPageViewWrapper` cleanup calls `pageView.destroy()` + `div.remove()` and nulls refs (`PdfPageView.tsx:183-204`) ✅ — but the underlying `PDFPageProxy`s stay alive until the parent `PDFDocumentProxy` is destroyed (never). |
| `textCacheRef` (`Map<number,string>`) | ref (`:564`) | Cleared on new-document load (`:1347`); on unmount it is GC'd with the component. One entry per visited page (bounded by page count). |
| `renderedPagesRef`, `pageSearchMatchesRef`, `pageTextSelectionAvailabilityRef` | refs (`:3294,575,568`) | Refs; reclaimed on unmount. |
| Reflow caches | `reflowCacheRef` (`:479`) → `IndexedDbPdfReflowCache` (`pdfReflowCache.ts:40`); in-memory `Map` fallback only when IndexedDB is unavailable (`:20-34`); `reflowSchedulerRef` (`:480`) | Scheduler `.cancel()`ed in effect cleanup (`:1406,1448`) ✅; IndexedDB-backed pages persist to disk, not memory. `reflowOcrRef` controller (`:488`) is **not** cancelled on unmount (only on the OCR cancel button, `:3750`). |
| `vimRuntimeListenersRef` (`Set`) | ref (`:538`) | Not cleared on unmount (ref, GC'd). |

Timers/listeners/subscriptions in `PDFViewer.tsx`: the module-scope
`unhandledrejection` swallow (`:336`) is a single intentional install; all
per-instance `window`/`document` listeners and the `ResizeObserver`
(`:2080-2175`) are removed/disconnected (`:514,818,844,2411-2413,2174`); the
position-save timer is cleared **and the position flushed** on unmount
(`:1853-1858`); navigation-settle timer cleared (`:1859`). Two one-shot RAFs
(`scrollRafRef` `:3369`, `offsetsUpdateRafRef` `:3308`) are self-nulling and
not cancelled — harmless.

**EPUB viewer (`EPUBViewer.tsx`) — teardown is complete.** `Book.destroy()` is
called (deferred until book/locations settle, `:1525-1534` via
`destroyBookInstance` `:774-778`); `Rendition.destroy()` is called (`:1522`);
epub.js's RAF task queue is stopped (`renditionInstance.q?.stop?.()`, `:1521`);
current location CFI is saved before teardown (`:1507-1511`); every window
listener and the `ResizeObserver` are cleaned (`:252-254,286-288,2001-2003,748-753,271`);
a `Section.prototype.destroy` monkey-patch (`:824-838`) keeps hooks valid during
teardown races.

**Object URLs** — all `createObjectURL`/`revokeObjectURL` sites are paired:
`localMediaSource.ts:173,260` (revoked by `DocumentViewer.tsx:847-849,2020-2022`),
`ImageViewer.tsx:83` (revoked `:94-97`), `AudiobookViewer.tsx:1348,1403`
(revoked `:1334,1350,1390,1406,1608`). `PDFViewer`/`EPUBViewer`/`PdfPageView`
create no blob URLs (PDF uses `convertFileSrc`/IPC data, EPUB the loopback URL).

**Stores** — no store holds document bytes. There is no `pdfStore`/`readerStore`/
`imageRegistryStore`. `documentStore`, `extractStore`, `queueStore`,
`useTranscriptionStore`, `documentOutlineStore`, `annotationsStore`, `tagsStore`
hold metadata or text; `tabsStore` tab `data` is metadata (`documentId` etc.).
The document-sized value in the frontend is `DocumentViewer`'s `fileData` state
(§1.2 copy 4), held for the tab's lifetime.

**What this means:** closing a PDF tab unmounts the React tree (so all these
refs and listeners go away with it) **except** the pdf.js document itself: the
`PDFDocumentProxy` and its loading task are owned by the shared pdf.js worker,
which keeps the parsed document — page data, fonts, decoded caches — alive until
it receives a `destroy()` message. The tab's close releases the JS-side handles
but not the worker-side document. This is the mechanism that lets memory
"survive" a tab close for PDFs, and it matches the Phase-4 snapshot plan
(snapshot C after close) in the change.

### 1.5 Native (Rust) retention inventory

All process-global state in `src-tauri`, with reachability during a **plain
reading session** (opening PDFs/EPUBs, reading them, closing tabs):

| Symbol | file:line | Type | Growth | Reachable during reading? |
|---|---|---|---|---|
| `EMBEDDING_STORE` | `commands/semantic_search.rs:158-160` | `Arc<RwLock<EmbeddingStore>>`; `HashMap<String, TranscriptChunk>` + `HashMap<String, Vec<f32>>` (`:82-86`) | **Unbounded** — no eviction; cleared only by `clear_all_embeddings` (`:370-375`); not persisted | **No** — populated only by `index_transcript` (`:263-287`), which needs a configured embedding provider + network |
| `EMBEDDING_CACHE` | `vector_store.rs:31` | `RwLock<Option<LruCache<String, Vec<f32>>>>` (cap 1000) | Bounded LRU | **No** — the `vector_store` module is not compiled (`lib.rs:4-52` has no `mod vector_store`); dead code |
| `OCR_PROCESSOR` | `commands/ocr.rs:16` | `OnceLock<TokioMutex<Option<OCRProcessor>>>>` (config only) | Bounded | No — lazy, only on `init_ocr` |
| `GLM_RUNTIME` | `ocr/runtime.rs:58` | `OnceLock<TokioMutex<GLMRuntimeState>>` (holds `ollama serve` child) | Bounded (1 child) | No — only if the user starts the GLM OCR runtime |
| `NOUGAT_INSTALL_LOCK` | `ocr/nougat_runtime.rs:50` | `OnceLock<TokioMutex<()>>` | Bounded | No |
| `MEDIA_SERVER_PORT` / `MEDIA_SERVER_STATE` | `media_server.rs:42,63` | `OnceCell<u16>`; `MediaServerState { allowed_roots, granted_paths }` (`:44-57`) | `granted_paths` grows per distinct file opened (path strings, **no bytes**) | **Yes** — started lazily the first time an EPUB/audiobook/video stream URL is requested (`media_server.rs:470`, `epub_server.rs:294`); streams from disk |
| `WEB_PROXY_PORT` / `BRIDGE_SCRIPT` | `web_proxy.rs:39,43` | `OnceCell<u16>` / `RwLock<Option<String>>` | Bounded | No — only when web content is proxied |
| `SERVER_HANDLE` / `ACTIVE_THEME` | `browser_sync_server.rs:414,416` | `Mutex<Option<JoinHandle>>` / `Lazy<Mutex<(String, Option<Value>)>>` | Bounded | No — browser-extension server, started at startup only if `auto_start` |
| `SCHEDULER` | `commands/scheduler.rs:14` | `Mutex<Option<BackupScheduler>>` | Bounded | No — `scheduler_init` only |
| `CLOUD_SYNC_MANAGER` | `commands/cloud/sync.rs:13` | `Mutex<Option<CloudSyncManager>>`; `last_synced_documents: HashMap<String,String>` (`:41`) | **Unbounded** by synced-doc count | No — `cloud_sync_init` only |
| `MCP_MANAGER` | `commands/mcp.rs:80` | `Arc<MCPClientManager>`; `HashMap<String, MCPClient>` | Unbounded by configured servers | No — `mcp_add_server` only |
| `JobQueue` / `AutoTranscriptionQueue` | `transcription/job_queue.rs:22`, `auto_queue.rs:21` | `mpsc::UnboundedSender` | Unbounded channel, drained FIFO | No — transcription only |

Per-document byte caches: **none in the compiled app.** There is no
`DashMap`/`moka`/`HashMap<DocumentId, …>` holding document content. The
transcription sidecars (whisper.cpp / sherpa-onnx) are per-job child processes,
not in-process runtimes (`transcription/engine.rs:326-341,641-706`). The only
unbounded collections are `EMBEDDING_STORE`, `CLOUD_SYNC_MANAGER.last_synced_documents`,
and the MCP client map — none reachable in a plain reading session. Managed
Tauri state (`AppState`, `AIState`, etc., `lib.rs:859-987`) holds config/DB
handles, not document bytes.

**What this means:** the native side contributes no obvious per-document
retention during a plain reading session; the media/epub loopback listener is
started but streams from disk. The ~1.08 GiB native PSS observed with four tabs
must therefore be explained by allocation behavior (engine libraries, allocator
high-water, GTK/WebKit state) rather than by an unbounded app map — Phase 4
(Heaptrack) is the evidence step for that.

### 1.6 Architecture-claim validation

The claims in `proposal.md` and `design.md` were checked against the code above:

- ✅ "Single Tauri window with a single WebView; tabs are React subtrees ...
  CSS-hidden inactive tabs" — confirmed, `TabContent.tsx:228`.
- ✅ "resident-tab cap ... defaults to **8** (`tabsStore.ts:328`) so at four
  tabs it never fires" — confirmed. **Correction/enhancement:** the cap's
  evictable set (`tabsStore.ts:311-315`) excludes `document-viewer` entirely,
  so the cap could never evict a reader even past 8 tabs; the doc's claim
  "no mechanism unmounts a reader short of closing the tab" is the accurate
  statement.
- ✅ "PDFViewer ... never calls `pdfDoc.destroy()` or `loadingTask.destroy()`;
  unmount cleanup only flips a `mounted` flag and aborts native range
  transports (`PDFViewer.tsx:1394-1399`)" — confirmed at `:1395-1399`.
- ✅ "desktop reads the entire PDF through `readDocumentFile` (Rust
  `tokio::fs::read`, 256 MiB cap) and copies it twice on the JS side
  (`new Uint8Array(buffer)` in `src/api/documents.ts:366`, then
  `new Uint8Array(rawBytes)`), before `clonePdfData()` makes a third and pdf.js
  transfers it to its worker" — confirmed. Exact count and steady-state
  ownership in §1.2 (peak ~6 copies, steady 2 persistent).
- ✅ "EPUB already streams via the loopback `epub_server`; desktop PDF does
  not" — confirmed.
- ✅ "`shouldUseNativeMobilePdfSource()` gates it to native mobile only"
  (`pdfFeatureFlags.ts:24-31`, call site `DocumentViewer.tsx:2049-2058`) —
  confirmed.
- ✅ "`EMBEDDING_STORE` ... process-global `HashMap` ... with no eviction"
  (`semantic_search.rs:158-160,82-86`) — confirmed; additionally found it is
  **lazy** and requires explicit semantic indexing, so it is not resident
  during a plain reading session (design open question answered: bounding it is
  out of scope for a reading-session memory fix).
- ✅ Design Context constraint "the existing gate cannot host this" — the
  memory number requires a real GUI process tree (confirmed by the whole-file
  IPC and loopback streaming architecture above).

No corrections to the planning documents were required; the one refinement
(`document-viewer` is not in `EVICTABLE_TAB_TYPES`) is recorded here for the
Phase 6 reader-cap design, which layers onto the same machinery.

---

## Phase 2 — The harness (built)

The measurement harness was built and unit-tested (tasks 2.1–2.6 collector,
3.1–3.9 driver + scenario). What exists today:

- **Collector** (`scripts/memory-bench/`): a strict `smaps_rollup` parser
  (unknown/absent fields are `null`, never `0`; malformed input yields an
  attributed error), process discovery rooted at the launched PID (process
  group **and** ancestor chain, verified by the `INCREMENTUM_MEMORY_RUN_ID`
  marker in `/proc/<pid>/environ`), a sample aggregator whose tree total sums
  the proportional fields only (never `Rss`), and a platform gate (non-Linux
  or missing `smaps_rollup` → unsupported, no result file).
- **Driver** (`scripts/memory-bench/driver.js`): launches the app in its own
  process group with `INCREMENTUM_MEMORY_SCENARIO`/`_CONTROL`/`_RUN_ID`/
  `_CORPUS_DIR`, serves the step protocol on a loopback control server
  (`/manifest`, long-poll `/step`, `/report`), drives the fixed scenario
  (fresh idle → one doc → two tabs → four tabs → all closed → N single-doc
  cycles → N multi-doc cycles → final idle), settles (app quiescence + three
  stable tree-Pss reads), samples per phase, and writes a machine-readable
  result with the environment block and `reliable` flag.
- **App side** (`src/lib/memoryScenario/` + `commands/memory_scenario.rs`): a
  runtime-gated host (inert unless the harness env vars are present — task
  3.3's production config leaves the surface inert, verified by test), which
  long-polls the driver and executes steps through the same store actions the
  UI uses (`openDocumentAtLocation`, `closeTab`, `closeAllTabs`,
  `importGenericFile`). The quiescence signal combines a runtime-gated busy
  counter (bumped by `DocumentViewer.loadDocumentData` and
  `PDFViewer.saveReadingPosition`, no-ops in production) with the document
  store's loading/importing flags and a new `tabsStore.hasPendingTabsSave()`.
- **Corpus** (`scripts/memory-bench/corpus.json`): two deterministic
  pdf.js-validated fixture PDFs (generated byte-identically, content-hash
  pinned) and the two untracked demo EPUBs (hash pinned, source path
  recorded). Provisioning verifies every hash and refuses to run on mismatch.
- **Failure semantics** (unit-tested): a failed document open or an app that
  exits mid-scenario → non-zero exit, no result file; a settle timeout →
  sample still taken but `reliable: false`.

Run it with `npm run bench:memory` (or `--provision` for corpus only).

The Phase 2 section of this document will record the actual measurement run
against the unmodified build (task 3.10), the Phases 2–4 profiling findings
(Heaptrack, WebKit heap snapshots), and the fixed post-fix numbers.

---

## Phase 5 — Reader disposal (implemented)

Findings from §1.4 turned into fixes (tasks 5.1–5.4):

- **5.1 pdf.js destroy on unmount/document change.** `PDFViewer` now owns its
  pdf.js loading task and document through a small holder
  (`src/lib/pdf/pdfDocumentHolder.ts`): the task is tracked the moment
  `getDocument` returns (before any await, so an in-flight load is destroyed
  too), the resolved document is tracked on `setPdf`, and the effect cleanup
  calls `reset()` — which runs on **both** unmount and document change and
  destroys the current task/document via `loadingTask.destroy()` (the pdf.js
  API destroys both). Previously the `PDFDocumentProxy` and its loading task
  were never destroyed, which is why worker-side memory survived tab close
  (§1.4). Unit tests cover destroy-while-loading, resolved-document destroy,
  idempotence, and reuse-after-reset.
- **5.2 per-page release on unmount.** The unmount cleanup now also clears
  `textCacheRef`, `renderedPagesRef`, `pageOffsetsRef`, cancels the reflow
  scheduler and the OCR controller, and drops the canvas/text-layer/page-viewport
  ref arrays. (Page-view canvas destruction was already handled per page in
  `PdfPageView`.)
- **5.3 EPUB teardown audit.** Code-level audit against the §1.4 inventory
  confirms the EPUB teardown is already complete: position flushed before
  destroy (`EPUBViewer.tsx:1507-1511`), epub.js queue stopped
  (`:1521`), `Rendition.destroy()` (`:1522`), `Book.destroy()` immediately or
  deferred until `ready`/locations settle (`:1525-1535`), with the deferred
  destroy flushed by promise continuations that run even after unmount
  (`:812,1341,1345`); all window listeners paired (`:250-254,283-288`); the
  iframe (`contents.document`) listeners die with the rendition's destroyed
  iframe. The two epub.js monkey-patches (`Section.prototype.destroy`,
  `Queue.prototype.dequeue`) are idempotent class-level guards that capture no
  book state, so they neither retain a book nor double-patch. **No code change
  required.**
- **5.4 object-URL invariant test.** The Phase-1 inventory showed every
  `createObjectURL` is paired. New tests lock the contract:
  `localMediaSource` blob URLs handed to a reader carry
  `revokeSrcOnDispose: true` (so the reader's unmount path revokes them —
  `DocumentViewer.tsx:847-849`) and a blob URL whose probe fails is revoked by
  the resolver itself (no dangling URL). A robustness guard was added to the
  media probe (`media.play?.()?.catch`) so non-browser runtimes cannot throw
  synchronously.
- **5.5 observers / timers / listeners / in-flight requests on unmount.**
  Re-audited every reader-owned resource against the §1.4 inventory: all
  per-instance `window`/`document` listeners and both `ResizeObserver`s are
  removed/disconnected, the position-save and navigation-settle timers are
  cleared (position flushed), the reflow scheduler and OCR controller are
  cancelled, and native range transports are aborted on unmount. The one
  remaining inventory item — `vimRuntimeListenersRef`, a `Set` of
  reader-owned listeners — is now explicitly cleared in the unmount cleanup
  (`PDFViewer.tsx`) so it cannot outlive the reader even if the vim adapter's
  `onVimRuntimeChange(null)` unsubscribe chain has not run yet.
- **5.7 mid-load close cancellation test.** `readerTabMidLoadClose.test.tsx`
  exercises the real `createPdfDocumentHolder` against a controllable
  in-flight loading task: closing a tab mid-load destroys the loading task,
  issues no further backend requests, and surfaces no user-visible error —
  including when the load's rejection lands after unmount (the `mounted`
  guard swallows it).

Phase 4's heap-snapshot evidence (snapshot C retaining paths) is still to be
recorded; 5.1-5.7 stand on the Phase-1 code inventory until then.

---

## Phase 6 — Desktop PDFs move onto the native range transport (implemented)

Design D10, tasks 6.1–6.7:

- **6.1 generalized predicate.** `shouldUseNativeMobilePdfSource` became
  `shouldUseNativePdfRangeSource({ isTauriRuntime, fileType })` behind the
  renamed `nativePdfRangeSource` feature flag
  (`src/components/viewer/pdfFeatureFlags.ts`), default on in the Tauri
  runtime. The pre-rename localStorage key is honored as a migration fallback
  (a user who disabled the mobile-only flag keeps it disabled), tested.
- **6.2 desktop routing.** `DocumentViewer.loadDocumentData` now routes every
  Tauri-runtime PDF through the range source (`setUseNativePdfRange(true)`),
  returning before any whole-file read; the `readDocumentFile` path remains as
  the explicit fallback when the flag is off or the platform has no native
  commands (web/PWA). Mobile's legacy `convertFileSrc` URL path remains only
  for the flag-off case.
- **6.3 fallback observability.** `PdfDiagnostics` gained `fallbackReason`
  (`range-source-disabled` | `range-source-unavailable`) and `recordFallback()`;
  `PDFViewer` records it whenever a whole-file load happens in the Tauri
  runtime, so a silent regression to whole-file loading is visible in
  diagnostics and the benchmark.
- **6.4 authorization preserved.** The Rust commands were already scoped
  correctly (document-id-resolved path + per-request identity check). The
  range logic is factored into `*_impl` functions so it is unit-testable
  without a Tauri runtime; new tests cover: an unknown document id is refused,
  a non-PDF document is refused, and a source whose identity changed fails
  with `pdf_source_changed` — no bytes from the changed file are delivered —
  while a re-resolved identity reads successfully.
- **6.5/6.6 behavior tests.** The app-controlled layer is tested in
  `pdfRangeSourceBehavior.test.ts` (identity failure surfaces; a page-turning
  session on a 40 MiB document transfers < 1% of the file, only requested
  ranges, each ≤ the chunk cap; transfer stats land in diagnostics). The real
  pdf.js engine is exercised through a range transport in the node test
  `memoryBenchPdfFixture.test.mjs`: pages, outline extraction, viewport, and
  text extraction all work through the range path, with every engine read
  bounded and in-file. (The engine cannot run under jsdom — no DOMMatrix /
  Promise.try, and the shared vitest setup stubs pdfjs-dist; a DOMMatrix stub
  was added to `src/test/setup.ts` for the same reason.) Password handling
  uses the same `getDocument` promise path in both sources (wired in
  `PDFViewer.loadPDF`); an encrypted document fixture is a follow-up.
- **6.7 `clonePdfData` stays whole-file-only.** The range branch returns
  before `createPdfLoadSourceFactories` and `DocumentViewer` never sets
  `fileData` when routing to the range source, so the defensive copy is
  unreachable on the range path (documented at `pdfLoadSources.ts:13`).

Task 6.8 (harness delta for range loading) awaits a machine that can run the
GUI scenario.

---

## Phase 7 — Native-side lifecycle (implemented)

Task 1.5's inventory is the evidence base: during a plain reading session the
native side holds **no per-document byte caches** — the media/epub loopback
servers stream from disk (`ReaderStream`), and the unbounded collections
(`EMBEDDING_STORE`, `CLOUD_SYNC_MANAGER.last_synced_documents`, MCP clients)
are unreachable without explicitly invoking those features.

- **7.1 no per-document state to release.** Because the evidence implicates no
  per-document cached buffers/handles/channels in the compiled app, there is
  nothing to drop on "last tab closed" — stream file handles live inside the
  HTTP response and are dropped when the stream ends. This is recorded rather
  than inventing state to release. (The design's "confirmed in 4.2" column
  awaits the Heaptrack run.)
- **7.2 the one implicated cross-document structure is now bounded.** The
  media server's `granted_paths` set (path strings, grows per distinct
  out-of-root file opened in a session) now has an explicit bound —
  `MAX_GRANTED_PATHS = 256` (`src-tauri/src/media_server.rs`), enforced by a
  `grant_path` helper. Eviction cannot break a currently open document: the
  set is consulted only when a NEW stream request arrives, while an open
  stream owns its file handle. Unit-tested: the set never exceeds the bound,
  non-granted paths stay FORBIDDEN, granted/root paths stay accepted, and an
  evicted path is re-grantable (eviction is not a ban).
- **7.3 allocator remedy — not applied.** The task is conditional on Heaptrack
  showing freed-but-retained pages; that evidence is not available in this
  environment (see Phase 4), so no allocator tuning was added. Defense-in-depth
  only after ownership fixes, per design D13.
- **7.4 release test.** `per_document_stream_state_is_released_when_the_document_is_not_open`
  asserts the backend's structural property: after serving a complete stream,
  the server state holds no per-document entry (no bytes, no handles), only
  the bounded grant set.
- **7.5** (harness delta) awaits a machine that can run the GUI scenario.

The proposal's open question ("whether `EMBEDDING_STORE` and the OCR runtimes
are resident during a plain reading session") is answered by the Phase-1
inventory: they are not — `EMBEDDING_STORE` requires explicit semantic
indexing, and the OCR runtimes are lazy. Bounding them is out of scope here.

---

## Phase 8 — Bounded reader residency (implemented)

Design D11, tasks 8.1–8.6:

- **8.1 reader classification + setting.** `tabsStore` gained a reader
  classification (`READER_TAB_TYPES = { document-viewer }`, `isTabTypeReader`)
  and the `general.readerTabCap` setting (default **2** — active reader plus
  one warm, `DEFAULT_READER_TAB_CAP` pinned to the shipped default by a test),
  with its settings UI entry and locale strings in all six locales.
- **8.2 the cap.** `applyResidentCap` now runs two passes on activation: the
  general cap (unchanged, evicts only `EVICTABLE_TAB_TYPES`) and the reader
  cap (evicts the least-recently-used reader beyond it). Reader types are
  never evicted by the general cap and non-reader tabs are never evicted on
  account of the reader cap; active tabs are exempt from both.
- **8.3 position flush on unmount — already present, now load-bearing.** The
  Phase-1 inventory showed `PDFViewer`'s unmount cleanup flushes the current
  position through the persistence path (`positionSaveTimeoutRef` cleared +
  `saveReadingPosition(lastPositionRef.current)`) and `EPUBViewer` saves the
  current CFI before teardown. Eviction unmounts the tab through the same
  `TabContent` path as close, so a reader evicted mid-save-interval flushes
  its position.
- **8.4 restore on reactivation — already present.** Reactivation remounts the
  reader with `data.documentId`; `DocumentViewer` restores the PDF page from
  the document's saved position and the EPUB CFI (`currentDocument.currentCfi`)
  through the existing restore-position machinery.
- **8.5/8.6 tests.** `tabResidentCap.test.ts` now covers: opening past the cap
  evicts the least-recently-used reader; alternating between two readers
  within the cap unmounts neither; activating a non-reader tab evicts no
  reader (even with a tight general cap); an evicted tab stays listed in the
  workspace; a lowered cap applies on the next activation; cap `0` keeps every
  reader mounted; reactivation un-evicts and re-evicts LRU; closing a reader
  clears it from the evicted set. The eviction lifecycle is the same unmount
  path as close, which is what carries 8.3's flush and 8.4's restore.

Tasks 8.7 (tab-switch latency) and 8.8 (harness four-tab delta) await a
machine that can run the GUI scenario; the latency trade-off will be recorded
there.

---

## How to run the memory benchmark

Prerequisites (Linux with a display or Xvfb, WebKitGTK 4.1, Rust toolchain):

```bash
npm install
npm run tauri:build:local:debug          # builds src-tauri/target/debug/incrementum-tauri
node scripts/memory-bench/driver.js --provision   # populates .bench/corpus/ (deterministic PDFs + EPUBs, hash-verified)
npm run bench:memory                     # runs the scenario and writes .bench/memory-result.json
npm run bench:memory:check               # runs the scenario AND evaluates the gate
node scripts/check-memory-budget.mjs .bench/memory-result.json --warn-only  # evaluate without re-running
```

The scenario is deterministic: fresh idle → one document → two tabs → four
tabs → all closed → N single-document open/close cycles → N multi-document
open/close cycles → final idle (`--cycles <n>`; default recorded in
`scripts/memory-bench/scenario.js`). The driver launches the app in its own
process group with a run-id marker; only processes carrying the marker are
counted, so an unrelated browser's WebKit processes can never contaminate the
numbers.

## How memory is measured, and why PSS

Each sample reads `/proc/<pid>/smaps_rollup` for every discovered process and
keeps `Pss`, `Pss_Anon`, `Pss_File`, `Pss_Shmem`, `Private_Dirty`, `Rss`, and
`Swap`. The headline number is the process-tree **PSS sum**.

Why PSS: the native process and the web process share a large amount of mapped
library text. RSS counts those shared pages once per process, so summing RSS
double-counts them and overstates the tree's true footprint. PSS attributes
each shared page proportionally (divided by the number of sharers), so the sum
is the honest "how much of physical memory does this instance own" number.
`Rss` is kept per-process but never summed into the tree total; unknown or
absent fields are reported absent, never zero — a zero would read as an
improvement.

Sampling happens only after a settle condition: the app reports quiescence (no
in-flight load/render/persistence) AND three consecutive tree-Pss reads agree
within a configured fraction. A settle timeout still produces a sample, but
marks the run `reliable: false`, and the gate refuses to compare unreliable
runs.

## Baselines and thresholds

`scripts/memory-baselines.json` records, per metric: the baseline value, its
gated/diagnostic classification, the relative allowance and absolute
floor/ceiling the threshold is clamped between, the observed variance the
allowance came from, and the sample count — plus the machine profile
(OS + kernel, WebKitGTK version, CPU model, total RAM, app version + build
profile, corpus hashes) and the ratchet parameters.

The threshold policy (design D6):

```
allowedGrowth = clamp(baseline × relativeAllowance, absoluteFloorBytes, absoluteCeilingBytes)
fail when measured > baseline + allowedGrowth
```

The floor stops small metrics failing on percentage jitter; the ceiling stops
large metrics absorbing a big regression behind a small percentage. The
ratchet criterion (D7) checks the repeated open/close cycles post warm-up:
final-vs-reference growth and an ordinary-least-squares slope, each reported
in bytes and bytes/cycle.

The baseline values themselves are recorded from the corrected, fixed
implementation in Phase 10 (this document's "Baseline values" section) and
cannot be recorded in an environment without a display — see the re-record
procedure below for exactly how.

## Re-recording memory baselines (deliberate, documented procedure)

Re-recording is an explicit operation that never happens as a side effect of
running the benchmark or the gate (`scripts/check-memory-budget.mjs` only
reads `scripts/memory-baselines.json`; a test pins this).

1. **Prepare the machine.** Use the machine you intend the baseline to be
   valid on; record its profile fields (below) in the PR. A baseline is only
   comparable on a machine whose profile matches on every recorded field.
2. **Collect samples.** Run the full scenario at the intended cycle count
   (default 8) at least **5 times** on unchanged code:
   ```bash
   for i in 1 2 3 4 5; do
     npm run bench:memory
     cp .bench/memory-result.json .bench/memory-result.$i.json
   done
   ```
   The minimum sample count is 5; the actual count is recorded in the
   baseline file under each metric's `samples` field.
3. **Derive tolerances from variance.** For each metric, compute the observed
   variance across samples (the spread of the measured values). Set
   `relativeAllowance` high enough that the observed spread passes (start at
   ~3× the observed coefficient of variation), then clamp it with an
   `absoluteFloorBytes` (so a small metric's jitter never fails) and an
   `absoluteCeilingBytes` (so a large metric cannot absorb a big regression).
   The rule from the spec: **a doubling of any gated metric must fail, and
   repeated unchanged runs on the profile must pass** — sanity-check both with
   `node scripts/__tests__/memoryBudget.test.mjs` and a synthetic doubled
   result (see the test fixtures).
4. **Record the machine profile.** Update every field of `machineProfile`
   from the result's `environment` block of the samples you recorded: OS +
   kernel, WebKitGTK version (the app or `pkg-config --modversion
   webkit2gtk-4.1`), CPU model, total RAM, app version + build profile, and
   the corpus hash set.
5. **Update the ratchet parameters.** Set `warmUpCycles`, the reference
   window, `finalVsReferenceAllowanceBytes`, and `slopePerCycleAllowanceBytes`
   from the observed post-warm-up steady state of the cycle stages.
6. **Justify in the PR.** A baseline change is a reviewable diff in
   `scripts/memory-baselines.json`; the PR description must say why the
   memory behavior changed (the same protocol as `scripts/perf-baselines.json`
   and `scripts/bundle-budgets.json`).
