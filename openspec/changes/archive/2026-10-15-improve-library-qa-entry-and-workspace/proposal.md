## Why

The command hub's “Ask about your library” action currently opens a selection-actions sheet instead of Document Q&A, separating the entry point from the app's saved research conversations. Document Q&A also makes users learn mention syntax before asking, hides source scope in a header dropdown, and gives its empty state more prominence than the question itself.

## What Changes

- Route the quick action and library-question suggestions into the existing **Document Q&A** tab, reusing that tab across panes and closing the command palette. Opening never submits a question or starts AI work.
- Put **asking immediately, with clear source selection and cited answers** first. Introduce a composer-led start state: “What would you like to understand?”, a visible **Whole library / Choose document** source control, and a clearly labeled **Ask** button.
- Offer three useful starting points—**Find connections**, **Compare viewpoints**, and **Summarize a document**—that prepare editable questions using real library context. Keep mentions and section targeting as optional expert controls.
- Make the transition from question to evidence legible: retain the question and its scope, show honest processing/error states, and reuse existing navigable source citations with readable excerpts and copy-with-sources behavior.
- Preserve saved conversations and unsent drafts when entering from the palette. Make **New conversation** the primary history action; move destructive clearing behind an overflow menu. Keep history and source details reachable on narrow screens.
- Keep the entry useful for an empty library or missing provider: open the workspace with import/setup guidance and preserve the draft for recovery.

## Capabilities

### New Capabilities

- `document-qa-workspace`: The command-hub-to-Document-Q&A entry contract and the composer-first workspace, including explicit source scope, editable starter questions, safe conversation handoff, cited answers, recovery states, and responsive/keyboard behavior.

### Modified Capabilities

None. The canonical specification inventory has no Document Q&A or command-hub capability to amend. This change builds on the implemented, unarchived `revamp-command-palette`, `add-document-qa-sessions`, and `link-doc-qa-sources-to-locations` changes; it does not recreate their infrastructure.

## Impact

- Palette dispatch and handoff: `src/components/search/CommandCenter.tsx`, `src/commandPalette/libraryAskHandoff.ts`, `src/components/search/palette/LibraryAskHost.tsx`, and quick-action availability/copy.
- Destination and state: `src/components/layout/MainLayout.tsx`, the existing `doc-qa` tab reuse path, `src/components/tabs/DocumentQATab.tsx`, `documentQaSessions.ts`, and `src/stores/documentQAStore.ts` as needed for compatible draft/evidence metadata.
- Grounding: reuse `src/lib/ai/tasks/definitions/libraryTask.ts`, existing retrieval filters, provider/privacy checks, and `DocumentQASources.tsx`; no new backend, provider, or indexing system.
- UI: reuse the application's themed Material components and typography, with localized strings and focused navigation, session, citation, and accessibility regression coverage. Preserve reader selection Ask and product-help entry points.
