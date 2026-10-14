## Why

Capture Activity currently tells people how many items they imported, but does not show the links they just saved with the browser extension. Making those saves recognizable and immediately readable closes the gap between capturing something interesting and returning to it in the library.

## What Changes

- Make a **Recently saved from your browser** shelf the focal content inside Capture Activity: up to six newest extension-saved library documents, each with a landscape cover, readable title, source domain, document type, and relative save time.
- Open the saved document in Plethora with one click. Offer a separate, clearly labeled original-page action; keep both actions usable with keyboard and touch.
- Add deliberate hover and focus feedback using the active theme: a tonal state layer, a stronger outline, and a revealed reading affordance. Keep titles and metadata visible and reserve space for secondary actions so nothing shifts.
- Use stored covers and supported thumbnails, falling back to a composed source/type tile when imagery is absent, blocked, or broken. Keep text outside the image for consistent contrast.
- Keep the 30-day sparkline, source totals, and needs-review entry as a compact supporting layer. Distinguish their reporting window from the shelf, which shows recent saves across all dates.
- Add **View all browser saves**, opening the existing Library with an explicit, removable browser-extension source filter, all-library scope, and newest-first ordering.
- Refresh on dashboard activation and browser-save events, preserving visible content during refresh and isolating shelf failures from analytics and the rest of the dashboard.
- Specify responsive layouts, localization, keyboard access, reduced motion, missing-cover behavior, and meaningful empty/loading/error states.

## Capabilities

### New Capabilities

- `dashboard-capture-library-links`: A bounded, metadata-only browser-save query; a visual shelf within Capture Activity; opening saved and original pages; scoped Library navigation; refresh and resilient interaction states.

### Modified Capabilities

None. `dashboard-capture-activity` exists in the implemented, unarchived `add-capture-activity-dashboard` change, rather than under `openspec/specs/`. This proposal adds a complementary capability and preserves that change's aggregation, placement, source-classification, and needs-attention requirements; it does not recreate or archive the foundation.

## Impact

- Frontend: `CaptureActivityCard`, a focused capture-document tile component, `DashboardTab`, `src/api/capture-activity.ts`, `DocumentsTab`/`DocumentsView`, Library source-filter plumbing, and locale dictionaries.
- Native data boundary: a paginated browser-capture metadata query alongside `src-tauri/src/commands/analytics.rs`, command registration, and repository/query helpers. Reuse the existing provenance classifier; do not load article bodies to render the dashboard.
- Reuse the document-opening and external-opening helpers, cover storage, Material theme roles, Phosphor icons, and existing `browser-sync://document-saved` event. Check that every supported extension document-save path persists provenance, including the successful YouTube import path.
- No schema migration, new image service, animation library, or change to extension transport is expected. Existing saves remain usable without covers. Implementation must pass the local benchmark/bundle gate described in `AGENTS.md`.
- Include a standalone interactive concept preview with illustrative content for review. This change prepares implementation; it does not modify the running product.
