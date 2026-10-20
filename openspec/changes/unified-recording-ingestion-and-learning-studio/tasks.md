# Sequential implementation tasks

Implementation tracking: checkboxes record verified completed work; see implementation-log.md for executed checks and outstanding blockers. Read design.md D1–D12 before coding. Every task names an outcome, file boundary, dependency, implementation sequence and verification. Paths are repository-relative; `(new)` means proposed. P0/P1/P2 reflect priority, not permission to skip dependencies. Run tasks in listed order by default. “Parallel” identifies a safe boundary only after listed prerequisites; it never authorizes concurrent edits to shared files or competing migration numbers. Gates in validation.md define phase completion.

## 0. Phase 0 — Fix foundations (P0)

- [x] 0.1 Freeze the shared fixture and contract baseline; verify the existing seven-suite result before implementation.
  - **Outcome/files/contracts:** Create `src/test/fixtures/recording-sessions/` (new), `src/types/recordingSession.ts` (new) with D2/D5 DTOs and a fixture manifest; reference `LectureCaptureHost.tsx`, speech/types, `searchHit.ts`, `learningMaterial.ts` and this proposal's validation.md.
  - **Depends/steps:** None. Record current HEAD/dirty state; rerun the documented baseline; add a small licensed/generated spoken fixture, deterministic transcript/cue/evidence JSON, injected IO/clock/provider fakes and fixture generation instructions. Define case IDs A01–A18. Do not bless the existing failing source-navigation assertion as desired behavior.
  - **Acceptance/tests:** DTO typecheck and fixture IDs/expected source ranges are deterministic; baseline failure is attributed separately. **Parallel:** no; this fixes the interface for later tasks. This is the exact recommended first task.

- [x] 0.2 Add session/asset/part/marker ownership schema; verify seeded upgrades and legacy data preservation.
  - **Files/contracts:** `src-tauri/src/database/migrations.rs`, `models/recording_session.rs` (new); D4's first four tables and existing documents/collections.
  - **Depends/steps:** 0.1. Choose next migration identifier after checking current registry; add checks/FKs/indexes, serde DTOs and version fields. Add cleanup-journal ownership support. Keep ordinary document privacy/title/collection authoritative; do not create TTS editions or rewrite listening-session schema.
  - **Acceptance/tests:** Empty/seeded DB upgrade, foreign-key checks, duplicate document-session rejection, part idempotency and existing document/card/review row hashes pass. **Parallel:** no with 0.3; migration ownership is serial.

- [x] 0.3 Evolve canonical transcript segments without fake timing; verify preserved IDs/indexes and legacy timed reads.
  - **Files/contracts:** `migrations.rs`, `transcription/engine.rs`, `transcription/mod.rs`, `src/api/transcription.ts`, `stores/useTranscriptionStore.ts`; D4/D5 canonical segment contract.
  - **Depends/steps:** 0.2. Transactionally rebuild segment table with nullable timing and added stable key/ordinal/speaker/revision/metadata. Backfill legacy keys/ordinals. Update all session-facing queries; explicitly filter/map timed rows for legacy readers and preserve checkpoint index. Add a session-specific normalized DTO rather than globally making legacy player fields optional.
  - **Acceptance/tests:** Seed timed transcript + words, migrate twice through registry, check IDs/content/indexes unchanged; null-time session rows survive and never produce zero-second playback. **Parallel:** no; shared migration/API seam.

- [x] 0.3a Persist authoritative native document privacy before session creation (P0; approved amendment).
  - **Outcome/files/contracts:** Add durable document privacy columns and DTO round trips in `models/document.rs`, `database/repository.rs`, document commands/API/store, sync journal/outbox/merge and canonical indexer. Reuse ordinary document policy; see design-amendment.md.
  - **Depends/steps:** 0.3. Add additive migration; preserve existing explicit restrictions, including metadata/cache reconciliation. General document updates and stale sync cannot lower restrictions. Provide an explicit version-checked policy mutation for intentional changes. Exclude local-only source/derived payloads before journaling and dispatch; revoke pending uploads on restriction. Recheck current policy before inference/indexing. New sessions default local-only. Local backups retain policy.
  - **Acceptance/tests:** Create→restart→read and serialization; startup/summary mapping; stale absent/false flags cannot clear durable true; local-only outbox/derived exclusion and revocation; AI-excluded indexing rejected; local execution permitted for local-only sources. Session dispatch/consent checks are also mandatory in 0.10/0.11 and derived acceptance in 4.4/4.6. **Parallel:** no; shared document/sync boundary.

- [x] 0.4 Implement session repositories and thin command/API plumbing; verify command round trips and source authorization.
  - **Files/contracts:** `database/recording_session_repository.rs`, `commands/recording_sessions.rs`, `models/recording_session.rs`, `src/api/recordingSessions.ts` (new); existing repository module exports, `src-tauri/src/lib.rs`, capabilities and `invokeCommand`.
  - **Depends/steps:** 0.3, 0.3a. Implement create/get/list/page segments, expectedVersion CAS, relative path ownership and per-document privacy lookup; register commands. Reuse document creation internals without creating a second document on import. Return typed unavailable for nonnative session persistence until implemented.
  - **Acceptance/tests:** Real SQLite repository + mocked invoke tests cover paging, wrong-session IDs, stale version and off-platform behavior. **Parallel:** API implementation may run beside 0.5 after DTOs freeze; registration/exports owned here.

- [x] 0.5 Build durable part writer/recovery ledger; verify crash boundaries and byte retention.
  - **Files/contracts:** `src-tauri/src/recording/{mod,assets,recovery}.rs` (new), `commands/document.rs` unique staging helpers, media server, staging sweep; D2 manifest v1.
  - **Depends/steps:** 0.2, 0.4 DTOs. Implement bounded append, hash/sync/atomic rename/manifest replace, DB reconcile, acknowledged duration, finalization and cleanup exclusion. Scan only managed recording roots. Preserve originals on remux/probe failure and expose partial export.
  - **Acceptance/tests:** Inject failure before/after rename/manifest/DB commit; restart twice yields the same verified parts; corrupt/missing tail yields an honest gap; traversal/symlink paths fail. **Parallel:** yes with native adapter implementation after manifest freezes; core writer has one owner.

- [x] 0.6 Replace desktop capture buffering with a disk-backed adapter; verify MIME-specific playable prefix recovery.
  - **Files/contracts:** `src/services/recording/desktopCapture.ts` (new), `LectureCaptureHost.tsx`, `lectureCapture.ts`, `pcm.ts`; D2 CaptureHandle and writer acknowledgement.
  - **Depends/steps:** 0.5. Probe getUserMedia/MediaRecorder/MIME and remux capability; start timeslices, stream at most two bounded binary writes and remove full-session PCM/chunk arrays. Implement pause/finish/backpressure using controller state. Persist playback URIs only for managed assets. Gate unsupported MIME/capture combinations.
  - **Acceptance/tests:** Fake recorder advances90 minutes with bounded pending bytes, delayed IO safely stops, stop races drain once; desktop integration kills writer and decodes committed prefix. No production Blob URL durability claim. **Parallel:** yes with 0.7/0.8, separate files.

- [x] 0.7 Add Android rolling native recording within the existing speech plugin; verify writer parity and foreground lifecycle.
  - **Files/contracts:** `plethora-android-speech/.../AndroidSpeechPlugin.kt`, `RecordingCaptureService.kt`, `RecordingWriter.kt` (new), plugin Rust/permissions/manifest, generated app permission config; `src/services/recording/androidCapture.ts` (new).
  - **Depends/steps:** 0.5. Add status/start/pause/resume/finish with session token/epoch, AudioRecord bounded ring and5-second WAV parts/manifest. Declare microphone foreground service permissions/type, notification controls and eligible foreground start; handle disconnect/call/permission/error safe-stop. Keep Android STT decoding in its existing plugin.
  - **Acceptance/tests:** Kotlin writer/state tests compare manifest fixture; device start/background/notification-stop/kill/revoke cases are recorded as pending until actually run. No base64 full audio. **Parallel:** yes with 0.6/0.8; root command registration merges serially.

- [x] 0.8 Add Apple disk-first recording adapter; verify interruption and foreground safe-stop.
  - **Files/contracts:** Apple plugin `ios/Sources/RecordingBridge.swift` (new), `SpeechBridge.swift`, plugin command dispatch/permissions, `src/services/recording/appleCapture.ts` (new); `AppleIntelligenceHost.tsx` lecture handler.
  - **Depends/steps:** 0.5. Add one AVAudioEngine tap with bounded off-callback WAV writer and manifest. Share native mic ownership with composer/legacy speech; commit on interruptions/background by default; expose background:false until certified. Forward lecture entry into shared controller, retaining scan behavior. Do not rely on final recognition text for audio durability.
  - **Acceptance/tests:** Swift pure writer/state fixtures and fake bridge denial/interruption/late callbacks; real iOS foreground recording/kill/call evidence required before enabling. macOS desktop route uses certified desktop adapter. **Parallel:** yes with 0.6/0.7.

- [x] 0.9 Unify microphone ownership and root recording state; verify navigation and race behavior.
  - **Files/contracts:** `src/lib/speech/captureOwner.ts`, composer capture callers, `src/stores/recordingSessionStore.ts`, `src/services/recording/captureController.ts` (new), MainLayout host; D3 transitions.
  - **Depends/steps:** 0.6–0.8 contracts. Add owner/session/epoch, idempotent release, transition reducer and durable snapshot rehydration. Native lease is authoritative on mobile; UI acquires matching token. Mount root service once; disallow discard on close/navigation; explicit recovery continuation creates a new part.
  - **Acceptance/tests:** Double start, finish/interrupt race, late permission, composer busy, stale native callback, navigation/unmount and restart recovery all preserve committed audio. **Parallel:** no with edits to capture hosts from 0.6/0.8.

- [x] 0.10 Resolve an executable, privacy-safe session transcription plan; verify provider/settings matrix.
  - **Files/contracts:** `src/lib/transcriptionProvider.ts`, `hooks/useTranscriptionResolution.ts`, `services/transcription/{TranscriptionService,TranscriptionRouter,types}.ts`, `privacy/cloudAiDisclosure.ts`; D6 plan/authorization DTO.
  - **Depends/steps:** 0.1, 0.3a. Reuse existing resolver/catalog, reconcile only session adapter gaps and freeze actual provider/model/language/executor. Honor explicit local/offline selections and document flags. Require durable endpoint/source-kind consent; missing presenter blocks remote session execution. Recheck credentials at dispatch; no new providers.
  - **Acceptance/tests:** Local/Android/Apple/configured cloud × ready/unready × offline/local-only/excluded × consent/decline/missing presenter; cancellation never falls back. Existing provider tests remain a regression gate. **Parallel:** yes with storage/capture after contract freeze; coordinate active routing proposal.

- [x] 0.11 Extend the existing persistent queue with session executor claims; verify single execution and restart.
  - **Files/contracts:** `transcription_queue` migration/models/repository, `auto_queue.rs`, `job_queue.rs`, `TranscriptionJobManager.ts`, `jobs/types.ts`; new `sessionJobWorker.ts` within existing transcription/jobs.
  - **Depends/steps:** 0.3, 0.3a, 0.4, 0.10. Add D6 executor/lease/session fields and active-target uniqueness; restrict auto-queue dequeue to compatible executors. Implement claim/renew/expire/cancel epoch and root frontend-service worker; delegate native work to existing adapters. Replace session use of startChunkedJob; retain legacy caller compatibility.
  - **Acceptance/tests:** Two workers race→one claim; expired lease resumes; restart retains provider/target; cloud never enters local-only worker; job hydration performs no unauthorized egress. **Parallel:** no with 0.12 queue edits; migration allocated serially.

- [x] 0.12 Commit real decode units and all transcript metadata atomically; verify bounded memory and retry identity.
  - **Files/contracts:** `transcription/{engine,auto_queue,job_queue,mod}.rs`, Android `PcmDecoder.kt`/`SttJobManager.kt`, `src/api/audiobooks.ts`, `services/transcription/{persist,reconciliation}.ts`; canonical unit upsert.
  - **Depends/steps:** 0.3, 0.11. Slice actual≤60s input using existing decoders; bypass whole-WAV reads for session jobs; offset real words, validate speaker/confidence and fixed unit keys. Bound channels/native segment pages, acknowledge only DB commits, store checkpoint and segments in one transaction. Build compatibility projections from canonical source, no independent session JSON writer.
  - **Acceptance/tests:** Different windows contain different audio; repeated unit saves once; repeated spoken words remain distinct; DB failure keeps checkpoint; late response rejected; words/speaker/confidence roundtrip; untimed output stays untimed. **Parallel:** native pure decoder edits can be separate after API freeze; queue/persistence owner serial.

- [x] 0.13 Finish cancellation/progress/phase-0 reliability gate; verify audio stays usable through all downstream failures.
  - **Files/contracts:** queue worker cancellation tokens/sidecar lifecycle, `transcriptionQueueStore.ts`, `components/transcription/`, `LectureCaptureHost` tests; D6 events.
  - **Depends/steps:** 0.9, 0.12. Pass job/session/epoch through progress; display committed counts/actual provider; abort native/process work and fence stale commits. Exercise A01/A05/A06/A12/A13/A15 with generation disabled. Replace swallowed write success with actionable failed/partial status.
  - **Acceptance/tests:** Run focused TS/Rust/native tests in guide; fake90-minute bounded writer+restart and shorter real capture recovery pass on each enabled platform. No enabled platform bypasses its capture gate. **Parallel:** no; integration checkpoint. Phase0 done means safe capture and canonical STT, not full Learning Studio.

## 1. Phase 1 — Unified ingestion (P0)

- [x] 1.1 Add the thin shared session controller; verify all origins converge after durable save.
  - **Files/contracts:** `src/services/recording/SessionController.ts` (new), session API/store, existing JobManager; `finalizeIngestion` and `startSessionJob`.
  - **Depends/steps:** 0.13. Implement create→stage/save→probe→reuse transcript or enqueue→authorized analysis placeholder. Keep independent stage states; persist processing selections; no inference on mount. Session ID/document ID never change on retry.
  - **Acceptance/tests:** Origin-parametrized integration fake records identical post-save calls; provider failure retains asset. **Parallel:** no; controller seam required by following tasks.

- [x] 1.2 Build Capture & Import entry and active-recording presentation; verify all palette/platform aliases open one owner.
  - **Files/contracts:** `components/recording/CaptureImportDialog.tsx`, `ActiveRecording.tsx`, `RecordingStatusStrip.tsx` (new), registry/uiStore/MainLayout, both lecture hosts; UX screens1/2.
  - **Depends/steps:** 1.1. Use existing dialog/sheet/buttons/collection picker; four routes and optional metadata/processing; alias legacy events to shared controller and remove competing lecture event consumers. Show measured elapsed/save state, supported controls and recovery actions. Preserve scan/other palette commands.
  - **Acceptance/tests:** Desktop/mobile entry, focus restore, permission-denied, no-AI and alias double-delivery tests; close minimizes and explicit Finish saves. **Parallel:** yes with backend file import after controller contract freezes.

- [x] 1.3 Adapt file/folder/drop import to owned session assets; verify large files stream without a second document.
  - **Files/contracts:** `src/api/documents.ts`, `stores/documentStore.ts`, native folder-import plugin, document staging helpers; `services/recording/importMedia.ts` (new).
  - **Depends/steps:** 1.1. Reuse native picked-path copy and unique storage helpers; stream hash/probe; ensure video gets private ownership too. Detect extension versus codec versus player support separately. Do not call generic importer that already enqueues/creates a different document. Keep original on decode failure.
  - **Acceptance/tests:** MP3/M4A/WAV/FLAC/OGG/WebM/MP4/MOV fixtures use probe fakes plus device matrix; denied grant/IO failure/colliding basenames do not overwrite sources. **Parallel:** yes with 1.4; native import plugin one owner.

- [x] 1.4 Implement transcript-only import parsers; verify timing honesty and malformed inputs.
  - **Files/contracts:** `src/services/recording/transcriptImport.ts` and tests (new), `import_session_transcript` repository; existing canonical segments.
  - **Depends/steps:** 0.3, 1.1. Parse SRT/VTT/TXT via staged UTF-8 files, enforce20MiB bound, normalize line endings once, preserve multiline/overlapping cues and strip unsafe cue markup. Assign deterministic source-unit keys; plain paragraphs have timing none. Keep source snapshot; commit a full valid imported revision atomically.
  - **Acceptance/tests:** BOM/CRLF/Unicode/equation/settings/overlap/error fixtures; SRT with no audio has no player; malformed replacement leaves valid prior revision intact. **Parallel:** yes with1.3 using repository contract, no shared parser edits.

- [x] 1.5 Route native shares and supported URLs into the same ingestion; verify policy refusal and dedupe.
  - **Files/contracts:** `src/hooks/useShareTarget.ts`, existing staged-share APIs, URL import APIs/policy helpers, CaptureImportDialog adapter detector.
  - **Depends/steps:** 1.3,1.4. Detect recording/transcript shares once, stage privately and offer title/collection/profile. Recognize existing supported URL adapters; preserve YouTube compliance/canonical transcript paths and no cloud acquisition. Refuse unknown/private/DRM source; never convert article fetcher into an arbitrary media downloader.
  - **Acceptance/tests:** SEND/SEND_MULTIPLE duplicate intent, expired URI, unsupported URL/private redirect, YouTube source restriction and unchanged podcast importer. **Parallel:** no with1.3 native plugin changes; safe after import API freeze.

- [x] 1.6 Add batch status, exact-source reuse and collection assignment; verify independent outcomes.
  - **Files/contracts:** CaptureImportDialog/importMedia/session repository, existing collection/tag APIs; D1 hashes.
  - **Depends/steps:** 1.3–1.5. Queue bounded copies/probes, paginate results, assign existing collection, query checksum/source adapter identity and offer Open existing/Create separate. Bypass automatic audiobook grouping in session import. Reuse existing valid transcripts; do not infer source identity from names alone.
  - **Acceptance/tests:** Three files + one failure/duplicate produce deterministic independent sessions; Retry failed does not repeat successes; A17. **Parallel:** no with import controller changes.

- [x] 1.7 Add gated rollout settings and certify phase1 source-only journey; verify search coverage and preserved preferences.
  - **Files/contracts:** `settingsStore.ts`, Settings presentation if exposed, `settings/search/settingsSearchCatalog.ts`, `settingsSearchCoverage.ts` and tests, session controller/entry.
  - **Depends/steps:** 1.2,1.6. Add D12 flags preserving explicit false; use provider readiness as a separate state. Register all new meaningful Settings controls/groups with stable target/catalog/coverage rows per docs/settings-search.md. Keep source-only/recovery accessible when suggestions are disabled.
  - **Acceptance/tests:** Upgrade/hydration/search reveal tests show zero unsolicited inference; record/file/transcript/URL route smoke tests pass with no provider. **Parallel:** no; phase1 integration checkpoint.

## 2. Phase 2 — Learning Studio foundation (P0)

- [ ] 2.1 Add lazy document-owned Learning Studio route and player adapter; verify normal library reopen.
  - **Files/contracts:** existing router/tabs/document viewer wrapper/openDocumentAtLocation, `components/recording/LearningStudio.tsx`, `SessionPlayer.tsx` (new), existing media-server/player primitives.
  - **Depends/steps:** 1.7. Resolve session metadata by document ID and lazy-load areas; keep older ordinary document opening compatible. Adapt committed-part playlist seeks to media time; retain original asset on finalize error. Add Overview/Transcript/Extracts/Flashcards/Ask navigation shells with truthful unavailable states.
  - **Acceptance/tests:** Library→session→back restores context; media-only/partial/transcript-only/missing-media states; source cannot become duplicate audio playback. **Parallel:** yes with2.2 after route props freeze.

- [ ] 2.2 Render paginated canonical transcript/search/playback sync; verify long text and no invented precision.
  - **Files/contracts:** `components/recording/SessionTranscript.tsx` (new), TranscriptPanel reusable rendering, canonical API, existing virtualizer/selection hooks.
  - **Depends/steps:** 2.1,0.4. Load200-row pages, indexed timed lookups, follow-pause on manual scroll, search Next/Previous and cue navigation; pin focused/selected row. Show optional speaker/timing only when real; no global arrays of whole transcripts.
  - **Acceptance/tests:** 90-minute synthetic text navigation, selection across page boundaries, untimed/SRT-only/no-audio behavior and reduced-motion/focus tests. **Parallel:** yes with2.3, separate UI files.

- [ ] 2.3 Connect capture markers and pending passage resolution; verify confusing moment survives restart.
  - **Files/contracts:** recording controller/marker repository, `components/recording/SessionMarkers.tsx` (new), existing recent-passage resolver/types in audioEdition/remote-media capture.
  - **Depends/steps:** 0.9,2.1. Persist marker timestamp/window before feedback; render Overview Important/Confusing and active-capture actions. Resolve only canonical finalized text, bounded≤90s/3units, otherwise pending bookmark; link to source without fake extracts.
  - **Acceptance/tests:** One-tap A07, repeated-invoke extension, DB failure feedback and marker-before-STT→resolved-after-STT; no inferred quote from live text. **Parallel:** yes with2.2.

- [ ] 2.4 Enable transcript exact extracts through existing domain API; verify saved wording/provenance.
  - **Files/contracts:** `TranscriptPanel.tsx`, SessionTranscript selection adapter, existing createExtract command/repository, `learning_object_sources` migration/repository (new), selection_context resolver.
  - **Depends/steps:** 2.2,2.3. Capture segment keys/UTF-16 ranges; preview/save exact canonical quotation with versioned session evidence and notes. Add source-association table and transaction-aware extract helper now; no video_extract duplication for text quotations. Preserve existing resolved manual extracts/Inbox behavior.
  - **Acceptance/tests:** Actual transcript extract action works on desktop/mobile; repeated save request creates once; Unicode ranges/quote validation, pending bookmark and summary-not-quote cases. **Parallel:** no with shared provenance migration or domain extract edits.

- [ ] 2.5 Add transcript corrections with revision invalidation; verify accepted objects remain unchanged.
  - **Files/contracts:** canonical repository `correct_session_segment`, SessionTranscript editor, document content projection/index notification adapters.
  - **Depends/steps:** 2.4. Implement expectedRevision save, stable key, split mapping and debounced500ms projection flush; pause active STT at a committed boundary before correction, then adopt new expected revision on explicit continuation. Mark affected analysis/drafts stale, retain immutable accepted snapshots. Do not regenerate or overwrite accepted cards/extracts.
  - **Acceptance/tests:** Concurrent edit conflict; correction of technical terms/emoji/math; search text refreshed; original accepted wording and reviewed-card row hashes unchanged. **Parallel:** no with2.4 canonical evidence seam.

- [ ] 2.6 Extend shared source resolution for session evidence; verify exact and degraded Open in Source.
  - **Files/contracts:** `audioCaptureNavigation.ts`, `cardSourceNavigation.ts`, `openDocumentAtLocation.ts`, `cardSourceReference.ts`, review return context; session source API.
  - **Depends/steps:** 2.4,2.5. Add rich association lookup before existing fallback ladder; keep version1 envelope; support session selection_context, stable keys, unique quote reanchor and media validation. Use cue/section/document fallback with visible reason; preserve review/draft return state. Triage existing baseline ambiguous/no-anchor discrepancy without weakening matching.
  - **Acceptance/tests:** A08/A16/A18; stale/deleted/ambiguous/missing audio, existing PDF/EPUB/YouTube source suite and failing baseline case must pass or have an explicit independently owned fix. **Parallel:** no with other source-navigation change edits.

- [ ] 2.7 Complete source-only/manual phase2 workspace; verify useful operation without generation.
  - **Files/contracts:** Overview/Processing components (new), existing Studio source seed/manual authoring, LearningStudio route/store, UX screens3–6.
  - **Depends/steps:** 2.1–2.6. Show independent stages/error remedies and saved extracts, offer existing manual Studio editor without eager generation, export and retention actions. Hook queue notifications to current session; preserve focus on background completion. Map no provider/local-only states to actionable setup.
  - **Acceptance/tests:** A04/A06/A07/A14/A15/A18 source-only journey; manual card enters ordinary review and returns to source; audiobook/podcast/player regression smoke passes. **Parallel:** no; phase2 checkpoint, usable even if analysis never ships.

## 3. Phase 3 — AI learning pipeline and safe staging (P0/P1)

- [ ] 3.1 Persist analysis checkpoints and learning drafts; verify no learning items appear on generation.
  - **Priority/files/contracts:** P0; D4 `session_analysis_runs`, `session_analysis_units`, `session_learning_drafts` migrations/repositories and `src/api/recordingSessions.ts` draft/run methods.
  - **Depends/steps:** 2.7. Add status/revision/unique keys/paging, manual run-null support, optimistic edits/reject, input hashes and supersession. Separate from capped localStorage and review tables. Add retention/privacy ownership and no automatic indexing of drafts.
  - **Acceptance/tests:** >100 drafts survive restart/page access; reject/close/cancel create zero learning_items/extracts; stale edit conflicts; retry same unit yields same drafts. **Parallel:** no with other migration allocations; task/planner code can follow frozen DTOs.

- [ ] 3.2 Compose atomic, idempotent acceptance from existing domain services; verify required provenance failure rolls back.
  - **Priority/files/contracts:** P0; `commands/learning_item.rs`, learning/extract repositories, AI provenance repository, session draft/source repository; D10 acceptance command.
  - **Depends/steps:** 3.1,2.4. Extract transaction-aware normal creation helpers and lower-case type/cloze conversion; preserve tree/count/default scheduling. Implement per-item validation/CAS, duplicate decision, item+source+AI provenance+accepted target in one transaction. Enqueue daily-note/notification work after commit; return stable per-ID results.
  - **Acceptance/tests:** Accept double click/lost reply/two windows creates once; provenance failure creates none; mixed batch returns explicit partial result; correct cloze rendering; no reviewed-card mutation. **Parallel:** no with domain service refactors from other proposals.

- [ ] 3.3 Implement deterministic transcript unit planning and token budgets; verify every request fits small/large model contexts.
  - **Priority/files/contracts:** P0; `src/services/recording/analysis/unitPlanner.ts` (new), existing chunkTextByTokens helpers; D8 budgets.
  - **Depends/steps:** 3.1 DTOs. Build segment/topic-boundary units, max128-token context overlap, deterministic oversize-segment ranges and summary tree groups≤8. Include system/output/safety reserve, mobile concurrency and64/16 request budget counters; error when insufficient context rather than dropping evidence silently.
  - **Acceptance/tests:** Small-context/huge paragraph/Unicode/multi-hour/unknown timing fixtures; consumed tokens/output stay within limits; input identity stable across restart; overlap doesn't duplicate proposals. **Parallel:** yes with3.4 on disjoint planner/schema files.

- [ ] 3.4 Register structured section/overview tasks and evidence validators; verify hallucinated sources cannot be accepted.
  - **Priority/files/contracts:** P0; `src/lib/ai/tasks/definitions/sessionSectionAnalysisTask.ts`, `sessionOverviewTask.ts`, `schemas/sessionAnalysis.ts` (new), existing runTask/Learn This validation/quality helpers.
  - **Depends/steps:** 0.1,3.1 DTOs. Define one combined section result for topics/concepts/extracts/cards/profile observations; wrap untrusted content, include task version, validate owned segment/range quote and reconstruct times from source. Map authoring types to existing candidate types; quality-block generic/contextless/broad/unsupported cards; keep notes distinct from quotations.
  - **Acceptance/tests:** Malicious transcript instructions, invented quote/segment/speaker/time, notation preservation, cloze source validation, card/quote caps and one-repair failure behavior. **Parallel:** yes with3.3; shared task registry integration merged serially.

- [ ] 3.5 Add checkpointed analysis coordinator; verify restart/cancel/partial results and cost boundaries.
  - **Priority/files/contracts:** P0; `src/services/recording/analysis/SessionAnalysisCoordinator.ts` (new), controller, analysis API/repository; existing runTask/readiness/privacy.
  - **Depends/steps:** 3.2–3.4. Claim one run, schedule bounded units with runTask, persist validated results/input hashes before progress. Hierarchical overview consumes only evidence-linked summaries; count repair/retry calls in request budget, max2 transport retries. Pause on capture/thermal/suspend/privacy changes; Retry failed only; Regenerate new epoch without erasing originals before success.
  - **Acceptance/tests:** Fake deterministic requests A01/A02/A10/A12; unit crash/cancel late return, budget exhausted and changed transcript cases; no duplicate inference for committed inputs and no active learning item. **Parallel:** no with controller integration.

- [ ] 3.6 Reconcile duplicate concepts/cards in course scope; verify existing review history is untouched.
  - **Priority/files/contracts:** P1; `analysis/duplicates.ts` (new), existing cards/duplicates.ts, quality helpers, paginated backend card/source queries.
  - **Depends/steps:** 3.2,3.5. Use exact source/content fingerprints then existing lexical comparison; use available embeddings only as optional advisory signal. Store match method/score/card IDs; implement Use existing/Skip/explicit Keep both acceptance decisions. Do not fetch entire library or automatically merge concept graphs.
  - **Acceptance/tests:** Exact retry, repeated quote in different source, cross-session overlap, unrelated same-name concept and A11/A17; card/history byte snapshots unchanged on Use existing. **Parallel:** yes with3.7 after coordinator payload contract freeze.

- [ ] 3.7 Add output profiles and explicit processing selection; verify meeting cards default off.
  - **Priority/files/contracts:** P1; `analysis/profiles.ts` (new), profile_json DTO/validation, Capture dialog/Overview processing controls, i18n.
  - **Depends/steps:** 3.5. Define versioned D9 output defaults, user override and unknown-type fallback. Persist opt-in and display scope/call estimate; no generation on a flag toggle/mount alone. Apply profile to same tasks, not separate providers; source document exclusions win.
  - **Acceptance/tests:** MP4 Meeting→decisions/actions and zero card drafts; Lecture selected→cards; unset selection→no inference; profile change invalidates only corresponding analysis cache. **Parallel:** yes with3.6 on separate files.

- [ ] 3.8 Certify the small analyzed vertical slice before broader UX; verify source→draft→explicit acceptance→review.
  - **Priority/files/contracts:** P0; integration fixture runner, existing reviewStore/domain queue and session services.
  - **Depends/steps:** 3.6,3.7. Run identical finalized transcript through recorded/imported sessions, produce bounded evidence-linked drafts, reject one and accept another through command path. Capture due-list counts and source target; simulate restart/retry and no provider.
  - **Acceptance/tests:** A01/A02/A03/A09/A10/A11 pass deterministic integration; rejected draft never in due query, accepted card ordinary FSRS, existing history unchanged. **Parallel:** no; phase3 safety gate before enabling generated suggestions in UI.

## 4. Phase 4 — UX and learning integration (P1)

- [ ] 4.1 Extract reusable Flashcard Studio draft presentation/editor; verify legacy Studio behavior unchanged.
  - **Files/contracts:** `FlashcardStudioModal.tsx`, `components/review/studio/{DraftCardEditor,DraftCardList}.tsx` (new), existing DraftCard/Studio seed and local sessions.
  - **Depends/steps:** 3.8. Move cohesive rendering/editor logic with current props; export typed adapter boundary for durable payload/evidence, preserving existing localStorage sessions and alreadyPersisted legacy handling. Avoid unrelated restyling or rewriting the monolithic modal.
  - **Acceptance/tests:** Existing Studio session suites and manual/extract-picker generation/save behavior pass; component editing/cloze/source props work independently. **Parallel:** no with4.2/4.3 or other Studio changes.

- [ ] 4.2 Add durable session draft adapter and approval screens; verify every approve/reject path.
  - **Files/contracts:** `studio/sessionDraftAdapter.ts`, `components/recording/{SessionFlashcards,SessionExtracts}.tsx` (new), Studio seed, LearningStudio route; UX screens6/7.
  - **Depends/steps:** 4.1,3.2. Load paginated durable drafts, map source evidence, edit with expected revision, Reject/Regenerate and Accept selected/all eligible. Block unresolved duplicate/grounding/stale candidates; compare existing card and expose per-item save results. Session seed never triggers eager extract generator or localStorage truncation.
  - **Acceptance/tests:** >100 drafts reachable; opening generates no learning items; selected acceptance count exact; failure retry idempotent; desktop/mobile source preview and keyboard focus. **Parallel:** no with4.1; extract/card area presentation can split after adapter freezes.

- [ ] 4.3 Replace Inbox generic card creation with editable Studio handoff; verify ordinary listening still works.
  - **Files/contracts:** `ListeningSessionInbox.tsx`, existing Studio opening handoff/seed, audio capture provenance helpers.
  - **Depends/steps:** 4.1,2.6. Replace literal key-insight createLearningItem call with source-seeded manual draft; offer bounded generation only when authorized. Preserve existing Keep/Discard/notes/Ask/marker semantics and linked extract provenance. No eager persist call for the new handoff.
  - **Acceptance/tests:** Click Make Flashcard creates zero cards until Save/Accept; source lineage retained; ordinary TTS edition/audiobook Inbox triage unchanged. **Parallel:** yes with4.4 once shared Studio files finish.

- [ ] 4.4 Extend existing semantic index with canonical session evidence; verify filtered grounded Ask citations.
  - **Files/contracts:** `src-tauri/src/ai_learning/{indexer,chunker,retrieval}.rs`, chunk location JSON/types, existing Assistant contextResolver/conversation scopes and selection handoff.
  - **Depends/steps:** 0.3a,2.5,2.6,3.8. Prefer canonical session segments; add stable segment/range and optional timing locators. Reuse FTS projection, skip excluded content/drafts/summaries. Session/course Ask freezes explicit document IDs, uses existing bounded retrieval/citation validation and opens existing Assistant; no new chat/index.
  - **Acceptance/tests:** A04/A16/A17/A18; untimed text citation, exact timestamp, corrected stale index, empty-index bounded fallback and collection filter excluding unrelated matches. **Parallel:** yes with4.3, coordinate active AI retrieval/agent proposals.

- [ ] 4.5 Complete Overview/processing/mobile/accessibility polish; verify all seven specified screen states.
  - **Files/contracts:** recording workspace components, existing adaptive/md3 primitives, i18n catalogs, source inspector/sheet; UX full contract.
  - **Depends/steps:** 4.2–4.4. Display evidence-linked outline/takeaways/markers, actual stages/results, loading/empty/offline/partial/recovered states. Implement responsive panes/sheets, focus return/live-region throttling/large text, reduced motion and supported native feedback. Use existing theme tokens; no new brand system.
  - **Acceptance/tests:** Screen snapshots desktop/mobile light/dark/E-Ink, keyboard-open/long titles, screen reader/focus; no motion-only/color-only state; no fake percent or unsupported haptic promise. **Parallel:** only independent i18n/visual fixtures after component changes settle.

- [ ] 4.6 Finish retention, export, backup and safe flag rollback; verify no silent media loss or upload.
  - **Files/contracts:** session delete/export APIs, filesystem cleanup journal, existing backup/restore serializers, document sync registration and flags.
  - **Depends/steps:** 0.3a,4.5. Add explicit media-only/session deletion modes and ownership checks; include session tables/manifests in local backup/restore, restore private paths by IDs. Prevent new assets/drafts from silent cloud enrollment; respect accepted-object privacy. Disable flags by draining capture, stop new work and keep recovery/export. Preserve accepted cards unless explicitly selected for deletion.
  - **Acceptance/tests:** Missing/shared asset, interrupted delete/retry, backup→restore, feature-off with active recording and retained accepted cards; no remote content egress. **Parallel:** no with active schema/storage changes.

- [ ] 4.7 Execute the cross-platform/regression release gate; verify claims only with recorded evidence.
  - **Files/contracts:** validation.md implementation evidence, new regression tests/benchmarks, existing package/Rust/native commands and performance baselines.
  - **Depends/steps:** 4.6. Run A01–A18, targeted and required broader checks, `npm run bench:check`, bundle/memory checks and real-device matrix. Compare engine/decoder memory slopes, initial lazy-load cost and review/history integrity. Record unavailable/failing environments explicitly; fix P0/P1 regressions before platform flag enablement. No release build required for proposal validation.
  - **Acceptance/tests:** Enabled platforms have truthful evidence; existing audiobook/podcast/YouTube/readers/Studio/FSRS/Ask/native speech regressions pass; intentional perf baseline changes explain why. **Parallel:** device runs on separate devices may run independently, no shared source edits during measurement. Phase4 complete is the P0/P1 product release.

## 5. Phase 5 — Advanced refinements (P2, independently gated)

- [ ] 5.1 Refine batch/directory ingestion without changing source semantics; verify bounded throughput and cancellation.
  - **Files/contracts:** importMedia/batch UI/native folder plugin, existing folder filtering; same session APIs.
  - **Depends/steps:** 4.7. Add resumable manifest of large folder selections, user filtering and per-file retry; throttle2 desktop/1mobile copies, allow cancelling remaining work while keeping successes. Preserve one session per recording unless explicitly selected otherwise.
  - **Acceptance/tests:** Large synthetic directory, partial inaccessible entries and restart; course/duplicate assignment remains correct. **Parallel:** yes with5.2–5.4 in separate files after stable release.

- [ ] 5.2 Add speaker editing and certified diarization enhancements; verify no fabricated identity.
  - **Files/contracts:** canonical speaker_id metadata, transcript/Overview editor, existing STT provider capabilities.
  - **Depends/steps:** 4.7. Expose explicit speaker label rename/merge scoped to session, preserve immutable accepted evidence and distinguish provider diarization from user labels. Request diarization only from an existing proven eligible provider; absent support retains unlabeled transcript.
  - **Acceptance/tests:** Two-speaker fixture rename/merge/correction, absent diarization and optional endpoint/device test evidence. **Parallel:** yes with5.1/5.3, no overlapping canonical schema edits.

- [ ] 5.3 Associate slides/PDFs using existing library documents; verify separate source identities.
  - **Files/contracts:** session metadata/association API (new), existing document picker/source navigation.
  - **Depends/steps:** 4.7. Add user-selected related-document IDs to session metadata with validated local existence/privacy. Render Related materials links; do not infer slide timestamps or OCR/quote relationships without explicit evidence.
  - **Acceptance/tests:** Attach/remove/deleted PDF and independent privacy/source navigation; session transcript/accepted cards unchanged. **Parallel:** yes with5.1/5.2.

- [ ] 5.4 Add optional cross-session concept relations through existing knowledge adapter; verify history-preserving reuse.
  - **Files/contracts:** existing concept API/`complete-knowledge-relationships-and-coverage` adapter, session concept references; no new graph/index.
  - **Depends/steps:** 4.7 and that change's accepted public relationship adapter. Query bounded course concepts, propose shared evidence/coverage with explicit acceptance; distinguish known evidence from mastery. If dependency absent, leave advanced UI unavailable without blocking P0/P1 release.
  - **Acceptance/tests:** Same concept across recordings links multiple sources without duplicate cards, automatic graph writes or scheduler mutation. **Parallel:** yes with5.1–5.3, adapter ownership coordinated.

- [ ] 5.5 Certify additional profiles and background capture capability; verify each optional enhancement before exposure.
  - **Files/contracts:** profiles.ts, native RecordingBridge/service capability flags, iOS Info configuration/source templates, validation evidence.
  - **Depends/steps:** 4.7; profiles may proceed after3.7 contract. Tune interview/seminar/voice-note outputs using existing tasks; expose iOS continuous background capture only after audio-session/entitlement/interruption/lock-screen tests meet D12. Keep safe-stop default otherwise; do not imply background LLM execution.
  - **Acceptance/tests:** Profile-specific grounded fixture evals and real iOS background evidence; unsupported builds show truthful capability. **Parallel:** profile and native implementation separate owners; platform flag change serial. Phase5 completion is feature-specific, not a prerequisite for P0/P1 release.
