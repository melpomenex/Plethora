## Why

On mobile, Capture Activity shows browser-extension instructions and omits content shared to Plethora through the system share sheet. The recent-capture list should reflect the capture entry point for the running app: share-sheet imports on iOS/Android and browser-extension saves on desktop.

## What Changes

- Show the six newest saved share-sheet documents on native mobile, including supported URLs, files, images, audio/video, and text notes. Keep browser-extension saves as the desktop list.
- Persist share provenance for every supported mobile share import path, including warm/cold starts, deduplicated documents, and saved URL failure placeholders. Identify genuine share ingress explicitly because desktop external-open imports use the same routing helper.
- Generalize capture previews and their metadata query to accept a capture source and an optional original web URL. File/text captures remain readable without an external-page action.
- Use mobile-specific heading, empty-state instructions, and “View all shared items” navigation; retain desktop browser-save wording and behavior. Select the source by runtime platform rather than window width.
- Make View all open an all-library, newest-first, tab-local source filter matching the list, with a removable source chip.
- Refresh captures and existing analytics after mobile share persistence completes, as well as on Dashboard activation; preserve independent loading/error states and existing capture totals.

## Capabilities

### New Capabilities

- `dashboard-shared-captures`: Platform-aware recent captures, durable mobile share attribution, previews without web URLs, source-filtered Library navigation, and refresh after share import completion.

### Modified Capabilities

None. The related `dashboard-capture-activity`, `dashboard-capture-library-links`, and native-share capabilities currently live in unarchived changes rather than `openspec/specs/`. This capability extends those implemented surfaces; it does not redefine their baseline layout, analytics reporting window, or native staging protocol.

## Impact

- **Capture ingress:** `src/types/share.ts`, `src/lib/shareTarget.ts`, `src/lib/importRouting.ts`, and `src/hooks/useShareTarget.ts`; additive native batch fields in the folder-import plugin where required to retain origin/source-app information.
- **Persisted listing:** `src-tauri/src/models/capture.rs`, `src-tauri/src/database/capture_repository.rs`, analytics/document commands and command registration; typed capture API and Library source-filter API, with a compatible browser-only command wrapper.
- **Dashboard/Library:** capture hook, Capture Activity shelf/tile, Dashboard navigation, `DocumentsTab`, `DocumentsView`, and `useLibraryDocuments`; equivalent source filtering in the browser backend.
- **Localization and verification:** all supported locale files; focused provenance, query, normalization, component, lifecycle, navigation, and mobile share-handoff coverage, followed by the local performance/bundle gate during implementation.
- No new dependency, capture-event table, storage-schema migration, remote preview fetch, or native share-extension redesign is required.
