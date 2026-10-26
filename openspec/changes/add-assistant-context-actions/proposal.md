## Why

Reading on a phone often means having a useful question but not wanting to type it. The Assistant already knows the reader's source and selection, yet its mobile composer hides actions in a general command menu and its desktop shortcuts expose slash commands rather than the common reading tasks people want to perform.

## What Changes

- Add a shared, context-aware action catalog inside the mobile Assistant and desktop document-side panel. Promote **Summarize**, **Explain**, and **Quiz me**, each with an icon and a visible label, beside **More**.
- Show the actual target near the actions: selected text, attached sections, the current passage/page or transcript segment, the whole document when that is the available source, or the conversation. Distinguish this target from the existing Chat/Document/Library answer scope.
- Make ordinary actions run with one tap, without opening the keyboard or replacing an unsent draft. Keep responses, citations, stop/retry, provider selection, and source provenance in the existing conversation.
- Group secondary actions under Understand, Think, and Study: key points, key terms, examples, argument analysis, translation with a language picker, document outline, and flashcards through the existing formulation/card pipeline. Quiz me asks one question at a time and offers **Show answer**, **Hint**, and **Next question** controls.
- Keep mobile reading space: one compact action row while idle, a bounded two-column action menu on demand, and collapse the row during typing, dictation, generation, or insufficient available height. Preserve access through the existing add menu. Desktop uses the same catalog and collapses excess actions as its panel narrows.
- Explicitly revise the mobile composer requirements that currently prohibit quick-action rows. Keep slash commands and all existing composer capabilities reachable; preserve the selection Ask sheet and Learning Agent workflow.
- Add a reviewable visual concept and a concrete action/target matrix to the design artifacts.

## Capabilities

### New Capabilities

- `assistant-context-actions`: Shared action discovery, supported action contracts, explicit context targets, one-tap execution, conversational quiz controls, and safe action lifecycle across mobile and desktop.

### Modified Capabilities

- `mobile-assistant-composer`: Permit a single conditional contextual-action row, integrate the complete action catalog into the add menu, and preserve the conversation-first height budget and existing input capabilities.

## Impact

- Frontend: `src/components/assistant/AssistantPanel.tsx`, a small shared action catalog/resolver and action components, `mobile/MobileComposerMenu.tsx`, mobile sheet geometry, and the supported locale catalogs (de, en, es, fr, ja, zh).
- Existing integrations: `submitAssistantRequest`, selection snapshots and section mentions, `ResolvedAssistantContext` coverage, document intent/grounding, shared provider/consent routing, `/20rules`, card tools, and `ChatFlashcardCollection`. Action intent and captured targets need typed request metadata so localized labels and ambient selection cannot change what a button does.
- Verification: catalog and target-resolution tests, submission/draft/concurrency integration tests, quiz/flashcard coverage, mobile/desktop visual checks, and the repository's benchmark/bundle gate.
- No new provider, dependency, background indexing, Settings control, or automatic document mutation is proposed. Source actions in Library scope remain source-targeted; cross-library comparison, automatic personalization, and user-defined shortcuts are follow-up work.
