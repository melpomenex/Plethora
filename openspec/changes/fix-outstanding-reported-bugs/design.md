## Context

Five reported bugs survive the recent queue fixes. An audit against the code — and, for two items, against the live database (370 documents, 5 extracts, 1097 learning items) — showed they are not a single defect class:

| Report | What the audit found |
| --- | --- |
| Can't open extracts from the queue | `QueueTab.handleOpenDocument` opens the parent document with `focusedExtractId`; `ExtractsList` scrolls to and ring-highlights the card. It works — there is simply no surface that treats an extract as the thing being read. **Missing feature, not a broken one.** |
| Manual occlusion doesn't work | No region-drawing editor exists anywhere. Only the AI path (`IMAGE_OCCLUSION_SYSTEM_PROMPT`, `ImageSaveOverlay`'s `create-image-occlusion` event) is implemented. **Never built.** |
| `#` mentions non-functional | `buildDocumentSections` derives sections from Markdown headings, merged with a PDF/EPUB outline when present. A plain imported article has neither, so `flat` is empty and the popup renders nothing. **Degrades to empty rather than failing loudly.** |
| In-app browser non-functional | 1576 lines, fully wired. Two rendering paths: cross-origin `iframe` on web (blocked by `X-Frame-Options`/CSP on most sites, tracked as `iframeStatus: "blocked"`) and a Tauri native webview whose position is maintained by hand via `updateWebviewBounds`. **Cause not yet isolated.** |
| Imported article becomes a whole-article extract | Not reproducible: every extract in the live DB is under 2 KB, and no import path was found that creates an extract. **Needs a repro before a fix.** |

The startup/runtime slowness report is excluded — the plausible causes were addressed by `b036c854` (Yjs realtime sync disabled), `70a8a38a` (y-indexeddb cold-start RAM spike), `2b468df7` (bounded startup loading), `c7d733a9` (library virtualization) and `753fc2d3` (queue virtualization repair).

Constraints that shape the work: tabs stay mounted when inactive and are hidden with `display: none` (`TabContent`), which is what makes native-webview visibility a real concern; user-facing strings must exist in all six locales, enforced by a placeholder-parity test; and the extract/learning-item storage shapes are already established and should not be redesigned here.

## Goals / Non-Goals

**Goals:**

- Make an extract a readable item, without breaking the existing focus-in-document navigation.
- Ship hand-authored occlusion regions, and let AI-proposed regions be corrected in the same editor.
- Guarantee `#` mentions are useful for any document with text, and let the user reference a selection.
- Either make the in-app browser render or make it state plainly why it cannot.
- Settle the whole-article-extract report with evidence either way.

**Non-Goals:**

- Startup and runtime performance (excluded by request).
- Redesigning extract or learning-item storage, or adding a migration for either.
- Improving AI occlusion *model* quality; this change makes its output correctable, not smarter.
- Building a general-purpose browser (tabs within tabs, profiles, downloads, extensions).
- Retroactively rewriting any existing oversized extract.

## Decisions

**Extract reading is a new tab type, not a mode of the document viewer.**
The viewer is ~7000 lines and already carries `focusedExtractId`. Threading a second "subject" through it would couple extract reading to document rendering, which is exactly the coupling being complained about. A small tab type registered in `TabRegistry` keeps the extract as the subject and lets `QueueTab` route to it by `itemType`. Alternative considered: a `viewMode: "extract"` inside the viewer — rejected because it inherits the viewer's whole load path for a payload that is already in the queue item.

**The queue's routing decision moves into `queueActions.ts`.**
`getQueuePrimaryAction` already maps `itemType` to an action and is unit-tested. Adding `open-extract` there keeps desktop (`ReviewQueueView`), mobile (`MobileQueueView`) and the action sheet consistent from one place, rather than three call sites branching on type.

**One occlusion editor, two entry points.**
Manual authoring and AI correction are the same interaction over the same region model. Building the editor as a controlled component over `{ regions, imageAssetId }` lets `ImageSaveOverlay` open it empty and `FlashcardStudioModal` open it pre-filled from the AI proposal. Alternative considered: a separate read-only AI review step — rejected as two UIs for one job.

**Mentions gain a heuristic segmenter, used only as a fallback.**
`buildDocumentSections` keeps outline-and-heading behaviour as the primary path. When it yields fewer than two nodes for a document with text, fall back to fixed-size segments on paragraph boundaries, labelled by their opening words. This is confined to `sectionIndex.ts`, so the assistant, `DocumentQATab` and Flashcard Studio all inherit it and stay consistent — which the spec requires.

**The selection is a mention entry, not a separate control.**
The user's phrasing is "asking about a certain portion of text". Presenting the live selection as the first entry in the existing `#` popup reuses `SectionMentionCard`, the context-budget logic and the truncation path, rather than adding a parallel attach mechanism.

**Browser: diagnose before fixing.**
The two paths fail differently and the report does not say which is in play. Task 4.1 is instrumentation: log `iframeStatus`, `webviewError`, and the computed bounds against the container rect. Committing to a fix first risks a repeat of the queue investigation, where the first plausible cause was not the real one. Whatever the cause, the blocked/failed states are worth building regardless, because a blank pane is unacceptable either way.

**Whole-article extracts are reported, not auto-corrected.**
An extract carries its own scheduling history. Silently deleting or rewriting one destroys review data. Surface them and let the user decide.

## Risks / Trade-offs

- **A new tab type adds a session-restore surface** → register it in `TabRegistry` alongside the others and confirm it survives a restore; extract id in tab data is enough to rehydrate.
- **The heuristic segmenter could produce noisy entries on outline-rich documents** → only engage it when the primary path yields fewer than two nodes, and cover both branches with tests in `sectionIndex`.
- **Native webview bounds are notoriously fragile across resize, split panes and tab hiding** → the spec pins the three events explicitly; if the native path proves unreliable, falling back to the iframe path with an explicit blocked state is an acceptable outcome for this change.
- **The whole-article-extract bug may be unreproducible and stay open** → the regression test is the deliverable in that case; closing it with evidence is a legitimate result and is written into the tasks.
- **Occlusion regions authored manually must render identically in review** → reuse the existing `image-occlusion` shape consumed by `ReviewCard` rather than introducing a parallel representation.
- **Five loosely related areas in one change** → tasks are grouped per area and are independently landable; nothing here forces a single big merge.

## Migration Plan

No database migration. New occlusion regions reuse the existing `image-occlusion` learning-item shape, so cards authored manually and cards authored by the AI are indistinguishable to the review path. The new extract-reader tab type is additive; existing sessions restore unchanged because no existing tab data is reinterpreted.

Rollback is per-area: each group of tasks touches a distinct surface and can be reverted without affecting the others.

## Open Questions

- Should the extract reader offer inline editing of the extract text, or stay read-only plus rating? Read-only is assumed until the queue's rating flow is settled.
- Does the in-app browser need to work on the web build at all, or is Tauri-only acceptable? This decides whether the iframe path is worth repairing or should simply always show the blocked state with an "open externally" action.
- For the selection mention, should selecting from the source document while the assistant is docked update the entry live, or snapshot at the moment `#` is typed? Snapshot is assumed, as it is simpler to reason about.
