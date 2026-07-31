## 1. Shared `SectionMentionCard` component

- [x] 1.1 Create `src/components/common/SectionMentionCard.tsx`. Props: `node: SectionNode`, `onRemove?: (id: string) => void`, `defaultExpanded?: boolean` (defaults `false`).
- [x] 1.2 Implement collapsed header: section icon (`Hash`/`BookOpen`), title with breadcrumb context (`breadcrumb[last] > title` when breadcrumb present, else `title`), estimated token-count badge (import `estimateTokens` from `src/utils/sectionIndex`; reuse emerald<1k / amber≤4k / rose>4k / muted tier classes), remove (`×`) `button` (gated on `onRemove`, `aria-label`), and a `▸`/`▾` expand toggle.
- [x] 1.3 Implement expand/collapse via local `useState<boolean>(defaultExpanded ?? false)`. The toggle is keyboard-operable (Enter/Space), exposes `aria-expanded`, and `aria-controls` the body's stable id; the body uses `role="region"`.
- [x] 1.4 Implement expanded body: render `node.content` in a `max-h-48 overflow-y-auto whitespace-pre-wrap` region. When `node.content` is empty/blank, render a muted i18n "no preview available" message instead of an empty box.
- [x] 1.5 Keep the collapsed card a single line (~24px) so it can `flex-wrap` inside existing rows without layout shift.

## 2. Wire `SectionMentionCard` into AssistantPanel

- [x] 2.1 In `src/components/assistant/AssistantPanel.tsx`, replace the "Selected section chips" block (the `selectedSectionNodes.map(...)` pill JSX, ~lines 2718–2769) with `selectedSectionNodes.map((node) => <SectionMentionCard key={node.id} node={latestNodeFor(node)} onRemove={handleRemoveAssistantSection} />)`.
- [x] 2.2 Preserve the existing removal behavior: `onRemove` removes the node from `selectedSectionNodes`, strips its `#{title}`/`#{id}` token from `input`, and collapses double spaces (mirror the current inline handler). Extract it into a `handleRemoveAssistantSection(id)` callback if not already present.
- [x] 2.3 Do NOT change inline `#{title}` rendering inside already-sent user messages (`renderUserMessageContent`) — those stay as compact inline pills.

## 3. Wire `SectionMentionCard` into FlashcardStudioModal (`ContextControlPanel`)

- [x] 3.1 In `src/components/review/FlashcardStudioModal.tsx`, replace the per-section row JSX inside the `safeSelection.mode === "sections"` branch of `ContextControlPanel` (~lines 1322–1350) with `selectedSections.map((node) => <SectionMentionCard key={node.id} node={node} onRemove={onRemoveSection} />)`.
- [x] 3.2 Keep the surrounding `max-h-48 overflow-y-auto` list container, the hint text, the empty-state branch, and the token/cost summary unchanged.
- [x] 3.3 Confirm `handleRemoveSectionById` (which strips the `#{title}` token and resets `mode` to `"full"` when all sections cleared) remains the wired removal handler via the existing `onRemoveSection` prop.

## 4. Wire `SectionMentionCard` into DocumentQATab

- [x] 4.1 In `src/components/tabs/DocumentQATab.tsx`, replace the selected-section emerald badges inside the mention/chapter/section badge row (~lines 1596–1624) with `selectedSections.map((node) => <SectionMentionCard key={node.id} node={node} onRemove={handleRemoveDocumentQaSection} />)`.
- [x] 4.2 Extract/confirm a removal handler that removes the node from `selectedSections`, strips the `#{title}` token from `rawInput`, and re-runs `formatInputForDisplay(newValue, mentions, nextSections)` so the displayed input stays consistent.
- [x] 4.3 Keep document `@mentions` and detected-chapter badges in the same `flex-wrap` row untouched.

## 5. i18n

- [x] 5.1 Add i18n keys for the new affordances across ALL locale files (`src/lib/i18n/locales/{en,es,fr,de,ja,zh}.ts`): an expand label, a collapse label, a remove label (if a common one doesn't already exist), and a "no preview available" message — namespaced under `sectionMention.*` (or reuse `common.*` where fitting).

## 6. Tests & verification

- [x] 6.1 Update any assertions in `src/components/review/__tests__/FlashcardStudioContext.test.ts` (and any other tests that targeted the old chip class names/structure) to match the new `SectionMentionCard` selectors; preserve the behavior under test (selection, removal, token display).
  - No assertions target the old chip markup (`FlashcardStudioContext.test.ts` only tests `normalizeContextSelection`; no other tests reference the removed classes/helpers). No changes required.
- [x] 6.2 Add a focused unit/component test for `SectionMentionCard`: renders collapsed by default with title+breadcrumb+token count and NO body text; expanding reveals `content`; collapsing hides it; empty `content` shows the "no preview" message; `onRemove` fires with the node id; `aria-expanded` toggles.
- [x] 6.3 Run `npm run typecheck` and lint; fix any errors introduced by the new component or the three wiring sites.
  - `npx tsc --noEmit` shows zero errors in any touched file; the only error (`GlobalSearch.test.tsx`) is pre-existing (10 baseline errors exist at clean HEAD with this change stashed).
  - `npx eslint` clean on all touched files.
  - Related suites pass: `SectionMentionCard` (10/10), `FlashcardStudioContext` (2/2), `flashcardStudioSessions` (34/34), assistant suite (4/4).
- [ ] 6.4 Manual: in each of the three surfaces, type `#`, pick a section, confirm the card is collapsed by default, expands to show the content in a bounded region, collapses again, and that removing the card clears the section + `#{title}` token without affecting what is sent to the model.
