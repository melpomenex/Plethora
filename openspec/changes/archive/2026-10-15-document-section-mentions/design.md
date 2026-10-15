## Context

Document Q&A (`DocumentQATab.tsx`) currently has `@` for documents and `#` for sections. The `#` trigger calls `extractSections()` from `chapterUtils.ts` which scans raw `document.content` for markdown headers `#{1,6}` and numbered patterns. This runs on every `targetDocId` change, produces a flat `DocumentSection[]` (`id,title,content,startIndex,endIndex`) with no level, parent, breadcrumb, or preview. PDF outlines from `pdfjs getOutline()` and EPUB TOC from `epub.js navigation.toc` live only in viewer state and never feed the Q&A popup. Result: 200-heading PDFs show as flat list, user can't tell `Introduction` belongs to `Chapter 2` vs `Chapter 5`.

AssistantPanel has zero `#` support; context is determined by `resolvePdfAssistantContext()` sliding window `contextPageWindow=2`. Users asked for laser focus via `#` in Assistant too.

Goal: one unified hierarchical index usable by both surfaces, with good UX and token-efficient context injection.

## Goals / Non-Goals

**Goals:**
- Single `useDocumentSections(documentId, {outline, toc})` hook producing `SectionNode[]` tree with level, breadcrumb, page, preview.
- Tree-aware # autocomplete shared component `SectionMentionPopup` with fuzzy search, grouping `Chapter > Heading > Subheading`, keyboard nav, 80-char preview, page label.
- When `#section` selected, inject only that section + small surrounding window (prev 1 para, next 1 para) + token count badge, saving tokens vs full doc.
- Extend same UX to AssistantPanel.
- Greeting UX for bare `#`: header, count, tree, hint.

**Non-Goals:**
- Persisting outline tree to SQLite (defer) – keep in-memory LRU cache (`documentSectionCache`) for MVP.
- Changing RAG chunk embeddings or retrieval logic.
- Editing section titles or reordering.
- Server-side rendering of sections.

## Decisions

**1. Unified Section Index Builder – `src/utils/sectionIndex.ts` merges 3 sources with priority:**
- PDF outline: `OutlineNode {title, dest, items}` → flattened via existing `flatOutline` logic to `SectionNode` with `level` from depth, `pageNumber` via resolved dest, `startChar` null (page-based).
- EPUB TOC: `toc {label, href}` → `level` from nesting, `href` kept for future scroll.
- Markdown/heuristic: reuse and extend `extractSections` logic but add level detection: `h1=1, h2=2`, numbered `1. -> 1`, `1.1 ->2`, `1.1.1->3`; capture 80-char preview from `content.slice(0,80)`. Build parent stack to produce tree.
- Merge: If outline exists and heuristic headings also exist, prefer outline as skeleton and attach heuristic children under matching chapter titles via fuzzy title match `title.toLowerCase().includes()`. Fallback to heuristic alone.

*Alternative considered: Three separate lists.* Rejected – user wants single searchable tree.

**2. Data model:**
```ts
interface SectionNode {
  id: string // `section-${hash}` stable per doc
  title: string
  level: number // 1=root, 2=child
  breadcrumb: string[] // parent titles from root to parent
  page?: number
  href?: string
  startChar?: number; endChar?: number
  preview: string // first 80 chars stripped
  content: string
  children: SectionNode[]
  parentId: string | null
}
```
Flat list `allNodes` precomputed with depth-first order for virtualizer, tree kept for grouped rendering.

**3. Hook – `src/hooks/useDocumentSections.ts`:**
- Inputs: `documentId`, `rawContent`, `pdfOutline?`, `epubToc?`
- Returns `{tree, flat, isLoading, breadcrumbs, getById}`
- Cache: `Map<docId, {tree, flat, hash}>` LRU 20 entries keyed by `contentHash + outlineHash`.
- Compute in worker if >1000 sections? MVP sync but memoized; `extractSections` already O(n).
- Expose via `DocumentViewer` callback: `onOutlineLoaded(outline)` → set in store `documentOutlineStore` so Q&A hook can read without prop drilling.

**4. Shared UI Component – `SectionMentionPopup.tsx`:**
- Props: `sectionsFlat, tree, query, selectedIndex, onSelect, open`.
- Render: use `@tanstack/react-virtual` if >100 rows (currently RSSReader uses it). List capped 200px max height, virtualized.
- Group headers sticky when query empty: `Chapter 1` bold section.
- Row: `level` dots/indent (4px*level), `BookOpen`/`Hash` icon, title bold matched substring via `mark`, breadcrumb muted `text-xs`, page right-aligned, preview `text-[11px] muted`.
- Empty bare `#`: header `Sections in this document (42)` + hint `Type to filter…` + tree of top 3 chapters expanded.
- Fuzzy filter: title + breadcrumb join includes query, score by `indexOf` then level (lower level preferred), plus `fuse`-like simple ranking (exact prefix > contains).
- Keyboard handled by parent but component exposes `aria-*`.

**5. Integration points:**
- `DocumentQATab.tsx`: replace `sections` state with hook, replace `filteredSections` memo with fuzzy ranked popup. On select, same token insertion `#{id}` but display mapping uses `node.breadcrumb + title`. Badge shows token estimate `node.content.length/4`.
- `AssistantPanel.tsx`: copy detection logic `beforeCursor.match(/#([^\s#]*)$/)` from QATab, add state `sectionQuery`, `showSectionPopup`, reuse same hook (needs current doc context). On select, insert token and store `selectedSectionNodes`. In `buildContext` / `callLLM`, if `selectedSectionNodes.length>0` build `buildSectionFocusedContext(nodes)` = `Section: breadcrumb > title\n\ncontent + surrounding`.
- Surrounding context: helper `sliceWithNeighbors(content, startChar, endChar, radius=1 paragraph ~300 chars)` returns prev para + target + next para, marked with `[Previous context]`, `[Focused]`, `[Next]`.

*Alternative considered: Insert full section only.* Rejected – user asked surrounding context to inform AI + save tokens, paragraph neighbors help disambiguation for tables/references.

**6. Token budgeting:**
- Existing `maxTokens` from `aiSettings`. When section focused, estimate tokens `section.content.length/4`, show in badge, truncate via existing `select_relevant_excerpt` in Rust or JS `truncateToBudget`. Keep at 70% of `maxTokens` like `buildChapterQAContext`.

**7. Performance:**
- Flat list for search is `O(n)` 500 items trivial. Tree building O(n). Virtualizer prevents DOM blow-up for 1000 sections (e.g., spec documents).
- No re-parse on keystroke; hook memoized on doc id + content hash.

## Risks / Trade-offs

- [Risk] PDF outline dest resolution is async and may be incomplete → Mitigation: flatOutline already has fallback, hook shows outline-available badge only when ready, otherwise heuristic list.
- [Risk] Duplicate headings ("Introduction" appears 3×) ambiguous → Mitigation: breadcrumb in row + preview + page number disambiguates.
- [Risk] AssistantPanel used without document (general chat) → Mitigation: # popup only enabled when `AssistantContext.type==='document'` and sections available; otherwise no trigger.
- [Risk] Large docs >10k lines parsing blocks main thread → Mitigation: LRU cache, debounce 200ms, future offload to worker `sectionParse.worker.ts`.
- [Risk] Breaking existing `#{id}` tokens if id scheme changes → Mitigation: keep `section-${n}` ids stable sorted by startChar, hash content prefix for id persistence; alias old ids via map lookup fallback to title match.

## Migration Plan

- No DB migration.
- Keep `extractSections` as fallback inside new `sectionIndex.ts` – delete after.
- Add feature flag `ENABLE_SECTION_TREE=true` locally; if disabled popup falls back to flat.
- Rollback: revert to old flat popup by restoring previous `DocumentQATab` version (no persisted data).
- Deploy: frontend only; no Tauri rebuild required.

## Open Questions

- Should surrounding context radius be user-configurable in Settings (1-3 paragraphs)?
- Persist outline to SQLite for faster reopen or keep memory-only?
- Should `#` mentions also work for web articles with `<h1-h6>` parsed from readability output?
