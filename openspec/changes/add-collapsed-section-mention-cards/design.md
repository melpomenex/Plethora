## Context

The `#` section-mention feature exists in three chat surfaces — **AssistantPanel** (sidebar assistant), **FlashcardStudioModal** (`ContextControlPanel` → `mode === "sections"`), and **DocumentQATab** (older standalone chat). All three resolve a picked `SectionNode` (from `useDocumentSections`) and currently display it as small, opaque chips or rows that show only title + breadcrumb + an estimated token count. None of them let the user read the actual captured section prose before sending, and where the prose does surface it does so without bounds.

The captured data is already available and identical across surfaces: a `SectionNode` with `id`, `title`, `breadcrumb: string[]`, `level`, optional `page`, and `content: string` (the resolved section text). The selection handlers (`handleSelectAssistantSection`, `handleSelectStudioSection`, `handleSelectSection`) already track the chosen nodes in component state. Token estimation is already shared via `estimateTokens()` / `Math.ceil(content.length / 4)`.

This change is a **presentation-only** refactor: collapse the per-surface chip/row JSX into one shared, collapsed-by-default, expandable card component. No backend, no context-resolution, and no token/cost logic changes.

## Goals / Non-Goals

**Goals:**
- One shared `SectionMentionCard` component used by all three surfaces, so the collapsed/expanded interaction is identical everywhere.
- Collapsed by default to keep the chat input compact and free of text blobs.
- On expand, reveal the section's `content` in a bounded, scrollable body so the user can verify what will be sent.
- Keep all existing behaviors intact: remove (`×`) still clears the node from state and strips its `#{title}` token from the input; token estimates, cost summary, and context assembly are unchanged.
- Minimal, additive i18n additions only.

**Non-Goals:**
- Changing what is sent to the LLM (token resolution, `resolveSectionFocusedContext`, `createDocumentQaRequestContent`, `sourceContext` stamping — all untouched).
- Editing the `SectionMentionPopup` selection UI (the popup that appears while typing `#`).
- Changing inline `#{title}` chip rendering inside already-sent user messages (AssistantPanel `renderUserMessageContent` and DocumentQATab `formatInputForDisplay`) — those stay as compact inline pills.
- Adding per-section pinning, reordering, or bulk operations.
- Touching the older surfaces' broader styling.

## Decisions

### Decision 1: One new shared component `SectionMentionCard`, not three inline copies
**Choice:** Create `src/components/common/SectionMentionCard.tsx` (sibling of `SectionMentionPopup.tsx`) and have all three surfaces render it.
**Rationale:** The three current implementations duplicate ~95% of the same rendering (icon, title, breadcrumb, token badge, remove button). A single component gives one place to maintain the collapse/expand behavior, accessibility, and styling.
**Alternatives considered:**
- *Inline per surface* — rejected: triples the maintenance and risks drift, which is exactly why the chips already diverge (emerald badges in DocumentQATab vs. token-tier pills in AssistantPanel).
- *Hook-only shared logic* — rejected: the JSX differs enough that a pure-logic hook wouldn't remove the duplication.

### Decision 2: Collapsed-by-default, local React state for expansion
**Choice:** Each card holds its own `useState(false)` expansion flag; the parent does not track expansion. `defaultExpanded` prop is offered (defaults `false`) but not wired by any surface.
**Rationale:** Expansion is a transient, view-only concern; threading it into each surface's `ContextSelection`/state would pollute persisted or send-relevant state. Local state keeps the diff tiny and the boundary clean (expansion never affects what's sent).
**Alternatives considered:**
- *Persist expansion in `ContextSelection`* — rejected: would couple a cosmetic toggle to data that flows into context assembly and tests.
- *Global "expand all" toggle* — rejected as out of scope; can be layered later without redesign.

### Decision 3: Collapsed header content = title + breadcrumb + token count + remove + chevron
**Choice:** Header shows a section icon, `breadcrumb[last] > title` (or just `title` when breadcrumb is empty), the token estimate, the existing remove (`×`) control, and a `▸`/`▾` chevron to toggle.
**Rationale:** Matches the info already shown by the current chips (so no regression in at-a-glance information), adds only the chevron. The user confirmed this header content (title + breadcrumb + token count).
**Token badge color tiers:** Reuse the existing tier scheme (emerald < 1k, amber ≤ 4k, rose > 4k, muted when 0) already in AssistantPanel so the visual language is consistent.

### Decision 4: Expanded body shows `node.content` in a bounded, scrollable region
**Choice:** When expanded, render `node.content` (the already-captured resolved text) in a `max-h-48 overflow-y-auto whitespace-pre-wrap` body. If `content` is empty, show a muted "No preview available" note instead of an empty box.
**Rationale:** `content` is already loaded by `useDocumentSections`, so no extra fetch/resolve work. `whitespace-pre-wrap` preserves structure; the height cap prevents the blob from blowing out the input area — exactly the user's complaint.
**Alternatives considered:**
- *Re-resolve on expand* — rejected: `content` is present; re-resolution would add latency and could differ from what's cached.
- *Show `preview` (80-char snippet) instead* — rejected: too little to "read it if they wish to read it" as requested.

### Decision 5: Shared `estimateTokens` for the badge, keep per-surface display formatting
**Choice:** Card imports `estimateTokens` from `src/utils/sectionIndex` (same util `SectionMentionPopup` and the Studio use) and a local `formatTokenCount` for the `1.2k`-style display.
**Rationale:** Avoids the current divergence where AssistantPanel uses `Math.ceil(content.length / 4)` inline while the Studio uses `estimateTokens`. Standardizing on `estimateTokens` removes a latent inconsistency without changing any number meaningfully (both approximate). If a surface relied on the exact inline form for a test, that test will be updated.

### Decision 6: Accessibility — card is a `button`-toggleable region
**Choice:** The chevron/row toggles via keyboard (Enter/Space) with `aria-expanded` and `aria-controls`; the body has a stable `id`. The remove button stays a real `<button>` with `aria-label`. `role="region"` on the expanded body.
**Rationale:** Keeps keyboard parity with the rest of the input affordances and avoids regressing the existing keyboard-navigable chips.

## Risks / Trade-offs

- **[Layout shift in DocumentQATab]** The older badge row mixes document `@mentions`, detected-chapter badges, and section badges in one `flex-wrap` line; swapping only the section badges for taller (but collapsed) cards could disrupt that row. → Mitigation: keep the collapsed card height close to the existing chip height (~24px) and let the row still `flex-wrap`; the card is a single line when collapsed.
- **[Test churn]** `FlashcardStudioContext.test.ts` and `GlobalSearch.test.tsx` are in the modified set and may assert on chip class names/structure. → Mitigation: update those assertions to the new card selectors; the behavior under test (selection, removal, token display) is preserved.
- **[`content` can be large]** A very long section's `content` is held in memory regardless (it's already there for resolution); rendering it on expand is just DOM. → Mitigation: `max-h-48 overflow-y-auto` caps the painted height; expansion is opt-in, so collapsed-by-default keeps initial paint cheap.
- **[Visual divergence history]** The three surfaces already look different (emerald vs. token-tier pills). → Mitigation: standardizing is an explicit goal and improves consistency; any user muscle memory of the old chips is preserved at the info level (same title/breadcrumb/tokens visible).
- **[i18n coverage]** New strings must land in all locale files or the card shows raw keys. → Mitigation: add keys to every locale file in one task; run typecheck/lint.

## Migration Plan

No data migration — state shapes (`ContextSelection`, `selectedSectionNodes`, `selectedSections`) are unchanged; only rendering swaps. Rollback is simply reverting the component import and restoring the per-surface chip JSX (the old blocks are well-localized by line ranges in the proposal's Impact section). No feature flag needed given the small, additive surface.

## Open Questions

- None blocking. (Per-surface `defaultExpanded` could be exposed later if a user study wants the Studio expanded while the Assistant stays collapsed; not wired now.)
