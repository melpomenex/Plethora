# Validation and acceptance evidence

## Proposal-time evidence

Baseline: `615570ff0301b97db7a27beec3d63db3fd04de89`, audited2026-10-20. This document separates tests actually run from the **future implementation** suite below.

- Executed the seven-suite Vitest command in implementation-guide.md: **7 files, 117 tests;116 passed,1 failed** (3.69s reported by Vitest). The failing existing test is `src/utils/__tests__/cardSourceNavigation.test.ts:335`, “refuses to highlight when the quote matches multiple places”: expected coarse reason `ambiguous`, received `no-anchor`. Tauri listener warnings occurred in jsdom; no device behavior was exercised.
- Strict OpenSpec validation was run after initial deltas and again after final self-review; final result is recorded at the end of this file.
- No release build, benchmark, whole-repository lint/TypeScript/Rust compile, cloud call or physical-device test was run to validate this documentation-only change. Their implementation commands are prescribed, not claimed passes.
- Existing untracked AI completion proposals/planning documents predated this task and are preserved. Scope check must confirm only this change directory (plus repository-scoped Lemmalog snapshot) was written by this task.

## Deterministic fixture specification

Task0.1 creates a small generated/licensed spoken sample and fixed expected transcript (not expected exact native ASR output), plus fake recording/STT/LLM/clock/IO adapters. Long tests synthesize a90-minute **event timeline** from the small sample with bounded streamed bytes, not a90-minute allocation or committed huge binary. Fixture catalog:

| ID | Source/data | Required distinguishing properties |
|---|---|---|
| F-lecture | Fixed source text + fixture speech | 3 topics, definition/comparison/process, a technical equation,2 repeated phrases in different segments, optional2 speakers and measured words. |
| F-long |90-minute fake clock/stream | Fixed5-second native parts or1-second browser fragments; acknowledged prefix, IO stalls, navigation and kill injection; output bytes streamed to temp files. |
| F-import | Actual small generated/licensed MP3 and MP4 fixtures | Same lecture identity for MP3 parity; two-person meeting transcript for MP4; supported and unsupported codec probe results. |
| F-cues | SRT/VTT/TXT | BOM/CRLF, multiline/cue settings, overlapping cues, missing timing, invalid negative/reversed times, Unicode/emoji/math. |
| F-provider | Deterministic fake provider outputs | Valid structured proposals, malicious source instructions, invented quote/key/speaker, no alignment, malformed JSON, timeout, cancellation and late response. |
| F-history | Seeded SQLite/user data | Existing extracts, reviewed cards with nonzero reps/stability/difficulty/due/review log, prior Studio workspace, audio editions/listening sessions and transcripts with words. |
| F-crash | Writer/DB fault script | Crash at file-write/rename/manifest/DB/checkpoint/promotion boundaries, corrupt/missing tail, low storage, lost accepted reply, expired worker lease. |

Unit/integration tests use fixed IDs/timestamps/hashes/fake outputs; no network, microphone, random ASR string equality or sleep-dependent races. Verify UTF-16 ranges against actual canonical strings. Native recognition quality is evaluated separately on devices; deterministic tests assert mapper/commit behavior with fake output.

## All mandatory journeys

Each row is an implementation release criterion. “Device” is a plan, **not completed evidence**. Assert DB/files through actual APIs/repositories rather than only checking a rendered toast. Rows cite implementation tasks and formal capability deltas.

| ID | Setup and action | Deterministic pass condition | Device/manual gate | Tasks / capability |
|---|---|---|---|---|
| A01 | F-long lecture: record90min→Finish→STT→selected enrichment | Verified media reopens after restart; transcript metadata preserved; source-linked extract/card drafts exist; before accept, learning_items count delta0; after accepting1, delta1; bounded writer and request counters |90-minute capture on each platform with Record enabled; playback start/middle/end; leave screen and return |0.5–0.13,3.8; durable-recording-capture/session-learning-analysis |
| A02 | Import equivalent F-import MP3 | Same normalized downstream actions/results/evidence eligibility as A01, differences limited to origin/actual timing; no manual handoff; identity stable on retry | Import actual MP3 via desktop/mobile picker |1.3,3.8; recording-sessions |
| A03 | Import MP4 Meeting with suggestions enabled/cards default off | Audio track probed, transcript saved, decisions/actions cite evidence; proposed cards0 and learning items0 until explicit card enablement | MP4 with actual supported codec and an unsupported/no-audio variant |1.3,3.7; session-learning-analysis |
| A04 | Import F-cues SRT without media; generate/Ask | Cue text/times preserved, extracts/cards possible, citation opens cue; player/playback links absent and no asset fabricated | Pick SRT on Android/iOS/desktop and use mobile reading/approval |1.4,4.4; recording-sessions/transcript-search-integration |
| A05 | Kill F-long capture after committed part; restart twice | All committed file hashes retained/adopted once; incomplete tail identified; recovery offers review/export/explicit continue/discard; no automatic mic start; gaps not hidden | Force-stop desktop process/Android app/iOS terminate; verify retained playable prefix |0.5–0.9; durable-recording-capture |
| A06 | Fail STT after2 committed units | Original asset hash unchanged and playable; partial transcript remains; Retry uses same session and unfinished units only | Drop network/deny model/kill native worker then retry |0.11–0.13,2.7; transcription-jobs |
| A07 | Mark Confusing at a fixed sample count during capture | One marker stores exact media time, survives restart, opens source moment after STT; without text remains a valid audio bookmark | One tap while recording, then find in Overview/mobile |2.3; audio-learning-actions/session-learning-studio |
| A08 | Accept a sourced card then review→Open in Source | Existing review card opens correct document/session/segment; seek equals cited measured/imported ms÷1000 within50ms adapter tolerance; Back returns to review item | Listen around source position on real player; tolerate hardware seek granularity with recorded error |2.6,3.2,4.2; audio-learning-actions |
| A09 | Generate then reject a draft; restart and query due/review | Draft status rejected; no acceptedTargetId; learning_items/FSRS/review-history delta0; cannot leak through Accept all | Reject via mobile/desktop UI and inspect ordinary review list |3.1,3.2,4.2; ai-learning-material-generation |
| A10 | Retry STT/analysis plus crash after commit before reply | Segment-key multiset unchanged; unit request count excludes committed units; draft/card identities stable; double acceptance returns same target | Interrupt actual job/app and retry; UI reflects partial state |0.12,3.5; transcription-jobs |
| A11 | F-history overlapping lecture proposes existing concept card | Compare warning; Use existing appends1 source and no new card; original content, due/reps/stability/difficulty and review-log hashes unchanged | Compare and use existing in Studio |3.6; ai-learning-material-generation |
| A12 | Offline/local-only + cloud configured + remote fallback attempt | Instrument all transport/remote speech calls:0; no-presenter without authorization also0; job blocked/local eligible only; saved source works | Airplane mode after setup; on-device eligible pipeline completes, remote remains blocked |0.10,3.5; transcription-jobs |
| A13 | Feed equivalent Android/desktop normalized capture/STT outputs | Same serialized session/segment/draft/evidence DTOs modulo IDs/actual timings; no platform-only learning fields or alternate scheduler | Real recording+source navigation on Android and desktop |0.7,0.12; android-speech-intelligence/media-ingestion-transcription |
| A14 | Pick file once and wait while navigating elsewhere | One session owns stage changes through transcript/drafts; user returns through library without needing another viewer to start each stage | File picker→library→session path on each platform |1.1–1.7,2.7; recording-sessions/session-learning-studio |
| A15 | Record/import with no AI provider; import existing transcript | Audio playable/exportable, markers work, setup is actionable; existing text supports manual extract/card/correction; no blank/global failure state | Remove credentials/models, save and restart |0.13,2.7; session-learning-studio |
| A16 | Correct technical term/equation/emoji after acceptance | Canonical revision/hash changes; new search matches; accepted quote/card/history unchanged; current exact range reverified or stale/coarse outcome shown, never incorrect highlight | Edit actual text on mobile/desktop; follow old/new sources |2.5,2.6,4.4; media-ingestion-transcription |
| A17 | Batch3 files into one course, one exact duplicate and one overlapping concept | Successes independent; collection consistent; exact source reuse skips unnecessary STT; concept comparison avoids silent duplicate card and preserves multiple sources | Multi-select/folder/share where supported |1.6,3.6; recording-sessions |
| A18 | Import audio with untimed F-provider output, then remove media | Text source remains navigable via paragraph/section/document; no precise time or fabricated player; missing-media label clear; accepted card still readable | Test provider without timing/unsupported codec, then media-only deletion |2.6,4.6; media-ingestion-transcription/audio-learning-actions |

## Additional failure and contract checks

- Writer acknowledgement is tested at every crash boundary; rename without DB commit is adopted, DB without valid file is not treated saved; partial/empty sessions never claim recorded content. Existing staging cleanup cannot remove recoverable parts.
- Two job consumers/windows, expired leases, canceled native inference and delayed responses cannot produce duplicate or post-cancel commits. Atomic segment+checkpoint failure replays the unit. Native result pages are released only after durable acknowledgement.
- Promotion injects failure before/after domain insert/source/AI provenance/status update. Per-item transaction rollback leaves zero partial target. Lost reply/double click returns existing target. Mixed batch keeps committed successes and retries failures only. Cloze markers/ranges render correctly.
- Fake provider emits adversarial “ignore instructions” transcript, invented segment IDs/timestamps/quotes and giant output. Containment, validation, caps and request counters fail closed; required evidence cannot be overridden with a checkbox.
- Corrected transcript invalidates affected outputs/index once; untouched units stay cached. Rejected/superseded drafts do not become canonical source chunks. Summaries remain labeled and unindexed until an explicit supported promotion.
- Feature-off drains capture; recovery/export remain reachable. Backup/restore rebinds managed paths; explicit deletion retries cleanly and does not automatically remove unrelated/shared assets or accepted items. Cloud sync never silently enrolls original media/drafts.

## Performance gate

Do not substitute a fake fast function for a measured production path. Add seeded unit planner/dedup/source-range benchmarks, run `npm run bench:check`, and keep existing bundle budget. No baseline changes for this documentation proposal. For implementation, intentionally changed baselines/budgets need reasons.

Measure warmed capture at10 and90minutes on the same device and codec. Assert application pending audio≤4MiB/two writes, native PCM ring≤2s and no duration-proportional PCM/media array. Memory instrumentation must distinguish JS/native recorder/model/UI caches; target process RSS growth≤64MiB between warmed checkpoints **excluding documented model loading**, investigate any upward slope even under that cap. Model/native runtime feasibility is a device gate, not a fixed cross-device ASR speed claim. Verify session STT decode windows never exceed the chosen unit cap; library/card queries page/bound counts. Record actual measurements, device/OS/build and chosen caps.

Studio loads lazily; compare startup bundle and cold startup before/after, no new inference/polling while idle. UI transcript holds only bounded pages and selected rows. Ten-hour synthetic planning is a functional boundary test, not a reason to allocate ten hours of PCM. Hidden waveform stops; analysis pauses under capture/thermal/suspend restrictions.

## Real-device release matrix — all pending at proposal time

| Environment | Required manual evidence before enabling capability |
|---|---|
| Linux desktop supported WebView | Permission allow/deny, supported MIME recovery/remux,90min capture, kill/restart, input device change, low-storage stop, MP3/MP4 codec playback and source seek. |
| Windows desktop | Same capture/recovery/import suite plus file-picker/drag/drop/Unicode paths and actual ffmpeg availability; do not infer parity from Linux. |
| macOS desktop | WKWebView recording/MIME/mic entitlements and recovery; palette routes shared session; no competing Apple text-only capture; if probe fails keep Record disabled with import option. |
| Android supported mid-range + recent device | API/build identities; foreground mic permission/notification/start restrictions, screen-off/background/phone call/Bluetooth disconnect/force-stop, native WAV recovery, SAF and SEND_MULTIPLE/private copy, offline installed local STT, thermal/time-limit continuation. |
| iOS supported device | Foreground record/pause/finish, interruption/permission denial/termination/recovery, scoped picker/share where configured, local recognition eligibility and offline failure behavior; default background safe-stop. Continuous background only in5.5 after separate certification. |
| Browser/PWA regression | Existing imports/review continue; unavailable durable capture explicitly described. Enabling browser recording requires separate persistent-storage/quota/eviction/restart tests; no parity claim from MediaRecorder presence. |

Each evidence row records commit, device/OS, capability probe, actual provider/model/endpoint class, fixture/version, durations, saved file hashes, result and failure notes **without transcript/audio content in logs**. A short simulator test cannot certify90-minute physical-device capture or offline native assets. Missing device/toolchain remains pending and keeps that platform capability gated.

## Existing-feature regression matrix

| Area | Required verification |
|---|---|
| Audiobook + podcast | Existing playback/chapter resume/private files, transcript providers, listening inbox/markers, no implicit session grouping changes; import and streaming native tests. |
| YouTube | Existing canonical transcript/source permissions/cloud-STT refusal, karaoke/Assistant timestamp links, no invented end times in new session path. |
| PDF/EPUB/HTML/Markdown reading | Selection/extract/source-return tests, saved context and review return; no global nullable-time type regression. |
| Flashcard generation/Studio | Existing local workspaces/chat/extract-picker, manual cloze and already-persisted behavior; session adapter never eager persists. |
| FSRS + history | Existing reviewStore/wave5 suites, seeded reviewed-row invariance, accepted-only due-list membership. |
| Ask/search | Canonical source indexing, explicit document/course filters, selection-context/citation validation, offline/local-only/exclusions and no draft/summary index pollution. |
| Android + Apple speech | Composer busy/late result/cancel tests, existing imported-file local paths, actual provider labels, no remote fallback on cancel or offline policy. |
| Cloud/local STT | Resolver/router/config/persist/reconciliation suites, queue executor filters, provider-specific caps/consent, measured word/speaker metadata. |
| Settings/performance | New target IDs/catalog/coverage tests, migrations preserve false, seeded benches/bundle and memory budget checks. |

## Final proposal validation

Final self-review checked capture/storage failure ordering, optional timing, active-STT correction races, unique source ownership, marker/approval idempotency, existing capability names, concurrent proposal boundaries, task dependencies and proposal/spec correspondence. All12 declared capability deltas exist; all47 implementation task IDs are unique and include file/contract, dependency/steps, acceptance/test and parallelism fields. There are36 formal requirements and64 formal scenarios. No placeholder TODO/TBD blocks or trailing whitespace were found in the new Markdown.

`openspec validate unified-recording-ingestion-and-learning-studio --strict` passes. `openspec status --change unified-recording-ingestion-and-learning-studio` reports **4/4 planning artifacts complete**. This refers to the blueprint only: every implementation checkbox remains unchecked, all18 future acceptance journeys/device checks remain unexecuted, and the existing baseline test failure remains disclosed. This task wrote the new change directory and durable Lemmalog memory only; concurrent unrelated source edits were left untouched.
