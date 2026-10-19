## Context

In `src/components/tabs/DocumentQATab.tsx`, the workspace layout consists of:
- `document-qa-workspace`: a horizontal flex container (`flex h-full min-h-0 bg-surface text-on-surface`).
- `DocumentQaHistory`: an `<aside>` collapsible session history drawer (hidden when collapsed).
- A main flex column (`flex min-h-0 min-w-0 flex-1 flex-col`) holding the header, scrollable message list, and composer footer.

Commit `e1076add` inserted an `<AssistantScopeSelector>` wrapper div (`<div className="flex flex-wrap items-center gap-2 px-3 py-2">`) as the first child of the root container. Because the root container is a flex row, this div creates a column on the middle-left of the entire screen directly adjacent to the global app toolbar rail. This visually distorts the sidebar, making it appear to bulge or extend horizontally.

## Goals / Non-Goals

**Goals:**
- Eliminate the extraneous column from the root of `DocumentQATab.tsx` so the workspace sits flush against the toolbar rail and history drawer.
- Preserve all existing scope behavior: Document Q&A inherently maps `selectedDocumentId` to `"document"` scope and no document (`""`) to `"library"` scope via `DocumentQaSourcePicker`.
- Keep session state and persistence intact (`snapshot: { scope: assistantScope, ... }`).
- Retain the `suggestSwitchToChat` recovery prompt contextually in the composer/response area if evidence is not found.
- Clean up tests in `DocumentQATab.test.tsx` that referenced the misplaced scope selector buttons.

**Non-Goals:**
- Changing `AssistantScopeSelector` in `AssistantPanel.tsx` or `AskSheet.tsx` (where it is correctly integrated into headers).
- Redesigning the `DocumentQaSourcePicker` dialog.

## Decisions

### 1. Remove the standalone root `<AssistantScopeSelector>` div
- **Decision**: Completely remove lines 1724-1727 in `src/components/tabs/DocumentQATab.tsx` (`<div className="flex flex-wrap items-center gap-2 px-3 py-2">...</div>`).
- **Rationale**: In `DocumentQATab`, source and scope selection is already handled by `DocumentQaSourcePicker` at the composer (`Sources: [Document Title / Whole Library]`). Placing a 3-way segmented control (`Chat | Document | Library`) as a root flex child was an architectural and visual error.
- **Alternatives considered**:
  - *Move it into the Document Q&A header*: Redundant with the composer's Source Picker button and adds unnecessary header clutter.
  - *Keep it in a vertical orientation inside the history rail*: Unnecessary complexity when source selection is already unified in the bottom composer.

### 2. Contextual `suggestSwitchToChat` placement
- **Decision**: If `suggestSwitchToChat` is true and `assistantScope !== "chat"`, render the "Switch to Chat" suggestion button within the composer's source / evidence region (e.g. adjacent to `effectiveScopeLabel`), where users are already looking when deciding on their query context.
- **Rationale**: Keeps the recovery path easily discoverable without creating orphan layout columns.

### 3. Clean up `DocumentQATab.test.tsx` assertions
- **Decision**: In `DocumentQATab.test.tsx`, remove `fireEvent.click(screen.getByRole("button", { name: "Library" }));` from the two tests where it was added in `e1076add`.
- **Rationale**: Default `assistantScope` is already `"library"` on fresh sessions with no document selected; clicking the nonexistent button would fail.

## Risks / Trade-offs

- **[Risk]** Existing tests fail if they expect `<AssistantScopeSelector>` in `DocumentQATab`.
  - **Mitigation**: Verified test suite; only two tests in `DocumentQATab.test.tsx` targeted the "Library" button, and both already default to library scope. All 28 tests in `DocumentQATab.test.tsx` will run and pass cleanly.
- **[Risk]** Users wanting general "Chat" mode in Document Q&A without selecting any document.
  - **Mitigation**: Users can select "Switch to Chat" when prompted or query with general knowledge when whole library is selected. Full general chat remains natively available via the Assistant Panel and AskSheet.
