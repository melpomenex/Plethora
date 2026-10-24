## Why

Saved HTML articles scroll slowly in the Linux AppImage even with few tabs, a plain theme, and the Assistant closed. Investigation confirmed duplicate position writes, full-document serialization for position-only updates, and duplicated scroll-driven Assistant context preparation; these are actionable defects, although frame profiling is still required to establish their contribution to the reported lag.

## What Changes

- Consolidate reader position persistence into one atomic operation that updates unified and legacy resume fields, journals one compact position change, and returns a small acknowledgement.
- Coalesce continuous scroll updates with bounded pending work, latest-position ordering, periodic durability, and explicit lifecycle flushes.
- Keep scroll bookkeeping out of broad reader/queue renders and remove duplicate full-content tokenization; prepare Assistant context on demand while preserving selection, viewport, provider budget, and source semantics.
- Make position-only sync records explicitly field-scoped and safely mergeable alongside existing full-document records.
- Add behavioral regression coverage and controlled before/after measurements of the packaged Linux reader, including save latency, frame timing, payload bytes, and memory.
- Document existing outbox growth and a separate recovery assessment; do not delete pending history or automatically vacuum the user's database.

## Capabilities

### New Capabilities

- `reader-scroll-performance`: Bounded position persistence and context work during scrolling, lifecycle durability, and repeatable packaged-reader responsiveness validation.

### Modified Capabilities

- `plethora-sync`: Position-only changes use compact, explicitly scoped payloads without disturbing unrelated document fields or losing offline convergence.

## Impact

- Frontend: `src/components/viewer/DocumentViewer.tsx`, `DocumentViewerWrapper.tsx`, `src/pages/QueueScrollPage.tsx`, reader-position helpers, position APIs, tokenizer/context utilities, and relevant browser-mode adapters.
- Backend: document/position commands and services, repository progress updates, sync payload encoding and field-group apply logic. Existing command consumers require an explicit compatibility audit before any return-type change.
- Validation: focused TypeScript/Rust tests, representative seeded benchmarks where appropriate, `npm run bench:check`, and Linux AppImage profiling with reproducible workload and artifact identity.
- Related work: preserve the contracts in `selection-aware-assistant` and `assistant-composable-prompt-budget`; coordinate with `fix-linux-appimage-runtime-and-rendering`, `unify-assistant-experience`, and existing position/sync changes without completing their unrelated tasks here.
- No new dependency, Settings control, graphics-policy default, release, installation replacement, or destructive database migration is required.
