## Context

Current state (see proposal.md Why): `resolvePdfAssistantContext` in `src/utils/assistantContext.ts` already accepts `selection` but treats document/window text as primary body with selection appended; there is no guaranteed "selection first" ordering. The `ask` selection action exists in `selectionActionRegistry.ts` (bar/menu/sheet) but its host handlers do not seed a persistent, selection-pinned Assistant thread. Assistant answers stay confined to fed context with no explicit expand-beyond-document path and no Brave-keyed lookup integration.

Constraints: repo-local change; reuse existing Assistant panel/store, selection registry, and Brave settings/key detection; no new external service unless Brave key present; keep unrelated selection actions untouched.

## Goals / Non-Goals

**Goals:**
- Guarantee selection-precedence prompt construction with quoted excerpt + doc ref for PDF/EPUB/HTML/TXT/MD and thread/X-thread paths.
- Provide a select → Ask handoff that opens/focuses the Assistant with a pinned selection context surviving follow-up turns.
- Add an explicit, user-triggered expand-beyond-document path (model knowledge + optional Brave search with citations).

**Non-Goals:**
- Automatic background web search on every question; changes to highlight/copy/dictionary/flashcard/extract; new AI provider plumbing; offline/RAG index changes; chapter-level auto-summarization UI.

## Decisions

- **Selection-first context builder over separate pipeline:** extend `resolvePdfAssistantContext` / generic + X-thread resolvers so a normalized non-empty selection is always emitted as the leading `Selected text:` block with `source: selection`-aware attribution, document body demoted to secondary. Alternative (parallel selection-only mode) rejected — losing surrounding doc context hurts "explain this in context" questions.
- **Thread-pinned selection snapshot, not live DOM reference:** the Ask handoff snapshots `{ excerpt, docId/title, locator, createdAt }` into the Assistant thread/store; follow-ups re-inject the snapshot. Alternative (re-reading DOM selection each turn) rejected — highlight is usually gone by turn two.
- **Explicit trigger + opt-in Brave, never implicit:** expansion fires only on user phrasing ("look it up", "what else", "beyond this document") or an explicit Lookup toggle; Brave runs only when a key is configured. Alternative (always search) rejected — cost, latency, and surprise.
- **Handoff reuses `ask` action id across all three surfaces:** bar/menu/sheet route by existing `SelectionActionId="ask"` to one handoff function that opens/focuses the Assistant and seeds the thread. Alternative (per-surface handlers) rejected — duplicates the hyperlink-selection-context-actions single-registry pattern.
- **Source-labeled answer format:** expanded answers render Document / Knowledge / Web sections with citations; plain document answers keep current format to avoid noise.

## Risks / Trade-offs

- [Risk] Over-long selections blow context window → Mitigation: whitespace-normalize, cap excerpt (e.g. ~2k chars) with `… [truncated]` marker, keep full doc body truncated independently.
- [Risk] Stale pinned context confuses later turns → Mitigation: visible context chip with Clear, plus auto-reseed on new-selection Ask.
- [Risk] Brave latency/failure blocks answers → Mitigation: run search async with timeout, always answer from doc+knowledge, disclose lookup status.
- [Risk] Trigger-phrase false positives/negatives → Mitigation: small keyword set + explicit Lookup toggle/button; default to document-grounded answer when ambiguous.
- [Risk] i18n label drift for Ask handoff → Mitigation: reuse existing `selectionBar.ask` / `selectionSheet.ask` keys, no new untranslated strings without entries.

## Migration Plan

- Additive only: extend context resolvers with selection-first ordering behind existing call sites; add thread context-pinning fields with defaults (no migration of old threads); gate Brave lookup on existing key setting.
- Rollback: revert handoff to current `ask` behavior (opens Assistant without pinned context) and disable expansion trigger; no data migration to undo.

## Open Questions

- Exact excerpt char limit and page-window size for secondary context (default 2k chars / ±2 pages, tunable after bench on long PDFs)?
- Should the Lookup toggle live in the Assistant input row or only as auto-detected phrasing for v1?
