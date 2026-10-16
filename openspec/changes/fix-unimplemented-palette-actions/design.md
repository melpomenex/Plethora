## Context

See `proposal.md` for motivation and scope. The current implementation has several distinct failure modes:

| Path | Current evidence | Consequence |
| --- | --- | --- |
| Translate Selection | `getDefaultCommands()` dispatches `translate-selection`; no production listener is registered | No visible result |
| Manage / New Queue | Navigation followed by a 150 ms event; listeners live in `ReviewQueueView` | Lazy mounting can lose the action |
| Mobile queue | `QueueTab` mounts `MobileQueueView`, which has no saved-queue event handlers | Desktop-only handling cannot serve mobile commands |
| Saved queue selection | Store activation updates an ID; `ReviewQueueView` applies settings using ID-dependent effects and imperative queue lookup | Late queue data and reselecting the same ID need explicit handling |
| Saved queue catalogue | Dynamic commands are read using `getState()` while `CommandCenter` memoizes its controller | Catalogue freshness needs a reactive dependency and regression coverage |
| Record Lecture | Apple and generic lecture commands share the same label but use different events; both hosts are mounted by `MainLayout` | Two entries can appear, as in the supplied screenshot |
| Execution | `GlobalSearch` browse rows await an action then close; the legacy palette invokes actions without awaiting | Failures and focus transitions differ between entry points |

The existing tests in `CommandPalette.savedQueues.test.tsx` verify emitted events and mocked activation, not the manager dialog or effective queue contents. Existing `languageTranslation` providers and `LanguageReaderActionOverlay` provide reusable translation infrastructure, but the latter currently routes selected text through sentence mode; arbitrary passage translation needs to retain the whole captured selection.

## Goals / Non-Goals

**Goals:** Establish a small typed boundary between commands, navigation, and destination UI; preserve active pane and selection identity; make observable outcomes testable without real translation services or native devices.

**Non-Goals:** A general workflow engine, persistent action queue, translation backend, saved-queue schema migration, scheduling algorithm changes, or palette visual redesign. Existing language opt-in, provider policy, and platform capability rules continue to govern execution.

## Decisions

### 1. Audit the actual catalogue and repair every dead advertised path

Inventory commands assembled by both `getDefaultCommands()` and `buildCommandCatalogue()`, plus contextual and registered help actions reachable from the palette. Record command ID, surface, destination/handler, prerequisites, supported platform, outcome, and test evidence in `action-audit.md`. Reconcile overridden registry IDs before calling two commands duplicates. Trace timer/event paths including import, scan, Ask Library, flashcard creation, theme, shortcuts, and optimal-session navigation; implement missing wiring or fix advertised semantics where the handler is incomplete. Unsupported platform actions are hidden by existing capability rules. Supported named actions remain in scope for implementation; hiding Translate Selection or queue actions is not a substitute for completing them.

Alternative: fix only the three named labels. Rejected because the user explicitly included other unfinished actions and the duplicate recording command is already visible evidence of a wider catalogue issue.

### 2. Deliver destination actions through consumable navigation requests

Reuse existing navigation/tab request infrastructure if it already provides delivery after mount; otherwise add a narrowly scoped transient request to the existing UI/navigation state. A request contains an allowlisted action, unique invocation ID, target pane/tab or destination, and typed payload such as a queue ID. Publish the request before navigation. The active destination consumes it after its required state is ready and acknowledges it once. Acknowledgment means the intended dialog is open or the requested configuration has been applied, not merely that an event was dispatched. Cancel superseded requests and requests whose target is closed or abandoned; never replay a stale request on later navigation. Report navigation/delivery failures through the shared execution feedback path.

Queue management and creation are hosted at the shared `QueueTab` boundary, or through a shared hook consumed by both desktop and mobile views, reusing `ManageSavedQueuesModal` and session customization controls. Only the targeted active instance consumes the request. The toolbar uses the same path. Keep thin adapters for existing event callers where needed, with a single consumer to avoid duplicate dialogs.

Alternative: increase the 150 ms delay or retry window events. Rejected because machine load and lazy imports remain unbounded and retries risk duplicate handling.

### 3. Apply saved queue configuration as one shared operation

Subscribe the catalogue/controller to saved queue data and loading/error state. Generate commands from the current collection's loaded queues and use stable IDs for targeting. Resolve the ID against current data again at execution so a stale row cannot activate a deleted queue. Queue activation waits for required data, persists the selected ID, and uses one shared application path for membership filters, item types, duration, maximum items, session goal, and ranking preset. Both dropdown selection and palette selection use that path. Apply after data arrives and when reselecting an already active queue; prevent effect loops with invocation/configuration identity rather than ID change alone. Surface persistence errors, restoring the previous active state when activation cannot complete. An empty match still selects the requested queue and shows its normal empty state.

“Saved Queues: Quick Review” means activate that named preset and show its filtered queue, matching its current command description. It does not automatically start an unrelated review session. Starting Scroll Mode afterward inherits the selected configuration through existing behavior. The palette's Start Optimal Session command also reactivates the saved profile and waits for both queue data and rendered configuration before the owning Queue view creates the session. An explicitly empty custom item array remains authoritative in Scroll Mode.

Alternative: set `activeQueueId` and navigate. Rejected because it does not guarantee the displayed queue uses the preset, especially with late loading or same-ID selection.

### 4. Capture selection before focus moves and route translation to its owner

At palette opening, capture the active reader's stable selection snapshot, document/host ID, pane/tab ID, and source anchor through existing selection infrastructure, including iframe and virtual PDF selections. Do not read `window.getSelection()` after the palette input has focus. Only show the translation command for a non-empty, valid active-reader selection. Revalidate ownership before execution; an unrelated tab switch invalidates the snapshot.

Route through the shared typed contextual-action registry to the owning reader. Reuse `createTranslationService()` and translation result components, adapting the reader overlay for whole-passage translation rather than truncating to the first sentence or its 50-sentence window. Use the active language profile's translation direction when configured; otherwise present target-language selection using existing translation settings without silently enabling Language Mode. Close the palette before handing focus to result/setup UI. Show progress, translated text, source/target languages, and accurate provider provenance; preserve source text. Honor local-only/offline policy and permitted provider fallback. Replace the unconditional “on this device” description with truthful copy. Expose setup/model availability errors with a next step; cancel work or ignore its result when its owning reader closes or changes.

Alternative: attach a global listener that translates the current DOM selection. Rejected because palette focus can clear the selection and multiple mounted readers can receive the same event.

### 5. Use one execution and availability policy

Use a shared executor for keyboard, pointer, browse, and search activation. Transfer focus by closing the palette before destination dialogs/results open; retain pending operation state outside the palette when necessary. Catch synchronous throws and promise rejections, prevent duplicate activation of the same pending invocation, and report a localized actionable error without claiming success. Keep successful plain navigation behavior intact. For recording, expose one logical command and resolve its supported capture backend through existing capabilities and hosts. Capability support and user setup are separate: unsupported platforms hide the command; recoverable missing configuration opens setup or shows guidance.

Alternative: wrap only new handlers in individual try/catch blocks. Rejected because the existing entry points would continue to diverge and duplicate actions could still run.

## Risks / Trade-offs

- [Multiple mounted panes consume one request] → Target pane/tab identity and consume by invocation ID; test inactive panes explicitly.
- [Selection snapshots become stale] → Scope to document/host lifetime and invalidate on unrelated navigation, while retaining snapshots across palette-only focus changes.
- [Language overlay changes alter sentence mode] → Keep explicit passage and sentence modes and run existing language/selection suites.
- [Optimistic saved queue state conceals persistence failure] → Make activation failures observable and test rollback plus retry.
- [A new request remains pending forever] → Cancel on supersession/navigation abandonment and surface a bounded delivery failure; do not use timeout as the trigger for execution.
- [An audit expands into unrelated incomplete features] → Repair advertised action wiring and promised outcomes; document unrelated backend backlog separately without treating a placeholder as a working action.
- [Catalogue subscriptions rebuild too often] → Subscribe to relevant store slices, retain lazy imports, and run `npm run bench:check` locally.

## Migration Plan

No persisted data migration. Introduce the shared execution/request path, migrate queue and other audited timer handoffs, wire translation, then remove obsolete command registrations and redundant event delivery. Preserve existing queue data and translations. Rollback is a code revert; transient requests are never persisted. Validate browser behavior with provider mocks, desktop/mobile queue renderers, and native platform capability fixtures; verify native-only actions on a suitable runtime before claiming native execution coverage.
