## MODIFIED Requirements

### Requirement: Context-menu extraction increments the extract counter
When the user selects text, right-clicks, and chooses Plethora's context-menu extraction command, and the extract is successfully created, the extension's displayed extract counter SHALL increment exactly once, using the same source of truth as other extraction paths.

#### Scenario: Successful context-menu extract increments once
- **WHEN** the user right-click-extracts selected text and the server confirms the extract was created
- **THEN** the tab's `pageExtracts` SHALL include the new extract, the persisted per-host storage SHALL be updated, and the popup's "Extracts" counter SHALL increase by exactly one

#### Scenario: Counter reflects newly created extract in an open popup
- **WHEN** the popup is open (or opened after) a successful context-menu extraction in the same tab
- **THEN** `loadStats()`/`getPageStats()` SHALL report the updated count

### Requirement: The context-menu path shares the successful-create state path
The context-menu (and the MV3 `quick-extract` command) SHALL join the same shared "extract successfully created" state/event path used by the normal extraction flow, rather than running a parallel background-only path that bypasses the content script's state.

#### Scenario: Shared success registration
- **WHEN** a context-menu extraction succeeds
- **THEN** the extract SHALL be registered through the same mechanism that the popup/selection flows use to add an extract to `pageExtracts` and persist it (either by delegating creation to the content script, or by the background notifying the content script to register the created record)

### Requirement: No increment on failure or rejection
The counter SHALL NOT increment if the extraction failed, was rejected, or the server returned an error.

#### Scenario: Failed extraction does not increment
- **WHEN** the server returns an error (e.g. connection refused, server error) for a context-menu extraction
- **THEN** the counter SHALL NOT increment and the user SHALL receive the existing error/retry feedback

### Requirement: Exactly-once semantics
The flow SHALL NOT increment twice (e.g. once optimistically and again on the completion event) and SHALL NOT increment if the request was rejected.

#### Scenario: No double count
- **WHEN** a context-menu extraction succeeds
- **THEN** the counter SHALL increase by exactly one regardless of how many success callbacks/events fire for the same create

### Requirement: Robust across background lifecycle and multiple tabs
The increment SHALL work regardless of background service-worker restarts, and the per-tab counter SHALL only change for the tab whose extract was created.

#### Scenario: Service-worker restart does not double-count or lose the increment
- **WHEN** the background service worker restarts between the server create and the content-script registration
- **THEN** the extract SHALL still be registered exactly once (no loss, no duplicate) using persisted server response data or re-derivation from authoritative state

#### Scenario: Multi-tab isolation
- **WHEN** a context-menu extraction is performed in tab A
- **THEN** tab A's counter/storage SHALL update, and other tabs' counters SHALL NOT change

### Requirement: Counter remains derived from authoritative state
The visible count SHALL continue to be derived from the content script's authoritative `pageExtracts`/per-host storage (rather than a fragile separate counter variable), so increments and removals stay consistent.

#### Scenario: Removals still reflected
- **WHEN** the user removes an extract (existing removal path)
- **THEN** the derived counter SHALL decrease consistently, and the context-menu path SHALL NOT reintroduce an independent counter that drifts