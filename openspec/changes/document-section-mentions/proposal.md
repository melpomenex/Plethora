## Why

Current `#` section mentions in Document Q&A are a flat, unranked list of heuristically guessed headings from `extractSections`. PDF outline (`pdfDoc.getOutline()`), EPUB navigation TOC, and markdown heading hierarchy are discarded after viewer load. There is no tree, no breadcrumbs, no surrounding context, and no visual cue of what will actually be sent to the LLM. For long documents (300+ pages PDF, 50-chapter EPUBs) the list is unusable, and full-section injection wastes tokens by missing neighbor paragraphs that disambiguate the answer. This also doesn't exist in AssistantPanel at all.

## What Changes

- **Unified Section Index**: Merge all sources into one tree — PDF outline with page+dest resolution, EPUB `book.loaded.navigation.toc` with spine href, Markdown `#{1,6}` headings with line offsets, plus fallback numbered-heading heuristic. Single source of truth `DocumentSectionNode {id,title,level,page,href,startChar,endChar,children,parentId,breadcrumb,preview}` cached per document and persisted in viewer state.

- **Hierarchical # Autocomplete UX**: Replace flat list with tree-aware popup for both Document Q&A and Assistant when typing `#`:
  - Group by `Chapter > Heading > Subheading`, collapsible sections, indent + level dots.
  - Fuzzy search (title + breadcrumb) after `#`, highlight match.
  - Keyboard: ArrowUp/Down, Tab/ArrowRight expand, ArrowLeft collapse, Enter select, Escape dismiss.
  - Each row shows: icon per level, title, breadcrumb muted, page number if available, 80-char preview snippet.
  - Shows up to 8 top hits + full tree scroll when no query.
  - Selected chips render with breadcrumb and clear action.

- **Laser-Focused Context with Surrounding Window**: On selection `#{id}`, only that section's content is sent, but with configurable surrounding context (prev/next paragraph, parent heading, +/- N chars). UI badge shows `Focused: Chapter 2 > 2.1 Background (320 tokens)`. Token budget displayed and truncated with `[...]` separators via existing `select_relevant_excerpt` logic.

- **Assistant # Support**: Bring same `#` trigger to AssistantPanel textarea (currently has zero mention support), sharing the same hook and popup component.

- **Good UX Greeting for `#`**: When user types bare `#`, show greeting header: "Sections in this document", grouped tree, search hint ("Type to filter"), and empty state with count.

- **Performance**: Sections extracted once, cached in `documentSectionCache` (LRU 20 docs), built off Tauri `extract_document_text` + viewer outline merging, not recomputed on keystroke.

## Capabilities

### New Capabilities
- `section-mention-tree`: Unified hierarchical section index derived from PDF outline, EPUB TOC, and markdown headings with parent/child, breadcrumbs, preview.
- `section-mention-ux`: Tree-aware #mention autocomplete component with fuzzy search, keyboard navigation, grouping, and chip rendering used in both Q&A and Assistant.

### Modified Capabilities
- `document-qa-section-focus`: Previously flat list + full section injection. Now requires tree, surrounding context window, token budget badge, and shared component.
- `assistant-document-context`: Assistant panel currently uses sliding page window only. Now supports # section mention to laser-focus context via same tree source.

## Impact

- **Frontend**:
  - `src/components/tabs/DocumentQATab.tsx` – replace flat `filteredSections` popup with new `SectionMentionPopup`, use `useDocumentSections` hook merging outline+extract.
  - `src/components/assistant/AssistantPanel.tsx` – add `#` detection (`/#([^\s#]*)$/`), show popup, store `selectedSections`, include in `callLLM` context.
  - New: `src/hooks/useDocumentSections.ts` – builds `DocumentSectionNode[]` tree, memoizes, handles PDF `outline`, EPUB `toc`, markdown parse.
  - New: `src/components/common/SectionMentionPopup.tsx` – tree rendering, virtualized list for 500+ headings, fuzzy filter.
  - New: `src/utils/sectionIndex.ts` – replaces/augments `chapterUtils.extractSections` with level-aware parser + merge logic.
  - `src/components/viewer/PDFViewer.tsx` + `EPUBViewer.tsx` – expose outline/toc via store/callback so Q&A can consume without re-parsing.
  - `src/utils/assistantContext.ts` – add `buildSectionFocusedContext` helper.

- **Backend**:
  - No Rust changes required for MVP; optional future `get_document_outline` command to persist outline in SQLite could be added.

- **UX**: Token savings ~70% vs full doc for 50-page chapters; test with 300-page PDF and 60-chapter EPUB.
