## ADDED Requirements

### Requirement: Documents view loads on first activation
The Documents view SHALL load documents for the currently active collection on first tab activation, and SHALL re-load when the active collection id changes while the view is mounted — including when the startup snapshot hydrates the real active collection id after the view has already mounted. The view SHALL NOT remain empty until the user navigates away and back.

#### Scenario: Snapshot lands after first mount
- **WHEN** the Documents view mounts and loads while `activeCollectionId` still holds the pre-hydration placeholder, and the startup snapshot subsequently hydrates the real collection id
- **THEN** the view re-loads with the real collection id and shows its documents without requiring tab re-activation

#### Scenario: Collection switched while view active
- **WHEN** the user switches the active collection while the Documents view is the active tab
- **THEN** the document list reloads for the new collection

### Requirement: Desktop queue view does not strand on a failed first load
The desktop review queue view SHALL only record its loaded query key after a load path completes successfully, and SHALL retry with backoff when the startup snapshot resolves null (watchdog timeout), so that a slow first load leaves the view in a recoverable state rather than permanently stuck.

#### Scenario: Watchdog null on first activation
- **WHEN** the queue view activates for the first time and `ensureStartup("queue")` resolves null via the watchdog
- **THEN** the view retries loading with backoff until data arrives, and later activations re-attempt the load rather than early-returning on a claimed key

#### Scenario: Rapid tab toggling does not duplicate loads
- **WHEN** the user rapidly switches away from and back to the queue view during a load
- **THEN** concurrent loads are coalesced (no duplicate fetch storms)

### Requirement: Backend readiness failures are re-probeable
When the backend readiness probe exhausts its attempts, the transport SHALL clear its cached readiness promise so that subsequent commands re-probe readiness instead of failing instantly until app restart.

#### Scenario: Readiness probe fails then backend becomes ready
- **WHEN** the initial readiness probe cycle fails and the backend finishes initialization afterwards
- **THEN** the next command invocation re-probes readiness and succeeds
