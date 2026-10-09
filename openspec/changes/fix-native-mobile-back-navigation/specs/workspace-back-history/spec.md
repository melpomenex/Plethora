## Purpose

Preserve the user's retained chronological workspace visits independently of tab residency, allowing reliable Back/Forward traversal across activation, closure and restoration.

## ADDED Requirements

### Requirement: Chronological traversal is independent of residency
Each pane SHALL retain a chronological Back/current/Forward history, bounded to the most recent 256 entries in each direction, independent of unique tab activation/residency bookkeeping. Nonadjacent repeated visits SHALL be retained. Back/Forward SHALL activate exactly one valid destination and advance their position atomically without closing the source tab.

#### Scenario: Repeated Back
- **GIVEN** Dashboard, Queue, Document and Settings were visited in order
- **WHEN** workspace Back is invoked repeatedly after each transition settles
- **THEN** destinations SHALL be Document, Queue and Dashboard, with no repeated-current stall

#### Scenario: Multiple visits to a singleton
- **GIVEN** A, B, A and C were visited in that order with A reused as a singleton
- **WHEN** Back is invoked twice
- **THEN** destinations SHALL be A and B in order
- **AND** A SHALL remain a single tab

#### Scenario: Resident state survives history traversal
- **WHEN** Back activates a resident or previously evicted reader
- **THEN** existing residency limits and safe restoration SHALL apply
- **AND** reader position and unsaved state SHALL be preserved according to existing reader safeguards
- **AND** unrelated resident tabs SHALL NOT be unmounted solely because history was popped

### Requirement: Forward retraces Back until a new visit branches
Forward SHALL consume the most recent valid Forward destination and push the departed current view onto Back. A new foreground visit to a different tab SHALL invalidate Forward in that pane. Activating the already-current tab or opening a background tab SHALL not invalidate Forward.

#### Scenario: Back then Forward
- **GIVEN** A→B→C followed by Back to B and Back to A
- **WHEN** Forward is invoked twice
- **THEN** B and C SHALL become active in order without ping-pong

#### Scenario: New navigation after Back
- **GIVEN** A→B→C followed by Back to B
- **WHEN** D is visited and Forward is requested
- **THEN** Forward SHALL have no C destination
- **AND** Back SHALL return to B

#### Scenario: Duplicate activation and background import
- **GIVEN** Forward contains valid destinations
- **WHEN** the current singleton is activated again or a document is imported into a background tab
- **THEN** the existing Forward branch SHALL remain intact

### Requirement: Tab and pane mutations normalize historical destinations
Closing a tab SHALL remove all its occurrences from Back and Forward. Missing or moved destinations SHALL be skipped safely at traversal time. Reopening a tab SHALL create a fresh visit without resurrecting removed visits. Pane mutation SHALL preserve valid surviving history and SHALL not fabricate chronology from tab order.

#### Scenario: Closed historical destination
- **GIVEN** A→B→C and B is closed
- **WHEN** Back is requested from C
- **THEN** A SHALL become active safely

#### Scenario: Current tab closes
- **WHEN** the current tab closes and an existing replacement tab is selected
- **THEN** the current history identity SHALL match that replacement atomically
- **AND** no closed or same-current destination SHALL trap subsequent Back/Forward

#### Scenario: Reopening a closed view
- **WHEN** a formerly visited tab is reopened after its entries were removed
- **THEN** reopening SHALL record one fresh foreground visit
- **AND** earlier removed occurrences SHALL NOT return

#### Scenario: Tab moves to another pane
- **WHEN** a historical tab is moved out of its source pane
- **THEN** source traversal SHALL skip it
- **AND** destination history SHALL change only for a real foreground activation

### Requirement: Workspace restoration validates navigation independently
Persisted chronological history SHALL be versioned, bounded and validated against restored tabs/panes. Legacy workspaces without chronological history SHALL start each pane at its selected current view with empty traversal stacks. Bootstrap tab creation and default-view selection SHALL not be recorded as artificial user visits.

#### Scenario: Legacy saved workspace
- **WHEN** a saved workspace lacking chronological history is restored
- **THEN** no chronology SHALL be inferred from unique MRU or tab order
- **AND** Back SHALL use active context or the safe root fallback when appropriate

#### Scenario: Versioned workspace with invalid entries
- **WHEN** a saved history contains closed, unrehydratable or wrong-pane tabs
- **THEN** those entries SHALL be removed and valid relative order SHALL be retained

#### Scenario: Navigation races restoration
- **WHEN** the user opens a destination during asynchronous workspace restoration
- **THEN** restoration SHALL NOT overwrite that foreground navigation or its history

### Requirement: External and direct entry use activation history
A warm deep link or external document/share intent that activates a different workspace destination SHALL record one foreground visit. Cold direct entry SHALL retain a safe Dashboard fallback without inventing a prior external-app destination. Failed or background imports SHALL not create navigable visits. Browser/WebView URL history SHALL remain a separate navigation mechanism.

#### Scenario: Warm document share
- **GIVEN** Queue is active
- **WHEN** a shared document is imported or reused and opened in the foreground
- **THEN** Back SHALL return to Queue once
- **AND** import receipt and processing SHALL NOT add duplicate visits

#### Scenario: Cold deep link
- **WHEN** the app starts directly in a document with no retained prior history
- **THEN** Back SHALL first honor its transient context and otherwise use Dashboard fallback
- **AND** Back SHALL NOT reopen the external source application through workspace history
