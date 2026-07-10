## 1. Core Section Index Utility

- [x] 1.1 Create `src/utils/sectionIndex.ts` with `SectionNode` type (id, title, level, breadcrumb, page, href, startChar, endChar, preview, content, children, parentId).
- [x] 1.2 Implement `parseMarkdownHeadings` with level from `#` depth and numbered pattern `^(\d+(?:\.\d+)*)` → level = dotCount+1, capture 80-char preview.
- [x] 1.3 Implement `buildTreeFromHeadings` using stack to assign parentId, compute breadcrumb array and stable `section-${hash}` ids.
- [x] 1.4 Implement `mergeOutlineWithHeuristics(outlineNodes, heuristicNodes)` fuzzy title match to attach heuristic children under outline chapters.
- [x] 1.5 Implement `flattenTree` DFS to produce `flat` list with depth-first order and `getById` map.
- [x] 1.6 Add `sliceWithNeighbors` helper to get prev para, focused, next para with labels `[Previous context]`, `[Focused]`, `[Next]`, configurable radius 300 chars.
- [x] 1.7 Add LRU cache `documentSectionCache` Map with max 20 entries keyed by docId+contentHash+outlineHash, with `getCache`/`setCache`.

## 2. Hook – useDocumentSections

- [x] 2.1 Create `src/hooks/useDocumentSections.ts` taking `{documentId, content?, pdfOutline?, epubToc?, contentHash?}`.
- [x] 2.2 Inside hook, memoize tree building: if cached and hash matches return cached; else call `sectionIndex.build` and cache.
- [x] 2.3 Handle PDF outline input: convert `OutlineNode[]` via `convertPdfOutlineToNodes` using existing flatOutline resolver pattern, preserving pageNumber.
- [x] 2.4 Handle EPUB TOC input: convert `toc` nesting to SectionNodes preserving href and level.
- [x] 2.5 Expose `tree, flat, isLoading, getById, breadcrumbsFor(id)` and `buildSectionFocusedContext(ids)` that returns formatted context string with surrounding window.
- [x] 2.6 Add unit tests in `src/utils/sectionIndex.test.ts` for markdown, numbered headings, breadcrumbs, duplicate titles.

## 3. Shared UI – SectionMentionPopup Component

- [x] 3.1 Create `src/components/common/SectionMentionPopup.tsx` with props `{tree, flat, query, selectedIndex, onSelect, onClose, open}`.
- [x] 3.2 Implement fuzzy filter scoring: exact prefix > contains, title weight 2× breadcrumb, sort by score then level.
- [x] 3.3 Implement grouped rendering: when query empty show collapsible Chapter headers sticky; when query non-empty show flat filtered list.
- [x] 3.4 Row UI: indent by level (8px*level), icon (BookOpen for chapter, Hash for heading), title with `<mark>` for match, breadcrumb muted `text-xs`, page right-aligned, preview `text-[11px]` 80 chars.
- [x] 3.5 Add greeting header for bare `#`: "Sections in this document (N)" + hint "Type to filter…" and count badge.
- [x] 3.6 Add virtualisation using `@tanstack/react-virtual` when flat.length >100, max height 320px, overscan 10.
- [x] 3.7 Add keyboard handlers: ArrowUp/Down move index, Tab/ArrowRight expand, ArrowLeft collapse, Enter select, Escape close, aria roles `listbox`/`option`.
- [x] 3.8 Style with existing Tailwind tokens matching Mention popup (bg-card, border, shadow, hover bg-muted).

## 4. Document Q&A Integration

- [x] 4.1 In `DocumentQATab.tsx`, replace `extractSections` local state with `useDocumentSections` hook feeding `rawDoc.content` + outline from store.
- [x] 4.2 Replace flat `filteredSections` memo with fuzzy filtered `flat` from hook, passing query to popup.
- [x] 4.3 Render `SectionMentionPopup` instead of custom div, wire `showSectionPopup`, `sectionQuery`, `sectionCursorIndex`.
- [x] 4.4 On select, keep insertion `#{id}` but display mapping uses `node.breadcrumb.join(' > ') + ' > ' + node.title` from `getById`.
- [x] 4.5 Add chip badge with token estimate `Math.ceil(node.content.length/4)` and breadcrumb tooltip.
- [x] 4.6 Update `buildMultiDocumentContext` / `getDocumentContent` to use `buildSectionFocusedContext` with neighbors when `sectionMatch` found; add truncation via existing budget 70% maxTokens.
- [x] 4.7 Ensure `detectedChapter` still works alongside new section focus.

## 5. Expose Outline/Toc from Viewers

- [x] 5.1 Create `src/stores/documentOutlineStore.ts` Zustand store `outlineByDocId: Map<docId, {pdfOutline?, epubToc?, updatedAt}>` with `setOutline(docId, ...)`.
- [x] 5.2 In `PDFViewer.tsx` where `outline` state set after `pdfDoc.getOutline()`, call `documentOutlineStore.setOutline(docId, {pdfOutline: outline})`.
- [x] 5.3 In `EPUBViewer.tsx` where `setToc`, also set `documentOutlineStore.setOutline(docId, {epubToc: toc})`.
- [x] 5.4 In `useDocumentSections` hook or `DocumentQATab`, read outline/toc from store for current `targetDocId` to merge with heuristic index.
- [x] 5.5 Keep backward compatibility if store empty (use heuristic only).

## 6. Assistant Panel # Support

- [x] 6.1 In `AssistantPanel.tsx`, add state `showSectionPopup`, `sectionQuery`, `sectionCursorIndex`, `selectedSectionNodes` (SectionNode[]).
- [x] 6.2 Add detection in input change/keydown mirroring QATab: regex `/#([^\s#]*)$/` on text before cursor, only when `context.type==='document'`.
- [x] 6.3 Use `useDocumentSections` with current doc's content + outline store entry to get sections.
- [x] 6.4 Render `SectionMentionPopup` positioned above textarea similar to QATab, with same keyboard handling extension to existing `handleKeyDown`.
- [x] 6.5 On select, insert `#{id}` token and push node to `selectedSectionNodes`, render chips above textarea with breadcrumb and remove X.
- [x] 6.6 In `callLLM` path, if `selectedSectionNodes.length>0`, override resolved context with `buildSectionFocusedContext(selectedSectionNodes)` and include breadcrumb header; pass token badge to UI header via `getContextMessage`.
- [x] 6.7 On send, clear `selectedSectionNodes` and popup state, include `#{}` tokens in history for reproducibility.

## 7. polish & QA

- [x] 7.1 Test with 300-page PDF with outline (e.g., spec PDF), verify tree, keyboard, page numbers, preview.
- [x] 7.2 Test with 60-chapter EPUB, verify virtualization and filter <100ms.
- [x] 7.3 Test with markdown doc containing `#`, `##`, numbered headings, duplicate titles – verify breadcrumbs disambiguate.
- [x] 7.4 Verify token savings: focus on 1 section vs full doc, ensure badge shows correct count and context truncated.
- [x] 7.5 Run `npm run lint` and `cargo check` – ensure no TypeScript errors, Tailwind classes consistent.
- [x] 7.6 Update CHANGELOG mention for new #mention tree UX if needed.
