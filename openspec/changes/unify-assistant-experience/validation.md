# Validation and acceptance plan

## What ran for this proposal

Source audit at `70915a122cc0a17bd49e098fbea7e5e41e70d379`, with unrelated local modifications recorded in audit.md. Two existing focused Vitest runs passed: **17 files, 205 tests**. The first command was:

```sh
npx vitest run src/lib/ai/assistant/__tests__ src/components/tabs/__tests__/documentQaSessions.test.ts src/components/assistant/__tests__/AssistantPanelScopePersistence.test.tsx src/components/assistant/__tests__/AskSheet.test.tsx src/components/assistant/mobile/__tests__/gesture.test.ts src/hooks/__tests__/useComposerDictation.test.tsx
```

It passed 14 files / 155 tests. The second command was:

```sh
npx vitest run src/lib/ai/__tests__/libraryTask.test.ts src/features/documentQa/__tests__/workspaceGrounding.test.ts src/utils/__tests__/resolveCitationLocation.test.ts
```

It passed 3 files / 50 tests. Expected quota-test logging and existing mocked-Tauri listener/media/React warnings appeared. These are mocked/frontend audit checks, not acceptance of the proposed implementation. OpenSpec validation results are recorded at the end after artifact generation. No implementation, live model, native build/device session, Rust test run, browser screenshot run or performance measurement is claimed here.

## Acceptance contract and test layers

The scenarios below are release gates for future implementation, not completed work. Each journey must verify visible state, outgoing source/provider plan, durable read-back and failure recovery. Use deterministic provider/retriever fixtures; assert actual sent IDs/text/reference tables, not just labels or component snapshots. Intercept network destinations for privacy tests. Test at least one real provider per advertised capability after fixture coverage passes; live-provider correctness is separately documented.

- **Unit/property:** routing precedence, strict empty sets, localized intent fallback, source snapshots, versioned citation numbers/quotes, unique locator matching, migration manifests/idempotence, branch ordering, retry deduplication and dictation generation guards. Use seeded data for performance fixtures.
- **Component/integration:** real sidebar/workspace/host adapters around controlled providers; hydration races, delayed handoff, dirty drafts, phase events, pending/cancelled output, shared renderer/copy/export and learning actions. Test actual adapter boundaries that existing mocked AskSheet tests omit.
- **Native repository/command:** temporary SQLite databases, additive migration from actual legacy table schemas, transaction failure/restart, source-edge reauthorization, ordered messages and outbox publication. Run scoped Rust suites and relevant server sync tests; never infer transport correctness from frontend mocks.
- **Sync integration:** two compatible enrolled test clients, same server allowlists/crypto paths as production, offline divergence, old client/server capability failures, tombstones, revoke/quota and encrypted payload inspection. No real user data in fixtures.
- **Browser interaction/accessibility:** desktop and 360px mobile with actual surfaces, keyboard/IME, 200% zoom, long translations/titles, dark/light/high-contrast/E-Ink where supported, reduced motion, focus and scroll restoration. Preserve existing visual fixture coverage; browser viewport simulation is not native validation.
- **Physical devices:** Android gesture navigation from both edges, predictive cancellation where supported, existing app swipe Back, IME priority, haptic feel/count, real speech permissions/locality, fullscreen, safe areas, background/process death and TalkBack; iPhone keyboard/safe areas/interactive dismissal/VoiceOver and supported speech. Linux/macOS/Windows native windows require source navigation, resize, focus, persistence and provider smoke coverage. Mark unsupported capabilities explicitly.

## Thirty end-to-end journeys

### 1. General question on dashboard

**Given** a fresh ordinary conversation without a document. **When** the user asks Who invented the transistor. **Then/UI** a model-knowledge answer appears in the canonical thread without missing-document setup. **Context** no library/web/source evidence is fabricated. **Persistence** question, response, actual provider and draft are read back. **Recovery** missing provider offers Settings and retains the question. Unit routing + desktop/mobile integration.

### 2. Current PDF page

**Given** an authorized PDF at page 12. **When** the user asks Explain this page. **Then/UI** Title · page 12 is visible and the answer addresses that page. **Context** bounded page/selection plus permitted support, never another document in strict Document. **Persistence** exact submitted locator/version stays with the turn. **Recovery** no text/OCR/vision yields a clear limitation and retained question. Viewer/adapter integration + native PDF smoke.

### 3. Selected paragraph explanation

**Given** a paragraph is selected. **When** Select → Ask → question → Send occurs. **Then/UI** one Assistant opens with the captured quote and follow-up input. **Context** original selection precedes surrounding evidence; over-budget prompt portion has a truncation notice. **Persistence** full original selection, sent portion and locator survive save. **Recovery** permission failure preserves selection/draft without dispatch. Selection/mobile integration.

### 4. Follow-up after highlight disappears

**Given** journey 3 answered. **When** the highlight disappears and the user asks Give me a simpler example. **Then/UI** the same conversation continues with selection context visible. **Context** saved authorized selection resolves the referent; prior answer is not new evidence. **Persistence** both turns retain original provenance. **Recovery** revoked selection source gives an unavailable state or permitted general continuation action. Unit + adapter race test.

### 5. Compare current PDF with another library item

**Given** PDF A is optional context and document B is eligible. **When** the user asks Compare this with @B. **Then/UI** both titles appear and the answer compares cited passages. **Context** IDs restricted to A+B intersect collection permissions. **Persistence** raw mention tokens/plan retained. **Recovery** strict Only A offers Include B; unavailable B never silently disappears or expands to all documents. Router + RAG boundary tests.

### 6. Citation excursion and return

**Given** reader page 12, a scrolled answer and unsent draft. **When** a citation opens another source and the user returns. **Then/UI** exact verified location/highlight appears, then prior thread scroll/draft/focus and reader page restore. **Context** jump uses citation's source/version, not active composer source. **Persistence** temporary excursion does not commit original reading progress. **Recovery** deleted target/closed origin offers saved thread or non-exact open with a reason. All native desktop OSs + phone navigation.

### 7. EPUB chapter comparison

**Given** chapter 4 is active with chapter 3 available. **When** the user asks how these chapters connect. **Then/UI** section titles identify actual evidence and sources open at section/CFI. **Context** both requested boundaries are planned within budget. **Persistence** section IDs/mentions and citations survive reload. **Recovery** missing chapter/CFI is disclosed without invented page numbers. EPUB fixtures + native EPUB smoke.

### 8. YouTube full transcript

**Given** a complete canonical transcript longer than the prompt budget. **When** asked about the conclusion or whole video. **Then/UI** relevant ending evidence or hierarchical coverage is shown with valid time links. **Context** existing transcript planner covers the intended material; original segments support citations. **Persistence** transcript version/coverage/time range retained. **Recovery** synthesis timeout remains partial/interrupted with retry, never claims completed full coverage. Planner + adapter integration and native playback.

### 9. Partial or unavailable transcript

**Given** only early segments or no transcript. **When** asked what was said near the end. **Then/UI** partial/unavailable status and retry/general-knowledge option appear. **Context** no fabricated ending speech/timestamps; fitting partial text does not become full-transcript status. **Persistence** limitation stored with the turn. **Recovery** successful transcript retry creates a new attempt with reviewed coverage. Fixtures for ready/loading/partial/failed/unavailable.

### 10. Library question from command palette

**Given** an outgoing thread/draft and delayed workspace mount. **When** Ask my library or a full question suggestion is activated twice. **Then/UI** one destination opens with an empty or complete editable prefill and visible library policy. **Context** no model/retrieval until explicit Ask; help/search commands keep destinations. **Persistence** outgoing draft and nonce acknowledgment safe. **Recovery** storage failure queues/dismisses entry without consuming a newer intent. Palette integration + browser keyboard/touch.

### 11. Collection restriction

**Given** collections C and D with similarly worded sources. **When** the question is narrowed to C. **Then/UI** C is visible on composer and answer. **Context** semantic/lexical/Spotlight/alternate retrieval and metadata queries exclude D. **Persistence** submitted C policy stable after later UI changes. **Recovery** C empty/deleted yields source-choice recovery, never whole library. Native retrieval + TS/postfilter tests.

### 12. Explicit source policy changes

**Given** a strict Document turn and an unsent follow-up. **When** the user deliberately chooses Library, then Chat. **Then/UI** restriction changes visibly without losing thread/draft. **Context** each turn obeys its submitted policy; removing section override reveals base policy. **Persistence** prior policies remain historical. **Recovery** ineligible source or denied broadening retains original restriction/question. Router + presentation tests.

### 13. Unrelated general question while reading

**Given** active PDF optional context, including unavailable/excluded source variants. **When** the user asks Explain eigenvectors without source targeting. **Then/UI** a general response is allowed. **Context** no protected PDF text/history travels with a source-free question; no unnecessary extraction. **Persistence** same thread records model origin. **Recovery** if the user had explicitly locked Document, show no-source-evidence and a user-initiated Chat action instead. Privacy + routing matrices.

### 14. Sidebar to expanded workspace

**Given** several cited turns and a section-mentioned draft. **When** Expand workspace then Return to reader. **Then/UI** same ID/history/draft/citations and linked study artifacts; sidebar reader width remains usable. **Context** no duplicate provider invocation. **Persistence** one repository owner. **Recovery** unready workspace leaves current state/draft visible with retry. Desktop browser/native integration.

### 15. Mobile view changes

**Given** global sheet contains completed turns and a draft over A. **When** closed, navigate to B/library/dashboard and reopen. **Then/UI** history persists; inferred context shows the new view and explicit locks stay visibly locked. **Context** inactive pane publishers never contribute. **Persistence** same conversation across detents/remount. **Recovery** backgrounding cancels dictation and checkpoints generation without output reassignment. Host/registry tests + physical phones.

### 16. Reopen selection conversation

**Given** a selection thread was saved then dismissed. **When** reopened from History after reload. **Then/UI** original passage/answer/follow-up draft returns without re-selection. **Context** source permissions rechecked. **Persistence** different selection requests cannot overwrite that thread; same handoff isn't imported twice. **Recovery** removed source yields a retained unavailable placeholder. Migration + mobile/desktop history integration.

### 17. Continue on another device

**Given** compatible enrolled Android and desktop, sync acknowledged for an eligible conversation. **When** its workspace history is opened on desktop. **Then/UI** same ID/messages/evidence and real sync state. **Context** receiving provider/source permissions checked; missing source binary is honest. **Persistence** offline concurrent follow-ups survive as deterministic branches exactly once. **Recovery** unsupported server/client, quota or revoked session stays local/pending with reason, not false success. Crypto/merge/server + two-client integration.

### 18. Dictation, edit, explicit send

**Given** draft and caret selection with permitted app dictation. **When** start/stop, edit transcript then Send. **Then/UI** recording/stop status, exactly-once insertion, no auto-submit; typing available. **Context** on-device requirement and actual capability enforced. **Persistence** edited text saves normally; audio/recognition callbacks do not sync. **Recovery** permission denial, network speech consent refusal, late duplicate, draft edit or background cancellation retain text. Hook tests + Android/iPhone hardware; browser fallback separately.

### 19. Stop, retry, and failures

**Given** a saved pending turn in each phase. **When** Stop then Retry or a provider timeout occurs. **Then/UI** accurate stopped/failed state and retained question; new attempt under same user turn. **Context** saved policy reviewed if changed; unsupported cancellation explained. **Persistence** no duplicate user turn/accepted tool effect; late first attempt ignored. **Recovery** process death marks interrupted, explicit retry only. Fake delayed transport + native cancellation smoke.

### 20. No matches or missing embeddings

**Given** absent/stale embeddings or no supporting documents. **When** strict library Ask is sent. **Then/UI** actual lexical/retrieval-only or no-evidence status, coverage and refine/broaden actions. **Context** same authorized filters, no exhaustive claim or automatic model-only answer. **Persistence** retrieval mode/limitation saved. **Recovery** indexing/setup can be opened and the question retained. Rust retrieval + task composition tests.

### 21. Exclusion/local-only boundaries

**Given** excluded source, local-only source, strict-local settings, remote-custom endpoint and historical-private variants. **When** source resolution, embedding, web/suggestions, repair, fallback or continuation would transmit content. **Then/UI** accurate local/blocked state and permitted recovery. **Context** network spy observes zero forbidden source/query/history bytes. **Persistence** restricted conversations remain device-local; pending private outbox purged. **Recovery** consent decline retains draft; metadata null/deletion fails closed. Privacy property/integration + encrypted outbox inspection.

### 22. Non-destructive migration

**Given** raw oversized sidebar/Q&A/legacy SQLite histories, drafts, images, tool results, unknown fields and malformed records. **When** import is interrupted, restarted and repeated. **Then/UI** all valid recoverable threads visible and corrupt imports identified. **Context** old citations remain legacy rather than invented. **Persistence** counts/hashes/read-back match raw input, no caps, no duplicate IDs, byte-identical originals. **Recovery** quota/disk failure defers ownership cutover; flags/binary downgrade never overwrite post-cutover data. Native/browser migration fixtures.

### 23. Citation parity

**Given** cited original source 3, an invalid source 1, a selection-only citation and media/page/CFI locators. **When** rendered/copied/exported/reloaded in sidebar/workspace/mobile/PWA where available. **Then/UI** marker 3 remains 3, valid quotes/details match, invalid marker inert/removed and source origin explicit. **Context** same validated table everywhere; general facts have no invented citations. **Persistence** exact metadata intact. **Recovery** unknown legacy refs are readable but never promoted to verified. Shared-renderer + adapter contract tests.

### 24. Large documents/library responsiveness

**Given** 1,000-page PDF, 3,000-item library, 1,000-message thread and a long timed transcript. **When** open/type/resize/scroll/source-expand and stream occur. **Then/UI** input responsive within declared budgets and bounded mounted history. **Context** no full extraction on open/keystroke; caches invalidate on content version, ticks don't retokenize. **Persistence** batched saves acknowledged without typing-blocking map serialization. **Recovery** slow extraction has real status/cancel and retained input. Browser profiling + release native measurements + repository benchmarks.

### 25. Back, gestures and overlay ownership

**Given** closed/partial/expanded sheet, higher dialog, IME, fullscreen and native picker variants. **When** Android edge/predictive Back, app swipe-back, pill drag/handle drag/cancel and accessible taps occur. **Then/UI** exactly one correct owner acts; outside-pill scrolling cannot invoke; partial reader interactive, expanded modal focus correct. **Context** no extraction/AI during drag. **Persistence** reading/draft intact. **Recovery** capture loss/background/rotation cancels gesture; single-detent fallback valid. Pure gesture tests + physical Android/iPhone; haptic delivery must be recorded.

### 26. Stale asynchronous completion

**Given** source A turn, then new conversation/account/reset B. **When** old resolve/token/validation/tool callback completes after B is active. **Then/UI** B remains untouched. **Context** frozen source IDs and account/turn/attempt epochs enforced before viewer/tool effects. **Persistence** valid detached result belongs only to A; tombstoned conversation isn't resurrected. **Recovery** source-bound resolver loss is cancelled/interrupted with explicit retry. Deferred-promise race integration at every boundary.

### 27. Grounding across turns

**Given** answers cite two papers then a transition through Chat. **When** user asks compare the second paper's method with the first. **Then/UI** unique saved source identities resolve, or ambiguity picker appears. **Context** new authorized evidence re-retrieved; older Chat facts only resolve references, not support strict claims. **Persistence** each turn has immutable provenance. **Recovery** missing one source says which and offers an explicit policy adjustment, not silent replacement. History/routing + RAG integration.

### 28. Removed/reimported source

**Given** saved citation and dependent follow-ups. **When** source deleted, privacy changed, content reimported or quote repeated ambiguously. **Then/UI** unavailable/revalidation status and inert exact jump as appropriate. **Context** missing authority excluded from outgoing history/summaries. **Persistence** original authorized history retained with provenance; source/conversation tombstones respected. **Recovery** verified identical reimport may be offered transparently; no same-title first-match guess. Resolver/version/cache + native sync tests.

### 29. Legitimate learning actions

**Given** an authorized answer with citations. **When** the user asks for flashcards or selects Make flashcard/Create extract. **Then/UI** existing review/confirmation/tool flow and saved artifact links work. **Context** tool parameters/source ownership validated; ordinary explanation or malicious source text cannot execute a privileged action. **Persistence** result IDs saved, only explicit promoted artifacts enter the normal index. **Recovery** failed/uncertain execution exposes retry/reconcile without repeating successful effects; reload/sync never replays. Existing tool/action tests plus canonical controller integration.

### 30. Provider without response streaming

**Given** a native structured or cloud provider path advertising no text streaming. **When** Ask is submitted. **Then/UI** real phases, responsive draft and stop/retry appear; no pretend token stream. **Context** same budget, privacy and evidence validation as streamed path. **Persistence** final validated envelope or typed failure saved. **Recovery** timeout/invalid JSON does not show trusted partial citations/tools; fallback obeys renewed consent. Capability/transport matrix + one real non-streaming provider smoke.

## Performance instrumentation and proposed budgets

No latency baseline was measured for this proposal. During milestone 0 record release-build median/p95, sample count, cold/warm cache, fixture hashes, OS/WebView/app revision, device/RAM and provider capability. Separate UI-local latency from provider/network latency. Use at least 30 repeated samples after a documented warm-up for local interactions; record cold runs separately and do not average them into warm values.

| Metric | Proposed acceptance budget / invariant | Verification |
|---|---|---|
| Warm invoke to interactive composer | p95 ≤150ms desktop; ≤250ms reference phone | App performance marks, no provider required |
| Cold lazy invoke | p95 ≤500ms on recorded release fixture/device | Separate module-load timing; no model request on open |
| Input to painted draft | p95 ≤50ms, no assistant-caused synchronous task >50ms while typing | Browser trace + native WebView timing |
| Acknowledge stop/detach in UI | ≤100ms from activation; actual provider stop tracked separately | Controlled delayed transport |
| Visible streaming update cadence | Batch at most once per animation frame; no lost text or draft focus | High-rate fake stream + profiler |
| Draft durability | Acknowledged ≤500ms after idle under normal storage, explicit flush before navigation; no silent failed save | Fake clock + real repository acknowledgment |
| Cached citation details | p95 ≤150ms; uncached resolving state shown immediately, no guessed jump | Source-version cache fixtures |
| Large-context work | No eager full-document extraction/indexing on open/typing; bounded context by actual provider budget | IO spies, memory trace, request fixture |
| Bench/bundle | `npm run bench:check` and bundle budgets pass; intentional changes update baselines with reasons | Repository anchored benchmark gate |

These are proposed product budgets, not observed measurements. If hardware shows a budget is infeasible, document the trace and revise explicitly before release; do not convert measured regressions into hidden tolerance increases. Provider time-to-first-event/token is instrumented/reported per capability without a universal service SLA. Include extraction/retrieval/validation/save spans so UI improvements cannot hide expensive preprocessing.

Benchmarks added during implementation use `seededRandom` from `src/test/bench-support.ts`, fixed sizes, no network/filesystem/Tauri or wall-clock inputs, consume results in a sink and return void. Preserve `noise-anchor` ratio baselines; any intentional change updates `scripts/perf-baselines.json` and bundle budgets in the same change with rationale.

## Milestone and release gates

1. Repository/migration can ship behind flags as verified local history without changing live surfaces. Raw-data manifests and rollback-reader checks must pass first.
2. Strict routing/privacy and citation table pass actual adapter-boundary tests before automatic context or new entry paths become default.
3. Mobile consolidation requires existing compact-composer/gesture regressions plus recorded native Back/IME/focus/dictation/partial-accessibility checks, not just viewport emulation.
4. Desktop and palette continuity retain existing Q&A research/study regressions, exact navigation and zero automatic submission.
5. Streaming stays off per unsupported capability; sync stays off until server-first compatibility, two-client convergence, encryption/private-data inspection and failure recovery pass.
6. Release validation runs relevant existing/new Vitest suites, TypeScript/lint, scoped Rust/server suites, browser/visual checks, `npm run bench:check`, docs validation and OpenSpec strict validation. `npm run test:scripts` is required if benchmark/build scripts change. GitHub Actions is not the repository gate.
7. Record platform/version/device/provider and results per journey; a supported untested platform is an outstanding gate, not a checked box. Flag rollback, process-death and retained legacy export must be exercised before migration defaults on.

## Proposal artifact validation

`openspec validate unify-assistant-experience --strict` passed after all eight capability deltas and the engineering checklist were created. `openspec status --change unify-assistant-experience` reported 4/4 planning artifacts complete. An additional local consistency check verified that declared capability paths exactly match the eight delta files, MODIFIED requirement names exist in current bases, every requirement has normative language and WHEN/THEN scenarios, local artifact links resolve and all 30 journeys are present. The checklist contains 56 unchecked implementation tasks; no feature acceptance above is marked complete.

During writing, unrelated rating/dock work was independently committed, moving HEAD to `42510d8cfb9aea18408a24e5fa6c4cc46163018e`. A final diff against the original audit commit confirmed no changes in the audited panel/Q&A/engine/RAG/session/sync boundaries; audit.md records the affected mobile geometry files. Final proposal validation is repeated against the resulting tree. Benchmark, native/provider and visual release gates remain future implementation work.

## Implementation session ledger (2026-10-17)

Executed commands and actual results from the implementation session that landed Phases 0–3 plus the implementable parts of Phases 4–6. Anything not listed here was not executed and is not claimed.

| Command | Result |
|---|---|
| `npx vitest run src/lib/ai src/components/assistant src/components/tabs src/features/documentQa src/commandPalette` | **142 files / 1402 tests passed** (includes all new suites: contracts 18, repository conformance 10, turn controller 9, legacy import 11, flag rollback 6, routing 30, turn policy 12, retrieval guards 15, attachments+ephemeral 17, reauthorize 11, source plan + transcript status 17, composer model 11, citations 24, citation parity 17, selection intent 10, palette handoff 6) |
| `npx tsc --noEmit` | clean |
| `cargo test --lib ai_conversation` (src-tauri) | **5 passed** (partition isolation, revision-guarded atomic append, superseded-attempt rejection, tombstone wins, digest-idempotent journal) |
| `cargo test --lib canonical_conversation` (src-tauri) | **3 passed** (migration 122 preserves legacy rows/FKs, rerun-safe, legacy-column read-back) |
| `npm run bench` / `npm run bench:check` | Bundle gate OK (entry 3 KB, 24.5 MB total); three new seeded benchmarks recorded in `scripts/perf-baselines.json`; two consecutive runs each surfaced one *different* untouched benchmark above tolerance (`daqe/project-snapshot-5000-items-no-snapshot`, then `ambient/jellyfish-draw-frame-1080p`) — each passed in the other run; recorded as environment noise on this loaded host, tolerances not loosened |
| `openspec validate unify-assistant-experience --strict` | passes |
| Legacy fixture corpus determinism | `manifest.json` SHA-256 identical across generator runs |

### Journey evidence available now (contract level)

Journeys with executable assertions landed this session: 1 (general question routing), 3/4 (selection capture + follow-up provenance), 5 (compare two documents), 6 (citation excursion/return), 10 (palette handoff, exactly-once), 19 (stop/retry/detached output), 20 (no-evidence honest state), 22 (non-destructive migration/import), 23 (citation parity), 26 (stale async completion), 27 (grounding across turns), 29 (learning action authority), 30 (no-streaming honest fallback). These are unit/adapter-level; the flag-on UI and device layers remain gated.

### Outstanding gates (not executed; not claimed)

- Physical Android/iPhone journeys 15, 18, 25 (gesture Back, IME/predictive cancellation, haptics, safe areas, TalkBack/VoiceOver) — requires a manual device session; a Pixel 9 Pro XL is available but manual interaction/haptics cannot be automated here.
- macOS/Windows hosts, iOS device (no hardware in this environment).
- Release-build measured timing budgets (baseline protocol in `baseline.md`; no numbers invented).
- Browser/visual fixture matrix in light/dark/high-contrast/reduced-motion/zoom.
- Encrypted conversation sync (tasks 7.1–7.6): server-first allowlist/registry, field-HLC merge, transactional outbox, encryption verification and two-client convergence — not implemented this session; `assistantConversationSync` stays off.
- Context-bearing streaming (task 6.2): not implemented; `assistantTurnStreaming` stays off.
- Full forbidden-network capture and end-to-end migration exercise on a real installation (8.3/8.4 partials).
