## ADDED Requirements

### Requirement: Watch-page save button scoped to watch metadata
The browser extension SHALL inject the YouTube save button only within the active `ytd-watch-metadata` actions area on `/watch` pages.

#### Scenario: Initial watch page load
- **WHEN** a YouTube watch page hydrates with `ytd-watch-metadata` and actions container
- **THEN** exactly one save button appears inside the watch metadata actions area

#### Scenario: Wrong decoy actions container ignored
- **WHEN** a temporary `#actions` element exists outside `ytd-watch-metadata` during hydration
- **THEN** the save button is not attached to the decoy container

### Requirement: Idempotent button ensure
The extension SHALL use an idempotent ensure function that does not remove a correctly placed, connected button.

#### Scenario: Repeated ensure calls
- **WHEN** `ensureYouTubeSaveButton` is called multiple times with stable DOM
- **THEN** exactly one button exists with no duplicate listeners

### Requirement: Same-URL subtree replacement reinjection
The extension SHALL reinject the save button when the watch metadata subtree is replaced while the URL remains unchanged.

#### Scenario: Metadata subtree replacement
- **WHEN** YouTube replaces the watch actions subtree on the same `/watch?v=` URL and the injected button is disconnected
- **THEN** the extension reinjects exactly one button in the new actions host

### Requirement: SPA navigation lifecycle
The extension SHALL update button association on SPA video navigation and remove stale buttons when leaving watch pages.

#### Scenario: Video A to video B navigation
- **WHEN** the user navigates from one watch video to another via SPA
- **THEN** the save button exists in the new video's watch metadata actions area

#### Scenario: Navigate away from watch
- **WHEN** the user navigates away from `/watch` pages
- **THEN** stale save buttons are removed and no reinjection occurs on non-watch pages

### Requirement: Efficient mutation observation
DOM mutation handling SHALL be debounced via `requestAnimationFrame` and scoped to watch metadata when available.

#### Scenario: Mutation storm coalescing
- **WHEN** many DOM mutations occur during hydration
- **THEN** ensure runs at most once per animation frame and does not create duplicate buttons
