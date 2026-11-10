# Issue #6 Comprehensive Remediation, User-Controlled Queue Priority, AI Learning Reliability, and Incremental Reading Enhancements Master Plan

## 1. Executive Summary & Context

- **Repository**: Plethora (`https://github.com/melpomenex/Plethora`)
- **Target GitHub Issue**: [#6 — Comprehensive Issue #6 Remediation](https://github.com/melpomenex/Plethora/issues/6)
- **Baseline Git Commit SHA**: `f139b3bf2833c8ce39421083ea036b65a22b71c9`
- **Target Git Branch**: `main` (clean working tree confirmed; no feature branches, direct-to-main workflow per AGENTS.md)
- **Planning Mode**: Strict planning and specification authoring only. No feature implementation code, no mock shortcuts, no destructive database migrations.
- **Goal**: Deliver an authoritative, mathematically rigorous, zero-regression architectural blueprint divided into 8 independent, strictly valid OpenSpec proposals under `openspec/changes/`, coordinated by this master plan.

The Plethora application is an ambitious local-first, privacy-respecting knowledge management and incremental reading system built on Tauri (Rust), React 18, TypeScript, SQLite, and Tailwind CSS. GitHub Issue #6 exposed fundamental friction points where algorithmic queue transformations contradicted user intent, incremental reading document rotation was conflated with flashcard memory recall, AI learning tools failed on rigid argument validation and provider safety filters, card editing suffered focus and tag persistence bugs, and assistant/reader view continuity broke during routine navigation.

This master plan synthesizes all historical discussions, initial report screenshots (12 items), second-wave report images (17 items, 16 distinct), previously merged remediation commits, and the current code baseline to establish an airtight implementation sequence for subsequent engineering agents.

---

## 2. Screenshot Crosswalk & Visual Evidence Registry

Every screenshot provided in Issue #6 (initial post and Comment 2) has been cataloged, inspected, and traced to its exact source file, line number, and responsible change proposal.

| Evidence ID | Source File / Artifact | Description & Observed Failure | Exact Code Anchor | Primary Responsible OpenSpec Change |
|---|---|---|---|---|
| **IMG-01** | `orig_01.png` | Cloze card render in Review Mode with ambiguous ellipsis and unrevealed hint | `src/components/review/ReviewCardContent.tsx:142` | `fix-review-editing-and-session-consistency` |
| **IMG-02** | `orig_02.png` | Cloze raw text editing losing bracket boundaries in Review editor | `src/components/review/InlineCardEditor.tsx:88` | `fix-review-editing-and-session-consistency` |
| **IMG-03** | `orig_03.png` | Scroll Mode card preview missing image occlusion mask | `src/components/occlusion/OcclusionCardPreview.tsx:45` | `fix-review-editing-and-session-consistency` |
| **IMG-04** | `orig_04.png` | "Failed to save card" toast on editing card in Scroll Mode | `src/pages/QueueScrollPage.tsx:1842` | `fix-review-editing-and-session-consistency` |
| **IMG-05** | `orig_05.png` | Chat Assistant card generation SQLite foreign key error (787) | `src-tauri/src/database/cards.rs:412` | `harden-ai-learning-actions-and-card-quality` |
| **IMG-06** | `orig_06.png` | Playlist default queue interval slider resets on typing | `src/components/media/YouTubePlaylistManager.tsx:210` | `improve-youtube-ingestion-and-playlist-reliability` |
| **IMG-07** | `orig_07.png` | Video extract remains marked "New" after being opened/watched | `src-tauri/src/commands/queue.rs:612` | `improve-youtube-ingestion-and-playlist-reliability` |
| **IMG-08** | `orig_08.png` | Keyboard priority shortcut (1-5) does not persist across restarts | `src/components/review/QueuePriorityEditor.tsx:115` | `add-selectable-strict-manual-queue-ordering` |
| **IMG-09** | `orig_09.png` | Deleting card in review requires grading to advance queue | `src/stores/reviewStore.ts:420` | `fix-review-editing-and-session-consistency` |
| **IMG-10** | `orig_10.png` | Delete confirmation modal blocks queue session navigation | `src/components/review/ReviewSessionModal.tsx:310` | `fix-review-editing-and-session-consistency` |
| **IMG-11** | `orig_11.png` | Cloze card displays blank answer after reveal in Optimal Mode | `src/components/review/ReviewCard.tsx:290` | `fix-review-editing-and-session-consistency` |
| **IMG-12** | `orig_12.png` | Pinned section context ignored during Learning Agent prompt | `src/lib/ai/agent/tools/readonly.ts:310` | `harden-ai-learning-actions-and-card-quality` |
| **IMG-13** | `screenshot_01.png` / `screenshot_03.png` | EPUB / Reader table vertically crushed with single-character column wrapping | `src/components/viewer/EPUBViewer.tsx:1078` | `restore-assistant-and-reader-ux-continuity` |
| **IMG-14** | `screenshot_02.png` | Dark theme contrast failure (near-black text on dark background in Midnight theme) | `src/themes/builtin.ts:420` | `restore-assistant-and-reader-ux-continuity` |
| **IMG-15** | `screenshot_04.png` | Learning Agent aborts with `Error: topic parameter is required` | `src/lib/ai/agent/tools/readonly.ts:482` | `harden-ai-learning-actions-and-card-quality` |
| **IMG-16** | `screenshot_05.png` | Empty assistant chat bubble rendered on uncommitted stream / dropped chunks | `src/components/assistant/AssistantPanel.tsx:1420` | `restore-assistant-and-reader-ux-continuity` |
| **IMG-17** | `screenshot_06.png` | Tag edit popover reverts; card tags fail to persist in Deck Manager | `src/components/review/DeckManagerCardRow.tsx:265` | `fix-review-editing-and-session-consistency` |
| **IMG-18** | `screenshot_07.png` | Summary failure fallback toast without user-actionable retry or diagnostics | `src/features/summary/useDocumentSummary.ts:98` | `harden-ai-learning-actions-and-card-quality` |
| **IMG-19** | `screenshot_08.png` | Apple Intelligence / local model blocked on medical text (`safety_blocked`) | `src-tauri/native/apple-ai/FmBridgeCore.swift:184` | `harden-ai-learning-actions-and-card-quality` |
| **IMG-20** | `screenshot_09.png` | Low-quality Shingles QA non-sequitur & single QA misclassified as "Ordered steps" | `src/lib/ai/schemas/recallQuestion.ts:145` | `design-source-grounded-ai-curricula-and-assessments` |
| **IMG-21** | `screenshot_10.png` | Invalid cloze card generated missing `{{c1::...}}` delimiters & scroll jump button | `src/features/assistant/chatFlashcardArtifacts.ts:188` | `design-source-grounded-ai-curricula-and-assessments` |
| **IMG-22** | `screenshot_11.png` | Simple QA card flagged as complex, forcing unnecessary Flashcard Studio redirect | `src/components/review/studio/DraftCardList.tsx:120` | `design-source-grounded-ai-curricula-and-assessments` |
| **IMG-23** | `screenshot_12.png` | Typing in Answer textarea immediately steals focus to Question field after 1 char | `src/components/extracts/QACreatorPopup.tsx:23` | `fix-review-editing-and-session-consistency` |
| **IMG-24** | `screenshot_13.png` | Card created Nov 4, 9:01 AM displayed as "Overdue" at 9:08 AM on same day | `src/utils/reviewUx.ts:264` | `clarify-document-rotation-and-new-item-scheduling` |
| **IMG-25** | `screenshot_14.png` | Cards without tags have no "+" affordance in Deck Manager; cannot add first tag | `src/components/review/DeckManagerCardRow.tsx:264` | `fix-review-editing-and-session-consistency` |
| **IMG-26** | `screenshot_15.png` | Assistant conversation scroll position resets to bottom with flashing button | `src/components/assistant/useAssistantConversationScroll.ts:93` | `restore-assistant-and-reader-ux-continuity` |
| **IMG-27** | `screenshot_16.png` | Switching queue items resets Assistant scroll offset to top/bottom unexpectedly | `src/components/assistant/AssistantPanel.tsx:891` | `restore-assistant-and-reader-ux-continuity` |
| **IMG-28** | `screenshot_17.png` | Extract/notes rich text editor lacks indentation buttons; cloud fallback toast | `src/components/extracts/ExtractContentEditor.tsx:112` | `enhance-incremental-reading-extract-workflows` |

---

## 3. Original Issue #6 Regression Checklist (O01 to O21)

Every item from the original Issue #6 report has been evaluated against baseline commit `f139b3bf2833c8ce39421083ea036b65a22b71c9`. The table below establishes the explicit status and crosswalk to the 8 proposed OpenSpec changes.

| Item ID | Issue #6 Concern | Status in Baseline | Crosswalk Proposal | Key Required Remediation |
|---|---|---|---|---|
| **O01** | Memory Urgency 50/30/20 weighting formula | Partially Addressed | `add-selectable-strict-manual-queue-ordering` | Provide selectable strict manual priority mode alongside DAQE algorithmic weighting. In strict mode, user priority strictly governs queue ordering. |
| **O02** | Opposing overdue calculations (inner decay vs outer growth) | Addressed | `clarify-document-rotation-and-new-item-scheduling` | Verify bounded monotone overdue calculation; prevent minute-level overdue calculation on same-day creations. |
| **O03** | Fourteen-day overdue saturation ceiling | Addressed | `clarify-document-rotation-and-new-item-scheduling` | Retain bounded exponential tau-14 curve without abrupt hard ceiling; keep document rotation distinct from recall saturation. |
| **O04** | Manual priority counted twice in ranking | Addressed | `add-selectable-strict-manual-queue-ordering` | Ensure manual priority is factored once cleanly. In strict manual mode, bypass DAQE weighting entirely. |
| **O05** | FSRS document bonuses conflated with card recall | Partially Addressed | `clarify-document-rotation-and-new-item-scheduling` | Decouple document reading rotation from card memory recall. Reading a document does not record a recall rating (1-4). |
| **O06** | Cloze editing in Review mode loses raw delimiters | Addressed | `fix-review-editing-and-session-consistency` | Maintain raw bracket editing with syntax highlighting; preserve changes without altering scheduling state. |
| **O07** | Clozes missing / not appearing in review sessions | Addressed | `fix-review-editing-and-session-consistency` | Complete hydration of cloze items from SQLite; validate `{{c1::...}}` delimiters before queue insertion. |
| **O08** | Manual `{{c1::answer}}` syntax discrepancies | Addressed | `fix-review-editing-and-session-consistency` | Shared cloze parser across all review modes, question fallback, and raw deletion persistence. |
| **O09** | Editing card in Scroll Mode fails ("Failed to save card") | Regressed / Pending | `fix-review-editing-and-session-consistency` | Pass canonical entity ID and revision token in `QueueScrollPage.tsx`; prevent optimistic mutation rollback. |
| **O10** | Keyboard priority (1-5 / 0-100) does not persist | Partially Addressed | `add-selectable-strict-manual-queue-ordering` | Unify keyboard and pointer priority handlers; guarantee transactional SQLite write and reactive store refresh. |
| **O11** | Assistant Chat flashcard creation fails (SQLite FK 787) | Addressed | `harden-ai-learning-actions-and-card-quality` | Validate source document/extract foreign keys before executing batch card creation; provide clear user-facing error feedback. |
| **O12** | Playlist default queue interval resets on typing | Addressed | `improve-youtube-ingestion-and-playlist-reliability` | Introduce explicit draft state with save button and debounced commit; eliminate per-keystroke store overwrite. |
| **O13** | Playlist default priority scale ambiguity (1-5 vs 1-10) | Addressed | `improve-youtube-ingestion-and-playlist-reliability` | Normalize priority scale to 0-100 canonical percentage with unambiguous UI labels and tooltips. |
| **O14** | Video extract remains "New" after being opened | Addressed | `improve-youtube-ingestion-and-playlist-reliability` | Separate "Seen" from "Reviewed" states in SQLite schema and queue filters; track playback progress accurately. |
| **O15** | Cannot rate video extract independently of parent video | Addressed | `improve-youtube-ingestion-and-playlist-reliability` | Provide independent FSRS review history and rating buttons for video extracts; prevent parent history collision. |
| **O16** | Delete card in review requires grading to advance | Addressed | `fix-review-editing-and-session-consistency` | Deletion automatically transitions active session to next item; tombstone prevents stale refresh resurrection. |
| **O17** | Image occlusion cards fail in Scroll / Optimal modes | Addressed | `fix-review-editing-and-session-consistency` | Share occlusion canvas mask renderer and geometric calculation across all review modes. |
| **O18** | Document-linked pencil button unresponsive | Addressed | `fix-review-editing-and-session-consistency` | Replace browser prompt with native `InlineCardEditor` modal and focus restoration. |
| **O19** | Cloze cards display blank answer after reveal | Addressed | `fix-review-editing-and-session-consistency` | Normalize answer reveal state between Review, Scroll, and Optimal modes; fix empty string substitution. |
| **O20** | Assistant conversation scroll position jumps unexpectedly | Regressed / Pending | `restore-assistant-and-reader-ux-continuity` | Fix session/tab composite scroll keys; preserve scroll offset when streaming completes or queue item rotates. |
| **O21** | Learning Agent ignores pinned document section context | Addressed | `harden-ai-learning-actions-and-card-quality` | Enforce explicit section scoping in retrieval adapter; pass pinned passage text directly into prompt context. |

---

## 4. Architectural Diagnosis Across Subsystems

### Subsystem 1: Queue Prioritization, DAQE Algorithm, and Queue Selector
- **Current Architecture**: The DAQE (Dynamic Adaptive Queue Engine) in `src-tauri/src/algorithms/daqe/` calculates urgency as $M = 0.8T + 0.2P$, which is subsequently combined in `ranker.rs` with goal relevance, energy fit, interleaving diversity penalty, and friction penalty. In `queueScrollOrder.ts`, a "variety guard" defers items if more than 3 consecutive items share the same type.
- **Root Failure**: Users who explicitly prioritize their queue (e.g., setting a crucial textbook to 100% priority) find that Plethora frequently buries it beneath low-priority flashcards or newly imported articles due to high temporal urgency ($0.8T$) or interleaving penalties.
- **Remediation**: Implement a selectable queue ordering strategy:
  1. `Adaptive (DAQE)`: Full multi-term algorithmic optimization (existing).
  2. `Strict Manual Priority`: Canonical priority ($P$) strictly gates ordering. Items with higher $P$ are always presented before lower $P$, with due dates breaking ties, completely bypassing interleaving, friction, and energy penalties.
  3. `SRS Priority`: Classical Spaced Repetition ordering (due items sorted by manual priority, followed by new items, followed by future items).

### Subsystem 2: Document Scheduling, Spaced Repetition, and Date Presentation
- **Current Architecture**: Documents and cards share scheduling checks in `src/utils/reviewUx.ts` and `src-tauri/src/commands/queue.rs`.
- **Root Failure**:
  1. `getFsrsSchedulingInfo` evaluates `due < now` using millisecond precision. A card created at 9:01 AM is marked "Overdue" when inspected at 9:08 AM on the same day (`screenshot_13`).
  2. Incremental reading document rotation is conflated with flashcard memory recall. Reading an article is not a memory retrieval test and should not prompt recall ratings (Again/Hard/Good/Easy).
- **Remediation**:
  1. Due date evaluation must use calendar-day boundaries for items created today. An item is "Due Today", never "Overdue", on its creation calendar day.
  2. Establish distinct scheduling lifecycles for documents (reading intervals / rotation) vs learning items (FSRS memory retrievability).

### Subsystem 3: AI Learning Workflows, Tool Orchestration, and Card Generation Quality
- **Current Architecture**: The AI learning agent loop (`src/lib/ai/agent/loop.ts`) uses strict JSON tool validation via `readonly.ts` and `relationshipAdapter.ts`. Local on-device execution routes through `FmBridgeCore.swift` on macOS/iOS.
- **Root Failure**:
  1. Tool parameter rigidness: `get_related_material` rejects calls that do not provide exact parameter `topic` (`screenshot_04`). When LLMs emit `query`, `search`, or `context`, execution halts.
  2. Safety blocks: Medical terms (e.g., "shingles", "varicella") trigger Apple Intelligence on-device safety filters (`screenshot_08`), returning `safety_blocked` without fallback to alternative local/cloud models or user-friendly explanation.
  3. Empty responses: Stream disconnects or uncommitted state leave empty message bubbles (`screenshot_05`).
- **Remediation**:
  1. Add fuzzy parameter aliasing and normalization (`topic`, `query`, `search`, `concept`) across all tool definitions.
  2. Implement intelligent safety degradation: detect `safety_blocked`, explain the reason clearly, and offer one-click fallback to cloud or alternative local model.
  3. Ensure stream completion buffers commit only non-empty responses.

### Subsystem 4: Review Lifecycle, Card Editing, and Session Consistency
- **Current Architecture**: `QACreatorPopup.tsx`, `DeckManagerCardRow.tsx`, `CompactTagEditor.tsx`, and `QueueScrollPage.tsx`.
- **Root Failure**:
  1. Focus theft: `QACreatorPopup.tsx` includes `[question, answer]` in its `useEffect` dependency array, calling `questionRef.current?.focus()` on every keystroke in the Answer field (`screenshot_12`).
  2. Tag loss: `DeckManagerCardRow.tsx` omits `onTagsPersisted`, preventing row updates on tag edit. Furthermore, cards with zero tags omit `CompactTagEditor` entirely, preventing users from adding tags (`screenshot_14`).
  3. Scroll save error: `QueueScrollPage.tsx` card editor lacks entity ID mapping, triggering "Failed to save card" toast (`orig_04`).
- **Remediation**:
  1. Remove state dependencies from mount focus effect in `QACreatorPopup.tsx`.
  2. Pass `onTagsPersisted` in `DeckManagerCardRow.tsx` and render an explicit "+ Add Tag" button for cards without tags.
  3. Ensure full entity record hydration and revision matching in Scroll Mode card edits.

### Subsystem 5: Reader and Assistant UX, Presentation, and Continuous State
- **Current Architecture**: `EPUBViewer.tsx`, `useAssistantConversationScroll.ts`, and theme stylesheets.
- **Root Failure**:
  1. Table squishing: `EPUBViewer.tsx` applies `table { max-width: 100% !important; }` without horizontal overflow wrapping, crushing multi-column tables into vertical single-character text (`screenshot_01`).
  2. Dark theme illegibility: Midnight and dark palettes have hardcoded near-black text colors on dark container backgrounds (`screenshot_02`).
  3. Assistant scroll jumps: `useAssistantConversationScroll.ts` recomputes compound keys on tab/queue transitions, resetting user scroll position and flashing the "Latest message" button (`screenshot_15`, `screenshot_16`).
- **Remediation**:
  1. Wrap reader tables in responsive horizontal scrolling containers with `min-width: max-content`.
  2. Audit and fix CSS custom properties in `builtin.ts` to ensure WCAG AA contrast ratios across all themes.
  3. Preserve exact scroll offsets across queue item rotations and conversational streaming.

### Subsystem 6: Media Ingestion, Playlists, and YouTube Subsystems
- **Current Architecture**: `src-tauri/src/youtube.rs` and `YouTubePlaylistManager.tsx`.
- **Root Failure**:
  1. `yt-dlp` outdated warning (>90 days) and missing Deno/Node JS runtime cause caption extraction failures.
  2. Age-restricted and members-only videos fail because Plethora only checks browser cookies and lacks custom `cookies.txt` support.
  3. Playlist default queue interval and priority settings suffer from race conditions on typing.
- **Remediation**:
  1. Add runtime diagnostics for `yt-dlp` version and JS engine availability with update recommendations.
  2. Allow importing custom `cookies.txt` file in Settings for authenticated YouTube requests.
  3. Use draft/commit architecture for playlist settings.

### Subsystem 7: Incremental Reading, Extract Processing, and Knowledge Structuring
- **Current Architecture**: `ExtractContentEditor.tsx` and extract review APIs.
- **Root Failure**:
  1. Extract rich text editor lacks indentation controls (indent / outdent), making structured hierarchical note-taking impossible (`screenshot_17`).
  2. Extracts lack clear bidirectional navigation back to the exact passage in the parent document.
- **Remediation**:
  1. Add indent/outdent buttons and Tab/Shift-Tab keyboard navigation to the rich text editor.
  2. Add persistent "Return to Source" action with deep document paragraph anchoring.

### Subsystem 8: Source-Grounded Curricula, Flashcard Synthesis, and Assessment
- **Current Architecture**: `recallQuestion.ts`, `chatFlashcardArtifacts.ts`, and `DraftCardList.tsx`.
- **Root Failure**:
  1. AI card generation produces low-quality shingles QA pairs and misclassifies single Q&A items as "Ordered steps" (`screenshot_09`).
  2. Cloze generation produces cards missing `{{c1::...}}` syntax (`screenshot_10`).
  3. Simple Q&A cards are flagged as complex, forcing users into the Flashcard Studio (`screenshot_11`).
- **Remediation**:
  1. Implement strict syntactic and semantic schema validation before card proposals are presented.
  2. Ground all curricula generation in verified source spans with source text attribution.
  3. Standardize card complexity classification so simple QA cards remain inline.

---

## 5. Wave Implementation Sequencing & Dependency Graph

To ensure clean handoffs to implementation agents without merge conflicts or architectural deadlocks, the 8 changes are organized into 4 sequential execution waves.

```mermaid
flowchart TD
    subgraph Wave 1: Core Queue & Scheduling Contracts
        C1[Change 1: add-selectable-strict-manual-queue-ordering]
        C2[Change 2: clarify-document-rotation-and-new-item-scheduling]
    end

    subgraph Wave 2: Storage, Review Lifecycle & Editing Parity
        C4[Change 4: fix-review-editing-and-session-consistency]
        C6[Change 6: improve-youtube-ingestion-and-playlist-reliability]
    end

    subgraph Wave 3: Assistant, Reader & Extract UX Continuity
        C5[Change 5: restore-assistant-and-reader-ux-continuity]
        C7[Change 7: enhance-incremental-reading-extract-workflows]
    end

    subgraph Wave 4: AI Reliability, Curricula & Assessment
        C3[Change 3: harden-ai-learning-actions-and-card-quality]
        C8[Change 8: design-source-grounded-ai-curricula-and-assessments]
    end

    C1 --> C4
    C2 --> C4
    C4 --> C5
    C6 --> C7
    C5 --> C3
    C7 --> C8
    C3 --> C8
```

### Wave 1: Foundation (Queue & Scheduling Contracts)
- **Change 1**: `add-selectable-strict-manual-queue-ordering`
- **Change 2**: `clarify-document-rotation-and-new-item-scheduling`
- *Rationale*: Establishes authoritative queue mathematics, selectable ordering modes, and unambiguous date evaluation before modifying review UI or AI actions.

### Wave 2: Data Integrity & Review Consistency
- **Change 4**: `fix-review-editing-and-session-consistency`
- **Change 6**: `improve-youtube-ingestion-and-playlist-reliability`
- *Rationale*: Fixes focus theft, tag persistence, session mutation races, and media subscription storage so user edits reliably persist.

### Wave 3: Reader, Assistant & Incremental Workflows
- **Change 5**: `restore-assistant-and-reader-ux-continuity`
- **Change 7**: `enhance-incremental-reading-extract-workflows`
- *Rationale*: Solves visual rendering (tables, themes), assistant scroll preservation, extract note indentation, and source navigation.

### Wave 4: Advanced AI Hardening & Curricula Synthesis
- **Change 3**: `harden-ai-learning-actions-and-card-quality`
- **Change 8**: `design-source-grounded-ai-curricula-and-assessments`
- *Rationale*: With stable storage, review sessions, and UI continuity in place, harden AI agent tools, safety fallbacks, and curricula synthesis.

---

## 6. Settings Search Coverage & Diagnostic Surface

Per `AGENTS.md`, every new or renamed user-configurable control must be registered in the Settings Search Catalog and verified by automated coverage tests.

| Setting Identifier | Catalog Entry ID | Section Tab | Keywords / Search Terms | Coverage Test Target |
|---|---|---|---|---|
| `queueOrderingMode` | `setting-queue-ordering-mode` | `review` | "queue order", "manual priority", "adaptive daqe", "srs order", "strict" | `src/components/settings/search/__tests__/settingsSearchCatalog.test.ts` |
| `youtubeCookieFilePath` | `setting-youtube-cookie-file` | `media` | "youtube cookies", "age-restricted", "cookies.txt", "authentication" | `src/components/settings/search/__tests__/settingsSearchCatalog.test.ts` |
| `documentRotationInterval` | `setting-document-rotation-interval` | `review` | "document rotation", "incremental reading", "reading interval" | `src/components/settings/search/__tests__/settingsSearchCatalog.test.ts` |
| `aiSafetyFallbackProvider` | `setting-ai-safety-fallback` | `ai` | "safety blocked", "apple intelligence", "fallback model", "shingles" | `src/components/settings/search/__tests__/settingsSearchCatalog.test.ts` |

---

## 7. Migration Safety, Database Integrity & Invariants

All changes must maintain strict SQLite data integrity and adhere to zero-data-loss invariants:
1. **Zero Destructive Migrations**: No dropping columns, tables, or altering primary keys. Additive columns must have safe defaults (e.g., `ALTER TABLE queue_settings ADD COLUMN ordering_mode TEXT NOT NULL DEFAULT 'adaptive'`).
2. **Entity Identity Invariance**: IDs for documents, extracts, cards, and playlists are immutable UUIDs. Mutations must preserve foreign key integrity.
3. **No Unintentional Rescheduling**: Ranking passes and queue sorting must never mutate `due_date`, `stability`, `difficulty`, or FSRS state.
4. **Idempotent Mutations**: Card editing, tag updates, and video viewing state transitions must be idempotent and concurrency-safe.

---

## 8. Performance Benchmark Gate Protocol

Per `AGENTS.md`, performance regressions are strictly prevented via Vitest benchmark checks:
- Gate command: `npm run bench:check`
- Noise anchor: `src/anchor.bench.ts` (`anchorHz / benchHz` cost ratio).
- Baseline file: `scripts/perf-baselines.json`.
- Queue ranking with 4,000 items must remain under 12ms.
- Settings search index lookups must remain under 2ms.
- Cloze parsing for 500 items must remain under 5ms.

---

## 9. Master Document Tree

```
openspec/
├── planning/
│   └── issue-6-comprehensive-remediation-plan.md  <-- THIS MASTER COORDINATION PLAN
└── changes/
    ├── add-selectable-strict-manual-queue-ordering/
    │   ├── .openspec.yaml
    │   ├── proposal.md
    │   ├── design.md
    │   ├── tasks.md
    │   ├── specs/strict-manual-queue-ordering/spec.md
    │   ├── investigation.md
    │   ├── traceability.md
    │   └── verification.md
    ├── clarify-document-rotation-and-new-item-scheduling/
    │   ├── .openspec.yaml
    │   ├── proposal.md
    │   ├── design.md
    │   ├── tasks.md
    │   ├── specs/document-rotation-and-new-item-scheduling/spec.md
    │   ├── investigation.md
    │   ├── traceability.md
    │   └── verification.md
    ├── harden-ai-learning-actions-and-card-quality/
    │   ├── .openspec.yaml
    │   ├── proposal.md
    │   ├── design.md
    │   ├── tasks.md
    │   ├── specs/ai-learning-actions-and-card-quality/spec.md
    │   ├── investigation.md
    │   ├── traceability.md
    │   └── verification.md
    ├── fix-review-editing-and-session-consistency/
    │   ├── .openspec.yaml
    │   ├── proposal.md
    │   ├── design.md
    │   ├── tasks.md
    │   ├── specs/review-editing-and-session-consistency/spec.md
    │   ├── investigation.md
    │   ├── traceability.md
    │   └── verification.md
    ├── restore-assistant-and-reader-ux-continuity/
    │   ├── .openspec.yaml
    │   ├── proposal.md
    │   ├── design.md
    │   ├── tasks.md
    │   ├── specs/assistant-and-reader-ux-continuity/spec.md
    │   ├── investigation.md
    │   ├── traceability.md
    │   └── verification.md
    ├── improve-youtube-ingestion-and-playlist-reliability/
    │   ├── .openspec.yaml
    │   ├── proposal.md
    │   ├── design.md
    │   ├── tasks.md
    │   ├── specs/youtube-ingestion-and-playlist-reliability/spec.md
    │   ├── investigation.md
    │   ├── traceability.md
    │   └── verification.md
    ├── enhance-incremental-reading-extract-workflows/
    │   ├── .openspec.yaml
    │   ├── proposal.md
    │   ├── design.md
    │   ├── tasks.md
    │   ├── specs/incremental-reading-extract-workflows/spec.md
    │   ├── investigation.md
    │   ├── traceability.md
    │   └── verification.md
    └── design-source-grounded-ai-curricula-and-assessments/
        ├── .openspec.yaml
        ├── proposal.md
        ├── design.md
        ├── tasks.md
        ├── specs/source-grounded-ai-curricula-and-assessments/spec.md
        ├── investigation.md
        ├── traceability.md
        └── verification.md
```
