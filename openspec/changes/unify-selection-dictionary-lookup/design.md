# Design: unify-selection-dictionary-lookup

## Context

PLETHORA has two generations of text-selection UX. The current one (feature flag `features.selectionInteractionV2`, default `true`, `src/stores/settingsStore.ts:1146`) is the **selection-interaction controller** in `src/components/viewer/selectionInteraction/`:

- `machine.ts` — pure state machine: `IDLE → SELECTING → SETTLING → READY → ACTION_RUNNING → RESULT_VISIBLE`. The binding (`useSelectionInteraction.ts`) owns the settle debounce (`SELECTION_STABLE_MS = 500`, touch-defer loop bounded at 3000 ms). A selection only reaches READY after it has been stable with no touch down — i.e. **by construction, READY means the gesture is over**. Any live-selection change demotes READY back to SELECTING and hides the anchored UI.
- `adapters.ts` — `selectionchange`/touch/scroll/pointerup sourcing from the top document and from iframe content documents (EPUB via epub.js, HTML articles), with iframe→viewport geometry transforms.
- `geometry.ts` — range fingerprinting and `placeAnchoredBar` (above → below → nearest safe region, viewport-clamped).
- `SelectionActionBar.tsx` — portaled pill (Summarize · Explain · Ask · Extract · Copy · ⋯) shown in READY.
- `SelectionActionsSheet.tsx` (sibling) — the mobile sheet with AI actions; also used as the Queue's overflow menu.

Controller consumers today: `DocumentViewer.tsx:1162` (surfaces `epub`, `pdf-fixed`, `pdf-ocr-html`, `markdown`, `html`), `QueueScrollPage.tsx:1844` (surface `rss`), plus the orphaned `TranscriptPanel.tsx`.

Dictionary lookup today (`src/utils/dictionaryLookup.ts`, online-only: dictionaryapi.dev + Datamuse, no cache, phonetics/part-of-speech discarded) is wired in exactly two hand-rolled places:

1. `DocumentViewer.tsx` — context-menu "Dictionary" row (`buildContextMenuItems`, ~line 2388) + legacy floating drawer Lookup button (~8364–8421) + result card (~8423–8462) with a programmatic "Create vocabulary card" (`createLearningItem`, ~8444–8459).
2. `QueueScrollPage.tsx` — an RSS-only floating drawer replica + result popup (~4479–4544), gated `renderedItem?.type === "rss"`.

The Queue-vs-Documents inconsistency: Queue document items embed the base `DocumentViewer` (so they inherit dictionary), but Queue RSS items route overflow into `SelectionActionsSheet` (no dictionary row), and the only dictionary entry point is the type-gated drawer. Word extraction is the naive `text.trim().split(/\s+/)[0]` in three places; `"word,"` is queried with punctuation and 404s.

Supporting services that already exist and will be composed (not duplicated): `useTTS().speak(text)`; `createInstantExtract` (`useToastExtract.ts`) with selection-context provenance (`PdfSelectionContext`/`EpubSelectionContext`/`TextSelectionContext`); `createLearningItem` (`api/learning-items.ts`, programmatic precedent in the current dictionary card); `passageAI.explainPassage`/`answerPassage` and `ReadySelection.passage` (captured at settle); `useHapticFeedback`; `PresentationContext` (`useIsEink`, `reducedMotion`); React Query (`queryKeys` in `main.tsx`); queue mutation chokepoints in `queueStore.ts`.

## Goals / Non-Goals

**Goals:**

- Long-press + release on a single lexical word opens the Dictionary Peek automatically, on every supported reading surface, with identical semantics.
- One shared, Unicode-aware selection-intent resolver; no reader-local word-splitting heuristics.
- Selection expansion always wins over dictionary presentation; multi-word flows are byte-for-byte unchanged.
- Dictionary Peek composes existing TTS / extract / flashcard / AI-passage infrastructure.
- Dictionary works offline-for-repeats via caching, never depends on an LLM, and degrades with explicit failure UI.
- Queue reading state (item, scroll, scheduling) is provably untouched by dictionary interactions.
- Delete both hand-rolled dictionary UIs.

**Non-Goals:**

- Offline dictionary database / new provider (online provider stays; caching only).
- Reworking pdf.js text-layer selection or the in-app browser/webview bridge.
- Full controller adoption inside `XThreadViewer` (resolver + Peek reuse only).
- Transcript surfaces (`TranscriptSync`), dead `TranscriptPanel`.
- Analytics events (no in-app analytics pipeline exists).
- Vocabulary history UI / auto-creation of learning items from lookups.
- Any change to multi-word selection actions (`SelectionActionBar` chips, AI sheet flows).

## Decisions

### D1 — Intent resolution lives at the READY boundary of the existing controller

`resolveSelectionIntent(text, surface)` is a new pure, framework-free module at `src/components/viewer/selectionInteraction/intent.ts` (peer of `machine.ts`). The binding computes it once when constructing the `ReadySelection` for `settleConfirmed`/`commitReady` and stores it as a new `readySelection.intent` field. Hosts never re-derive intent.

- Why here: READY is the exact moment the gesture outcome is known (stability after release); the machine's READY→SELECTING demotion on any selection change is precisely the "cancel dictionary when handles move" semantics we need, already tested (`useSelectionInteraction.test.tsx`).
- Alternative rejected: a new global selection listener with its own long-press timers — recreates the drift this change fixes, and double-fires against the controller.
- Alternative rejected: copying DocumentViewer's dictionary into QueueScrollPage — explicitly forbidden by the proposal input; it would be a third copy.

`SelectionIntent` shape:

```ts
type SelectionIntent =
  | { kind: "word"; word: string; queryWord: string }   // single lexical word
  | { kind: "phrase" }                                   // multi-word (incl. sentence)
  | { kind: "url" }
  | { kind: "none" };                                    // empty/whitespace/unreadable
```

`word` is the selected token (punctuation-trimmed for display), `queryWord` the normalized dictionary query (lowercase, punctuation-stripped).

### D2 — Unicode-aware single-word detection with graceful fallback

Primary: `Intl.Segmenter` (word granularity, locale-agnostic `"en"` default) when available — segments `"word,"`, `can't`, `mother-in-law`, `résumé`, `日本語` correctly. Fallback (older Android WebViews / node test env): a Unicode-property regex covering Latin + combining marks + CJK + Hyphen/Apostrophe as intra-word. Rules:

1. Trim surrounding whitespace/punctuation (quotes, parens, commas, periods, etc.).
2. Segment the remainder; exactly one word-like segment ⇒ `word` intent; the segment itself is the display `word`.
3. Internal apostrophes/hyphens preserved (`can't`, `mother-in-law` stay one word).
4. CJK: segmenter may split `日本語` into multiple graphemes — special-case: a CJK-only run with no spaces/punctuation counts as one `word` (documented limitation: mixed CJK runs without spaces resolve as `phrase`; acceptable, matches user expectation of selecting whole runs).
5. URL pattern (existing link-detection regex or `URL`-prefix heuristic) ⇒ `url` intent.
6. Known limitation to document: languages without word boundaries (Japanese beyond single runs, Thai) lean on `Intl.Segmenter` dictionary segmentation; where the platform lacks it, fallback may over-split — behavior degrades to `phrase` (safe: normal selection UX), never to a wrong dictionary lookup.

### D3 — Trigger timing: no new timers; Peek is a READY-phase presentation

- **Touch (primary bug):** native long-press creates the selection; the controller settles it only after stability-with-no-touch-down. When `phase === "ready"` and `readySelection.intent.kind === "word"`, the host renders `DictionaryPeek` **instead of** `SelectionActionBar`. Release-based by construction; never fires at the long-press threshold.
- **Selection expansion:** any `selectionChanged` demotes READY → SELECTING; hosts close the Peek exactly as they hide the bar today (same phase-keyed rendering). Re-settling as a phrase shows the bar. No race: Peek rendering is keyed to phase + intent, never to live selection text.
- **Desktop:** auto-open **only** for double-click-produced single-word selections. `adapters.ts` gains a `dblclick` listener that flags the next settle as `origin: "double-click"` (stored on `ReadySelection.gestureOrigin: "touch" | "double-click" | "mouse" | "keyboard" | "commit"`). Mouse-dragged or keyboard single-word selections keep the bar (dictionary reachable via overflow row / context menu). This matches reading-app desktop conventions without hijacking every mouse selection.
- **Legacy path (`selectionInteractionV2 === false`):** no auto-peek; the context-menu Dictionary row keeps working (rewired through the resolver + Peek). The bug being fixed exists on the default V2 path.

### D4 — `DictionaryPeek` is a shared portaled component, phase-keyed like the bar

`src/components/viewer/selectionInteraction/DictionaryPeek.tsx`, mounted once per host next to `SelectionActionBar`. Placement: extend `geometry.ts` with `placePeekCard` — same above → below → nearest-safe-region algorithm as `placeAnchoredBar`, parameterized by the Peek's (larger) measured size with a viewport-height cap; mobile falls back to a bottom-anchored compact card when geometry is null (unreadable ranges, iframe edge cases). E-ink (`useIsEink()` / `reducedMotion`): transitions disabled, opaque surfaces, no full-screen scrim. Desktop: anchored popover. Dismissal: tap-outside, deliberate scroll (existing scroll gate closes READY), Escape (desktop), platform back/swipe. While open, the native selection is never cleared (touch policy already forbids `removeAllRanges` on Android).

The Peek renders in READY only and is **not** a machine phase; dictionary lookup is not an `actionInvoked` (it must not block subsequent selection changes the way AI actions do). Peek dismissal uses the same `controller.dismiss({ suppressCurrentText: true })` path as the bar.

### D5 — Dictionary service: cached, normalized, richer, typed failures

- `dictionaryLookup.ts` keeps its providers but is refactored into `lookupDictionaryEntry(queryWord)` returning `DictionaryEntry { word, phonetic?, audioUrl?, senses: [{ partOfSpeech?, definition, example? }], synonyms[] }` — phonetics/POS currently discarded by `fetchDefinitions` are preserved (dictionaryapi.dev supplies them).
- New `useDictionaryEntry(word)` hook on React Query; add `dictionary: (word: string) => ["dictionary", word]` to `queryKeys` (`main.tsx`). `staleTime: Infinity`, default `gcTime` — a looked-up word never refetches in-session; repeat lookups (incl. offline) resolve from cache.
- Failure taxonomy: `not-found` (provider 404 / empty) vs `unavailable` (network/provider error) vs `offline-uncached`. Each renders a distinct lightweight state with fallback actions (Explain via `answerPassage`, Flashcard manual create, Copy); no indefinite spinners, no silent failure.
- Provider remains online-only; first-time lookups require network — documented limitation.

### D6 — Secondary actions compose existing infrastructure only

| Action | Implementation | Notes |
| --- | --- | --- |
| Pronounce | `useTTS().speak(word)` | No separate speech path; provider/audio-URL from dictionaryapi.dev is displayed as phonetic text, playback stays TTS. |
| Extract | `createInstantExtract({ documentId, text: "word — definition", selectionContext: readySelection.selectionContext, note })` | Reuses toast-with-Edit flow; provenance via existing selection-context types (EPUB CFI, PDF canonical word-ids, text offsets). |
| Flashcard | `createLearningItem({ item_type: "flashcard", question: word, answer: senses joined, document_id, allow_duplicate: true, interaction_metadata: { origin: "dictionary-peek", sentence: passageSnippet } })` + toast "Flashcard created · Undo" | Programmatic precedent: current dictionary card (`DocumentViewer.tsx:8444`). Undo deletes the created item if a delete API exists — verify during implementation; otherwise toast without Undo. No mandatory editor. |
| Explain in context | `answerPassage("What does \"<word>\" mean in this passage?", passage)` where `passage = readySelection.passage` (already captured at settle, bounded) | Async, streamed into an "In this passage" section; cancellable; never blocks the definition; hidden when AI features are off. |
| More | Host-provided callback into the existing overflow surface (DocumentViewer: shared `ContextMenu`; Queue/other hosts: `SelectionActionsSheet`) | Single-word Peek replaces the bar, so `More` is the guaranteed path to Extract/Highlight/etc. on the word. |

`SelectionActionsSheet` gains a **Dictionary** row (non-AI action, host callback) — this simultaneously fixes "Queue overflow has no dictionary" and provides the keyboard/screen-reader path. The `ContextMenu` Dictionary row is retained and rewired: it resolves the word through the shared resolver and opens the Peek (instead of the legacy card).

### D7 — Host wiring and the deduplication plan

| Surface | Mechanism | Work |
| --- | --- | --- |
| Documents (`DocumentViewer`, all doc types) | Controller READY | Mount Peek; rewire ContextMenu row; delete legacy dictionary card/drawer button (~8364–8462); keep Extract drawer. |
| Queue Scroll Mode — document items | Embeds `DocumentViewer` | Inherits everything; no work beyond integration tests. |
| Queue Scroll Mode — RSS items (`QueueScrollPage`) | Controller READY (surface `rss`) | Mount Peek; delete RSS dictionary drawer + popup (~4479–4544); overflow already opens the sheet, which now has the Dictionary row. |
| PDF fixed (`PDFViewer` text layer) | Controller READY via validated commits | Verify touch settle path produces READY (desktop `commitLiveSelectionAsReady` exists); add integration test; no code expected beyond verification. |
| PDF reflow / OCR-HTML | Controller READY | Covered by DocumentViewer wiring; regression tests. |
| Article reader (`RSSScrollMode`) | No controller today | **Adopt `useSelectionInteraction`** (surface `"rss"`, `registerContentRoot`) — it's a reading surface in the required matrix; this replaces its bespoke `selectionchange` effect and floating Extract button with bar + sheet + Peek. Moderate but bounded. |
| X-thread viewer (`XThreadViewer`) | Own per-post selection adapter + toolbar | Resolver + Peek reuse only: on settled selection with word intent → Peek; toolbar unchanged (add nothing else). Full controller adoption out of scope. |

No `*DictionaryService` per reader anywhere; the dictionary surface count after this change is exactly one component + one service.

### D8 — Settings, feature flag, rollback

`features.dictionaryPeek: boolean` (settingsStore, default `true`) gates **auto-open** only. Explicit dictionary rows (ContextMenu, SelectionActionsSheet) are always available. Rollback of the interaction change = flag off; deletion of the legacy UIs is recovered by git revert if needed. i18n: new `viewer.dictionaryPeek*` keys in all six locales (`en`, `de`, `es`, `fr`, `ja`, `zh`).

### D9 — Vocabulary lookup history (minimal, non-polluting)

`src/stores/vocabularyHistoryStore.ts` — zustand `persist` (localStorage `plethora-vocabulary-history`), entries `{ word, lookupCount, firstSeenAt, lastSeenAt, lastDocumentId? }`, capped (LRU by `lastSeenAt`, 2000 entries). Recorded by `useDictionaryEntry` success. No UI, no learning-item creation, no queue interaction — this is the extension point a future Vocabulary mode reads. Documented non-goal: lookups never auto-enqueue anything.

### D10 — Queue-lifecycle safety is enforced by construction + tests

The Peek and its actions touch only: React Query cache, `createLearningItem` / `createInstantExtract` (explicit user actions), TTS, and the vocabulary store. They never call queueStore methods, `reloadForCurrentMode`, rating/auto-advance handlers, or scroll APIs. The overlay mounts in a portal and writes no reader scroll state. Integration tests snapshot queue store + scroll position across open/lookup/dismiss.

## Risks / Trade-offs

- [Single-word READY replaces the bar → users lose one-tap Extract on a single word] → Peek's own action row includes Extract and More; bar is unchanged for phrases.
- [pdf-fixed touch settle quirks (pdf.js text layer)] → Peek requires a validated READY commit exactly like the bar today; verify on device; if touch READY never fires on a given PDF path, behavior degrades to today's (no regression).
- [EPUB iframe geometry for the larger Peek card] → `placeAnchoredBar` already transforms iframe offsets; `placePeekCard` reuses it; bottom-anchored fallback when clamping fails.
- [`Intl.Segmenter` missing on some Android WebViews] → feature-detected regex fallback; degradation direction is `phrase` (safe), never a wrong lookup.
- [dictionaryapi.dev latency/rate limits] → immediate shell + cached results + typed failure states; no retry storms (React Query `retry: 1` default).
- [Android native-selection survival (the `removeAllRanges` wedge)] → Peek dismissal reuses the machine's suppression path; the never-clear-on-touch policy is preserved and tested.
- [Deleting the Queue RSS popup changes desktop behavior] → the shared Peek + sheet Dictionary row supersede it; covered by the reader-matrix tests.
- [Undo for flashcard creation depends on a delete API] → verified during implementation; fallback is a toast without Undo.

## Migration Plan

1. Land the resolver + service + Peek behind `features.dictionaryPeek` (flag on, additive).
2. Wire DocumentViewer + QueueScrollPage (bug fix visible), then RSSScrollMode controller adoption, then XThreadViewer reuse.
3. Rewire ContextMenu/sheet rows; delete both legacy dictionary UIs last, in the same commit as the reader-matrix test suite going green.
4. Rollback: flag off disables auto-open; git revert restores legacy UIs if required.

## Open Questions

- None blocking. Deferred (tracked as non-goals): offline dictionary provider, vocabulary-history UI, XThread full controller adoption, transcript surfaces.
