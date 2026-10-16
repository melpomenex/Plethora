## Why

The command palette advertises actions that can silently do nothing: Translate Selection has no event listener, and queue management relies on a timer to reach a view that may not be ready. Users need each advertised action—including Saved Queues: Quick Review—to produce the promised result reliably.

## What Changes

- Audit every command reachable through Actions, View All, and search, recording its real handler, prerequisites, platform support, and observable outcome; repair dead or incomplete paths found in that inventory.
- Connect Translate Selection to the active reader's captured selection and existing translation service/result UI, preserving the selection across palette focus and showing truthful provider availability and errors.
- Replace timer-based navigation handoffs with typed, consumable requests that reach the active destination once it is ready, including Manage Queues and New Queue on desktop and mobile.
- Make saved queue commands reactive to loading, creation, renaming, and deletion; apply the selected queue's filters and session configuration even when the queue view mounts before queue data arrives or the queue is already active.
- Consolidate duplicate Record Lecture entries into one supported command and handle asynchronous failures consistently across palette entry points.
- Verify visible UI and effective queue membership, rather than merely asserting that a custom event was dispatched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `command-palette-navigation`: Reliable destination action delivery, consistent asynchronous execution and errors, and one supported command per user intent across palette surfaces.
- `contextual-palette-actions`: Selection-scoped translation that survives palette focus, targets only the active reader, and presents translation results or actionable unavailability.
- `saved-queues`: Reliable palette management/creation entry points and reactive saved queue selection that applies effective filters and session settings.

## Impact

Primary areas are `src/components/common/CommandPalette.tsx`, `src/commandPalette/catalogue.tsx`, `src/components/search/CommandCenter.tsx`, `src/components/search/GlobalSearch.tsx`, navigation in `MainLayout`, queue tab/view components, `savedQueueStore`, and reader selection/language overlays. Existing translation providers, queue persistence, platform capability checks, localization, and modal/focus helpers will be reused. No new backend or third-party dependency is planned. Implementation validation includes focused integration tests, existing relevant suites, and the local `npm run bench:check` gate. This change does not redesign the palette, change scheduling algorithms, or implement unrelated product backlog features.
