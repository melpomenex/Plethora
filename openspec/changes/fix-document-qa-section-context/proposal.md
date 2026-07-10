## Why

Selecting a heading with `#` in Document Q&A can send only the heading label to the chosen LLM, especially when the section came from a PDF outline or EPUB table of contents. This makes section-focused answers appear grounded while withholding the body text the user explicitly selected.

## What Changes

- Resolve every selected section to its actual body range in the active document before assembling an LLM request.
- Reconcile PDF/EPUB outline nodes with extracted-text headings using normalized titles, hierarchy, page/href hints, and source order, including duplicate heading titles.
- Make section boundaries include the selected heading's descendant content until the next heading at the same or higher level, rather than reducing parent sections to a heading line or immediate fragment.
- Centralize focused-section context assembly so the user prompt and structured `chatWithContext` payload receive the same resolved content exactly once.
- Detect title-only, empty, stale, or mismatched section references and recover from the current document text; if recovery is impossible, block the request with a clear context-unavailable message instead of silently sending a title.
- Preserve token budgeting while prioritizing the selected section body, using neighbor text only when budget remains and surfacing truncation honestly.
- Add regression coverage for Markdown/text, PDF outlines, EPUB TOCs, duplicate titles, parent sections, multiple mentions, stale IDs, extraction fallback, and LLM request payloads.

## Capabilities

### New Capabilities
- `document-qa-section-context-integrity`: Guarantees that a `#`-selected Document Q&A section is resolved to meaningful document body text and delivered consistently to the selected LLM, with safe recovery and failure behavior.

### Modified Capabilities

None.

## Impact

- Affected frontend context/indexing code: `src/utils/sectionIndex.ts`, `src/hooks/useDocumentSections.ts`, and `src/components/tabs/DocumentQATab.tsx`.
- Likely shared helper/test updates around section identity, range calculation, token budgeting, and request construction.
- No breaking API, storage schema, provider, or dependency changes are expected; all configured LLM providers continue through the existing `chatWithContext` interface.
