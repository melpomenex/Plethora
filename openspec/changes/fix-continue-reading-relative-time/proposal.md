## Why

The Continue Reading cards can show values such as `2947w ago`, which is not a realistic age for a recently imported document. The card currently formats a backend timestamp without a stable, user-facing meaning and is vulnerable to Unix-seconds versus JavaScript-milliseconds mismatches. Users need a trustworthy indication of when the document entered the library.

## What Changes

- Show Continue Reading recency as the time since the document was imported/added to the library.
- Carry the document's import timestamp through the native and browser progress-list APIs.
- Normalize timestamps at the API boundary so the UI always receives JavaScript milliseconds.
- Keep the existing document ordering based on the most recently modified document state.
- Provide a safe fallback for legacy or invalid import timestamps and keep the full timestamp available to assistive technology and hover text.
- Add regression coverage for seconds-to-milliseconds conversion and realistic relative-time output.

## Capabilities

### New Capabilities

- `continue-reading-recency`: Defines the meaning, formatting, normalization, and fallback behavior for recency shown on Continue Reading cards.

### Modified Capabilities

None.

## Impact

- Continue Reading data model and API mapping in `src/types/position.ts` and `src/api/position.ts`.
- Native position queries and browser backend projections that currently return only `date_modified`.
- Continue Reading card rendering and localized accessibility/tooltip text.
- Unit and integration tests for the native/browser timestamp contract and relative-time formatting.
