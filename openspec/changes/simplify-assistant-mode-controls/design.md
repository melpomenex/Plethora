## Context

See `proposal.md` for the reported UX problem. Verified source anchors:

- `AssistantPanel.tsx:560` holds the `chat | document | library` answer scope; `:567` holds the independent `chat | agent` execution mode. Both controls render together at `:3677–3733`.
- `AssistantScopeSelector.tsx` renders the same three hardcoded English labels as segments or a menu. `AskSheet.tsx:460` and `DocumentQATab.tsx:2107` also consume it.
- Learning Agent resolves its own scope from intent and explicit documents/selection/section (`AssistantPanel.tsx:1771`); it does not use the Chat answer scope. Its existing source controls render at `:4222`.
- Ordinary conversation scope is already restored from storage (`AssistantPanel.tsx:1108`). The palette agent handoff selects agent mode without sending (`:2019`); keep that path.
- Mobile host focus containment belongs to `mobile/MobileAssistantHost.tsx:61`. `md3/Menu.tsx` portals to the body, which needs care inside the expanded sheet. The recent model picker fix documents the bounded in-sheet precedent in `../fix-mobile-assistant-model-menu/design.md`.
- The pending `unify-assistant-experience` delta already moves these same three policies into secondary source controls. This change provides the narrow mode/source presentation fix without depending on that project's storage/sync work.

Line numbers describe the proposal-time working tree and are navigation aids, not an API contract. The supplied screenshot is the visual reference; preserve the current themed Material controls, reader layout, model picker, and density.

## Goals / Non-Goals

**Goals:** Make mode and answer source distinguishable by hierarchy, wording, and location; preserve independent state and safe submission; share source copy across current consumers; work in narrow sidebars and keyboard-open mobile sheets.

**Non-Goals:** Combine the execution engines, infer agent intent automatically, change grounding/retrieval/privacy, introduce Auto routing, rename serialized scope values, migrate conversations, add Settings controls, or redesign the reader and research workspace.

## Decisions

### 1. One primary mode choice, source policy beside the composer

Keep a single labelled `Assistant mode` group containing `Chat` and `Learning Agent` in the header. Retain full visible labels on phones, wrapping the model control onto a separate line when needed instead of shrinking targets or reducing Learning Agent to an unexplained icon.

In Chat, place a compact `Answer from: <selected value>` menu immediately above the input, beside existing context attachments. The selected value stays visible when the menu is closed. In Learning Agent, show the existing agent source block in that composer area and omit the Chat answer-source control. The model picker remains a separate model choice.

Illustrative placement, using existing styling:

```text
Assistant                 [model v]
             [Chat | Learning Agent]
...conversation...
[attached document / section chips]
Answer from: [General knowledge v]    (Chat)
[message input] [send]

...or in Learning Agent...
Sources: [existing source chips] [Attach]
[existing agent intent suggestions]
[message input] [send]
```

A single four-option `Chat / Document / Library / Learning Agent` selector was considered. It would flatten two independent concepts and hide how to return from agent mode to the previous strict source setting. Merely renaming the second Chat to “Standard” leaves the same competing selectors in the header. The chosen hierarchy preserves useful choices while making their purpose explicit.

### 2. Display source language without changing engine identifiers

Keep `AssistantScope` and engine metadata compatible. Give `AssistantScopeSelector` a localized presentation mapping through `useI18n`; do not change internal policy strings or stored messages to match visible copy.

| Existing value | Visible choice | Menu explanation |
| --- | --- | --- |
| `chat` | General knowledge | Uses general knowledge and attached context. |
| `document` | This document only | Answers only from the current document, selection, or transcript. |
| `library` | My library | Searches permitted library sources and cites the evidence. |

These choices do not enable web search. Existing source eligibility, selected library subsets, citations, missing-evidence outcomes, and optional context behavior remain authoritative. The document context chip identifies the concrete source; do not imply that General knowledge discards attachments. Without a usable current source, retain the explicit Document choice and its existing missing-source/recovery behavior rather than broadening silently.

Use the same mapping in AskSheet and Document Q&A, which remain Chat-style source-aware surfaces; do not add an agent switch where no agent presentation exists. Document Q&A's document picker still chooses the source subset, while `Answer from` chooses the grounding policy. Update nearby source-expansion actions such as “Switch to Chat to use general knowledge” to “Use general knowledge” so they no longer appear to change execution mode.

### 3. Keep mode transitions presentation-only until submission

Keep the two existing state values. Entering agent mode retains the last Chat source policy; returning to Chat restores its visible selection. Neither transition clears input, messages, section mentions, attached documents, or review artifacts. Preserve current agent scope-reset semantics on exit and existing cancellation/privacy revalidation; retaining Chat's scope does not authorize reusing an obsolete agent run. Do not unmount the whole composer or conversation to change controls.

Only explicit Chat submissions enter the current Chat turn path, using the selected answer scope. Agent submissions continue through the frozen-source adapter and proposal approval flow, never legacy tool parsing. Disable mode/source changes during generation as today. Preserve existing unavailable-agent handling and localized setup/retry guidance; an unavailable mode never starts a run or silently sends the prompt as ordinary Chat. Palette selection changes mode without submission, and strict document/library entry points remain visible through the source control. No new mode persistence or session schema is required.

### 4. Reuse menu primitives with platform-appropriate containment

Use the existing themed menu/button primitives for the desktop source menu. On mobile, offer the same choices in a bounded in-sheet list adjacent to the source trigger, following the existing model picker's in-flow/focus/dismissal pattern. Do not place a body-portal menu outside the host's focus boundary. Reuse existing overlay registration above host priority 60 so Back/Escape dismisses the source menu first and returns focus to its trigger. Only one composer/model/source popup is active at once; opening or closing it preserves the draft and attachments. Opening sources from the partial stop expands the sheet, following the model picker. While source options are open on mobile, hide the input bar without unmounting it; selection or dismissal restores the draft and source trigger. Bound the source list by the actual panel height using size containment, and allow the input to occupy its own row at narrow widths or large text.

Provide visible selected checkmarks and programmatic selected state, a localized trigger name including `Answer from` and the current value, keyboard navigation, and focus restoration. Targets are at least 40 CSS px and 48px on coarse pointers. Bound the list to available sheet space with internal scrolling; allow wrapping at 200% zoom and for translations. The sheet retains its existing drag, viewport, and keyboard ownership.

### 5. Validate the hierarchy and preserve the broader proposal's direction

Component/integration tests must prove exactly one mode group, no three-segment source control in the header, source control visible only for Chat, independent scope retention across mode transitions, draft retention, explicit-only submission, readiness feedback, and unchanged agent adapter dispatch. Shared-selector tests verify all choices map to existing identifiers and localized names, including AskSheet/Q&A consumers and scope-expansion recovery copy.

Extend the real-browser Assistant harness pattern under `src/visual/` to cover the composed header and composer, not just isolated buttons. Inspect desktop at a representative sidebar and its minimum supported width, mobile partial/expanded with keyboard open, a long translation, 200% zoom, and light/dark/legal-pad themes. Verify that source menus are fully reachable by keyboard and touch and close before their host.

Before archive, compare the first requirement against `unify-assistant-experience` and reconcile its pending delta to preserve this hierarchy and the latest grounding requirements. If that change lands first, rebase this delta on its current requirement text. This focused fix can implement and validate independently; it must not wait for the conversation/sync overhaul.

## Risks / Trade-offs

- General knowledge could sound like context is ignored → Keep attachment chips visible and explain optional context in the menu.
- Hiding the Chat source control during agent mode could suggest a lost preference → Restore its previous value on return and test Document → Agent → Chat and Library → Agent → Chat.
- The extra source-menu click makes strict-source switching less direct → Keep the trigger and current restriction always visible near submission; preserve explicit palette defaults.
- A menu moved near the phone keyboard can be clipped or escape focus containment → Use a bounded in-sheet list and verify both detents, keyboard, focus, and Back behavior in the composed harness.
- Shared selector copy could diverge from fallback actions or Q&A's source picker → Update their nearby labels together, with regression coverage for policy mapping and source-subset preservation.
- Overlapping unarchived scope deltas can overwrite requirements → Reconcile before archive and retain source grounding scenarios from the current canonical spec.

## Migration Plan

Ship as a frontend presentation change using existing persisted scope values and conversation state. Verify existing saved `chat`, `document`, and `library` conversations reopen with the corresponding new visible labels. Run targeted tests, TypeScript/lint checks for touched code, browser checks, and `npm run bench:check` during implementation; investigate regressions instead of relaxing baselines for a presentation-only change. Rollback is reverting the UI/copy change; no data conversion is needed.
