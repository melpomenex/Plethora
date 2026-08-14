## Context

Everything this change needs already exists in the codebase; almost nothing is wired together.

- **Selection detection (mobile)**: `DocumentViewer.tsx:3376-3469` listens to `selectionchange`/`touchend`, filters to `[data-document-content]`/`.prose`/`.textLayer`, and stores `{ text, position, showButton }` in `mobileSelection`. Its only consumer is the floating lightbulb at `DocumentViewer.tsx:7386`, which calls `handleMobileExtract` (`:3997`).
- **Bottom sheet**: `src/components/common/MobileContextMenuSheet.tsx` already does scrim, slide-up, body-scroll lock, Escape, safe-area, and has a `variant="content"` mode for arbitrary UI (used by `StudioSheets.tsx`).
- **AI routing**: `src/lib/ai/provider.ts` exposes `resolveAiPath`, `runAiAction(onDevice, cloud, label, requirement)` with automatic cloud fallback + toast, and `hasCloudProvider`. `useAiAvailability(requirement)` is the React gate.
- **Task adapters**: `src/lib/ai/passageAI.ts` has `explainPassage` (presets simple/detailed/study-note) and `answerPassage` (with grounding check via `checkAnswerGrounding`). Both are tested and have **zero UI callers**. Their non-on-device branch calls `generateNativePrompt` — the Android bridge — so the "cloud" branch is broken.
- **Cloud commands**: `src/api/ai.ts` wraps the Tauri commands `answer_question`, `summarize_content`, `simplify_content`, `extract_key_points` (`src-tauri/src/commands/ai.rs:366-478`), which use the user's configured provider.

So the work is: a sheet UI, five task adapters that pick on-device vs. those commands, and replacing one floating button.

## Goals / Non-Goals

**Goals:**
- Selection on mobile → bottom sheet with extract + AI actions, using the existing sheet component.
- One routing decision point (`runAiAction`) so on-device and cloud behave identically to the caller.
- Results are reusable: copy, retry, create extract from the result.
- Works on the reading surfaces that already have selections (documents, transcripts, queue articles).
- Hidden entirely when no AI path exists.

**Non-Goals:**
- Desktop selection UX — `SelectionPopup` stays as it is.
- New AI providers, new Rust commands, new model management UI.
- Conversation/threading — the assistant panel (`src/features/assistant`) owns multi-turn chat; the sheet is single-shot with one optional question.
- Persisting AI results as first-class objects; they persist only if the user creates an extract.

## Decisions

### 1. Reuse `MobileContextMenuSheet` (`variant="content"`) rather than a new sheet

It already solves the tap-away, scroll-lock and safe-area problems the comment block at its top describes, and it is the sheet the user already sees for card/deck menus. Alternative — a bespoke selection sheet — would duplicate that and drift from the native Android idiom already established.

### 2. One new component, `SelectionActionsSheet`, owning both list and result state

Props: `{ open, text, aiContextLabel?, onClose, onCreateExtract(text), onCopy? }`. Internal state is a small union: `{ mode: "menu" } | { mode: "asking" } | { mode: "running" | "done" | "error", action, output, error }`. Keeping the result inside the sheet avoids threading five pieces of AI state through `DocumentViewer`, which is already ~7.5k lines. Callers pass only the selection and an extract callback, which is what makes reuse on transcripts/queue cheap.

Alternative considered: rendering results in the existing assistant panel. Rejected — it pulls focus out of the reader, and the panel's chat model is heavier than "explain this sentence".

### 2b. Where the rows live differs by viewer (found during device testing)

The context above missed that non-PDF viewers already answer a long-press with
`ContextMenu`, which *itself* renders as a `MobileContextMenuSheet` (extract,
add note, highlight, copy, dictionary, flashcard). Mounting a second sheet
stacked two bottom sheets on one selection. So:

- **Non-PDF (EPUB, HTML, markdown):** the five AI actions are appended to that
  existing menu. `SelectionActionsSheet` takes an `initialAction` prop and
  renders only the result view.
- **PDF:** no context menu exists there (it had the floating lightbulb), so the
  sheet is the whole menu, as originally designed.
- **Queue/RSS and transcripts:** no context menu either, so the sheet is the
  whole menu.

Also: EPUB and HTML render inside an **iframe**, so the top-level
`window.getSelection()` that feeds `mobileSelection` is always empty for them.
Anything gated on `mobileSelection.showButton` is PDF/markdown-only; the shared
gate is `activeExtractSelection`, which every viewer feeds.

### 3. Action set

| Row | Adapter | On-device | Cloud |
| --- | --- | --- | --- |
| Explain | `explainPassage(text, { preset: "simple" })` | `generateStreamingPrompt` | `answerQuestion(prompt, text)` |
| Summarize | `summarizePassage` | `summarize()` (`onDeviceAI.ts:537`, native summarizer) | `summarizeContent(text, maxWords)` |
| Simplify | `simplifyPassage` | prompt | `simplifyContent(text, level)` |
| Key terms | `keyTermsPassage` | prompt | `extractKeyPoints(text, n)` |
| Ask a question | `answerPassage(question, text)` | `generateStreamingPrompt` | `answerQuestion(question, text)` |

Explain/Ask are the two that justify the feature; Summarize/Simplify/Key terms are each a one-line adapter over an existing command, so they cost close to nothing. Anything more (translate, flashcards from selection) waits for demand — flashcards in particular already have their own path via extracts.

### 4. Fix the cloud branch in `passageAI` instead of adding a parallel module

The existing `if (path === "ondevice") … else generateNativePrompt(…)` shape is wrong: the else branch calls the Android bridge. Rewrite each adapter as `runAiAction({ onDevice, cloud }, label, requirement)` so the fallback toast and cancellation semantics come for free and every new adapter follows the same shape. `answerPassage` keeps its grounding check on both paths.

### 5. Streaming only on-device; cloud renders on completion

`generateStreamingPrompt` gives incremental chunks; the Tauri cloud commands return a whole string. The sheet renders `output` as it grows either way, so the difference is invisible in the component — no streaming plumbing added to Rust for this change.

### 6. Cancellation

The sheet owns an `AbortController`; closing it or tapping Cancel aborts. `runAiAction` already re-throws `cancelled` without falling back to cloud, so an aborted on-device request must not trigger a cloud call. Cloud commands cannot be aborted mid-flight — the sheet drops the result instead.

### 7. Input budget

`chunkTextByTokens`/`resolveTokenBudget` already exist. Selections are usually a sentence to a paragraph, so the sheet truncates to the budget and shows "shortened to fit" rather than chunking and merging — chunk-merge quality work is not worth it for a selection-sized input.

### 8. Rollout across surfaces

`DocumentViewer` first (it owns `mobileSelection` and the extract path). Transcripts (`TranscriptPanel`) and queue articles (`QueueScrollPage`, which already tracks `activeRssSelection`) mount the same component with their own `onCreateExtract`. No shared selection store — each surface already tracks its own selection, and a store would be a third source of truth.

## Risks / Trade-offs

- **On-device model quality on a short selection** → Explain/Simplify on a one-line selection can be thin. Mitigation: pass surrounding context where the surface already has it (PDF page text / article body) as the passage, with the selection marked; keep the selection as the passage where it does not.
- **The lightbulb disappears** → users habituated to the one-tap extract now need two taps. Mitigation: "Create extract" is the first row, and the sheet opens directly under the thumb; a long-press on the selection handle is not intercepted.
- **Sheet fights the OS selection toolbar on Android** → both can be on screen. Mitigation: sheet is bottom-anchored, OS toolbar is anchored to the selection; verify on a device and, if it overlaps, clear the DOM selection once the sheet opens (the text is already captured).
- **`runAiAction` toast on every fallback** → repeated fallbacks are noisy. Mitigation: acceptable at one toast per action; revisit only if users hit it repeatedly.
- **Grounding check rejects reasonable answers** → `checkAnswerGrounding` is heuristic. Mitigation: show the answer with a "may not be supported by the passage" note rather than suppressing it.

## Migration Plan

Additive. No schema, no settings migration; the feature reads `settings.ai.preferOnDevice` and the provider registry that already exist. Rollback is deleting the sheet component and restoring the floating button block in `DocumentViewer`.

## Open Questions

- Should the passage sent to the model include surrounding context by default, or only the exact selection? (Leaning: surrounding context where cheaply available, selection marked inline.)
- Should results be reachable again after the sheet closes (e.g. a "last AI result" entry), or is single-shot enough for v1? (Leaning: single-shot.)
