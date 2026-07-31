## Why

Today, when a user picks a section via `#` in the Assistant, the AI Flashcard Studio, or the Document Q&A tab, the selected section is shown as small, opaque chips/rows that surface only the title, breadcrumb, and an estimated token count. The user cannot read the actual section text that will be fed to the model — and in places where that text does surface (e.g. resolved context shown alongside the message), it lands as an unbounded wall of prose. Users want a clean, compact representation by default *and* the ability to open it to read the captured content. A single collapsed-by-default, expandable section-mention card across all three chat surfaces fixes both problems at once.

## What Changes

- Introduce one shared **`SectionMentionCard`** component (collapsed by default) that replaces the per-surface selected-section chips/rows in **AssistantPanel**, **FlashcardStudioModal** (`ContextControlPanel` sections mode), and **DocumentQATab**.
- Collapsed state shows: section icon, title, breadcrumb path (`parent > title`), estimated token count, a remove (`×`) control, and an expand/collapse chevron — one compact line per section.
- Expanded state reveals the resolved section content (the same `SectionNode.content` already captured by `useDocumentSections`) inside a scroll-constrained, monospace-ish body so the user can verify exactly what will be sent — without overflowing the chat input area.
- Card expansion is local UI state only; it never changes what is sent to the LLM (token resolution / context assembly is unchanged).
- Add the missing i18n strings for the expand/collapse affordances and any new hints across all locale files.

## Capabilities

### New Capabilities

- `collapsed-section-mention-cards`: Ability for a selected document section (chosen via `#`) to be displayed in the chat input as a collapsed-by-default card that expands on demand to reveal the section's captured content, consistently across the Assistant, AI Flashcard Studio, and Document Q&A tab.

### Modified Capabilities

<!-- No existing spec-level requirements change. The document-section-mentions capability is currently an un-archived change (openspec/changes/add-flashcard-studio-section-mentions) and has no shipped spec yet; section mentions in the Assistant and Document Q&A tab are un-specced. This change establishes the display behavior via a new spec. -->

## Impact

- **New shared component**: `src/components/common/SectionMentionCard.tsx` (collapsible card; props: `node: SectionNode`, `onRemove?: (id) => void`, optional `defaultExpanded?: boolean`).
- **Frontend (Assistant)**: `src/components/assistant/AssistantPanel.tsx` — replace the "Selected section chips" block (~lines 2718–2769) with `<SectionMentionCard>` instances; leave inline `#{title}` rendering inside sent messages untouched.
- **Frontend (Flashcard Studio)**: `src/components/review/FlashcardStudioModal.tsx` — in `ContextControlPanel`'s `mode === "sections"` branch (~lines 1316–1359), render `<SectionMentionCard>` instead of the static row.
- **Frontend (Document Q&A)**: `src/components/tabs/DocumentQATab.tsx` — replace the selected-section emerald badges (~lines 1596–1624) with `<SectionMentionCard>`.
- **i18n**: add expand/collapse label keys to all locale files under `src/lib/i18n/locales/*.ts`.
- **No backend/Rust changes**; no changes to context resolution, token estimation, or what is sent to the model — purely a presentation change.
