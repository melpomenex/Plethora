# Proposal: Smart Organization of Browser Extension Imports

## Why

Browser Extension saves are already durable, fast, and useful, but organization stops at capture. A saved page, selected extract, generated Q&A/cloze card, or image-occlusion card should enter the same local-first Smart Tagging system as an in-app document. Today the native browser server creates several of those records directly, while the frontend Smart Tagging queue only understands documents. The result is inconsistent tags, lost source context, operational labels mixed into semantic taxonomy, and no lightweight way to find imports that need a human decision.

This change is deliberately separate from native media controls. It can be implemented and shipped without audio work, and it reuses the canonical Smart Tagging foundation already established by `smart-tagging-system` instead of creating a second classifier.

## Current repository audit (2026-08-21)

- Canonical tagging lives in `src/lib/smartTagging/`, `src/lib/ai/tasks/definitions/smartTagging*`, `src/lib/ai/schemas/smartTagging.ts`, and `src/stores/smartTaggingQueueStore.ts`. It has bounded concurrency, local fallback, confidence policy, manual/dismissed protection, and document-only orchestration.
- `src/stores/documentStore.ts` enqueues ordinary and URL/article document imports, but browser-created records arrive through Rust and only trigger the `browser-sync://document-saved` refresh listener in `src/stores/documentStore.ts`.
- `src-tauri/src/browser_sync_server.rs` handles page, extract, AI flashcard, and image-occlusion requests. `browser_import_tags()` currently adds labels such as `browser-extension`, `image-occlusion`, and `ai-generated` to semantic tag arrays.
- Browser payloads carry useful but loosely shaped `context`, while source document identity, headings, surrounding text, author, captions/alt text, and source tags are not consistently available to downstream classification.
- Documents store Smart Tag provenance in `metadata.smart_tag_details`; extracts and learning items have `selection_context` / `interaction_metadata`, `tags`, and optional document/extract IDs, but no shared organization status contract.

## What Changes

- Extend the existing Smart Tagging orchestration to a typed target contract covering browser-created documents, extracts, Q&A/cloze learning items, and image-occlusion learning items. The classifier, normalization, confidence policy, and local/LLM fallback remain canonical and shared.
- Add a bounded, versioned browser capture-context envelope. It carries source URL/domain, page title, author when known, heading path, nearby text, captions/alt text, content type, source document identity, and source semantic tags without sending an unnecessary full page.
- Trigger organization after the browser record is durably saved, with a startup/reload reconciliation path so an event arriving while the WebView is unavailable does not strand the item. Capture remains immediate and never waits for an LLM.
- Store operational capture provenance (`source`, `itemType`, `sourceUrl`, capture time, source document ID, and organization status) in structured metadata. Preserve explicitly supplied user tags as manual; do not add operational labels to the user’s semantic taxonomy.
- Apply source context as bounded evidence rather than blindly copying source tags. A child item may inherit only relevant, canonicalized tags, with provenance and confidence recorded per assignment.
- Add an optional, virtual Needs Review view spanning all browser-import target types. It is a filter over existing records, not a mandatory inbox. It supports accept, remove, add/create, retag, mark-correct, dismiss, and bulk actions with the same user-authority rules as existing tag editing.
- Investigate deterministic preference learning as an optional, privacy-preserving phase: correction/acceptance signals may create explicit aliases or preference hints, but no model training, hidden taxonomy mutation, or LLM dependency is introduced.

## Capabilities

### New

- `browser-import-organization`: unified, context-aware Smart Tagging for browser page, extract, Q&A/cloze, and image-occlusion imports.
- `import-needs-review`: a cross-item virtual review surface and review actions for uncertain or incomplete organization.
- `tag-correction-preferences`: an optional, feature-gated deterministic memory of repeated user corrections and accepted mappings.

### Modified

None. Existing Smart Tagging and browser-sync contracts are extended additively; their existing callers remain valid when the new context fields are absent.

## Impact

- Frontend: `src/stores/smartTaggingQueueStore.ts`, Smart Tagging context/policy helpers, browser event handling near `src/stores/documentStore.ts`, item-tag UI/events, settings, and a new virtual review view or command-palette entry.
- Native/browser boundary: `browser_extension/shared.js`, `content.js`, and `background.js`; request/metadata handling in `src-tauri/src/browser_sync_server.rs`.
- Models/APIs: typed capture provenance and Smart Tag status in existing document metadata, extract selection context, and learning-item interaction metadata; tags remain semantic arrays.
- Persistence: additive JSON metadata is preferred. A durable job table is not required if status-based reconciliation is reliable; any migration must be additive and reversible.
- Runtime behavior: local deterministic tagging remains available offline; LLM calls are bounded, opt-in through existing settings, and never on the synchronous browser-save path. Existing request/body and image-size limits remain enforced.
- Overlap: `smart-tagging-system` is the implemented foundation and is amended only for browser targets and review state. `audit-browser-extension`, `add-browser-extension-connection`, `fix-browser-extension-save`, `fix-browser-extension-extract-and-test`, `fix-browser-import-rendering-and-capture-opt-in`, and `overhaul-web-article-import` are historical/adjacent capture changes; this proposal supersedes their incomplete auto-organization assumptions without redoing their transport work. This change is independent of `native-media-lock-screen-controls`.

## Definition of Done

1. Browser page imports enter the canonical Smart Tagging pipeline after durable save.
2. Selected extracts enter the same pipeline with source-document context.
3. Browser-generated Q&A and cloze items enter the same pipeline.
4. Image-occlusion cards enter the same pipeline without losing image-region metadata.
5. Existing Smart Tagging normalization, confidence policy, user settings, and local fallback are reused.
6. Browser context includes bounded title, URL/domain, headings, nearby text, and available author/caption/alt evidence.
7. Source document identity and source semantic tags are carried when resolvable.
8. Source tags influence child classification without unconditional tag copying.
9. Explicit user tags remain manual and are never overwritten by Smart Tagging.
10. Operational capture metadata is structured and is not inserted as semantic tags for new imports.
11. Existing operational browser labels are handled compatibly without silently changing unrelated historical items.
12. Browser save latency does not wait for an LLM or tagging completion.
13. Offline/local fallback produces useful deterministic organization or a reviewable no-result state.
14. Event loss or WebView suspension is recoverable by reconciliation.
15. Repeated save/retry events do not create duplicate tags, jobs, or review entries.
16. Low-confidence, empty, and conflict cases are represented in one virtual Needs Review view.
17. Review actions use existing item-tag controls and preserve provenance/tombstones.
18. Needs Review is optional and does not block normal browsing, saving, or studying.
19. Correction signals are either implemented behind an explicit optional gate or documented as a follow-up with no hidden behavior.
20. Unit, integration, and manual extension-save coverage verifies all four target types, permissions, limits, and user authority.
