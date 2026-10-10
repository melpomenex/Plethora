## Purpose

Make PDF viewport positioning deterministic across explicit navigation, initial restoration, user input and delayed fixed/reflow rendering.

## ADDED Requirements

### Requirement: User Scroll Position Stability
The system MUST treat direct user scroll input as authoritative and SHALL NOT override the viewport position with background restoration updates while user scroll ownership is active.

#### Scenario: Programmatic restoration suppressed after manual scroll
- **WHEN** a user scrolls within an open PDF document
- **THEN** the system preserves the resulting viewport position and suppresses non-essential programmatic repositioning that would move to a different location

#### Scenario: Render updates do not force snap-back
- **WHEN** additional pages render or virtualized content mounts/unmounts after the user has scrolled
- **THEN** the viewport remains anchored to the user's current reading position without snapping to a prior cached position

### Requirement: Deterministic TOC Navigation
The system MUST execute table-of-contents navigation as a single active action and SHALL resolve to the selected heading destination without oscillating between unrelated pages.

#### Scenario: TOC click lands on selected heading
- **WHEN** a user clicks a heading in the table of contents
- **THEN** the viewer navigates to the corresponding destination page/offset and keeps that destination as the active target until navigation completes

#### Scenario: Late events from prior navigations are ignored
- **WHEN** multiple TOC navigations are initiated in sequence and delayed render or scroll events arrive from an older navigation
- **THEN** only events associated with the most recent active navigation are allowed to update viewport position

### Requirement: Stable Post-Navigation Scrolling
After TOC navigation completes, the system MUST allow normal scrolling without page hopping caused by deferred destination corrections.

#### Scenario: Scroll after TOC jump remains continuous
- **WHEN** the user starts scrolling after landing on a TOC destination
- **THEN** the viewer scrolls continuously from the landed position and does not jump to unrelated pages due to stale correction logic

#### Scenario: Destination settle criteria before completion
- **WHEN** the viewer is navigating to a TOC destination while destination page content is still rendering
- **THEN** the navigation is marked complete only after the destination is within configured settle thresholds, preventing visible load-then-unload oscillation

### Requirement: One-time Initial Restoration
Initial saved-position restoration SHALL run once per opened reader and SHALL be permanently cancelled by explicit navigation or direct user input. Parent and child viewers MUST NOT replay competing saved positions after initial restoration completes.

#### Scenario: Same-page TOC interrupts restoration
- **WHEN** the user chooses another heading on the current page during initial restoration
- **THEN** restoration is cancelled before destination resolution and cannot later move the reader to the saved location

#### Scenario: Reopen restores legitimate progress
- **WHEN** a reader is closed after scrolling or explicit navigation and reopened
- **THEN** the last legitimate saved position is restored once, with further scrolling remaining authoritative

### Requirement: Exact PDF Destination Geometry
Fixed-mode TOC navigation SHALL use the selected destination's rendered zoom and rotation transformation and SHALL distinguish headings on the same page. Reflow navigation SHALL resolve the corresponding source heading or block, with small visible padding, rather than merely its containing page.

#### Scenario: Two headings share a page
- **WHEN** two TOC headings on the same page are selected in sequence
- **THEN** each selection moves to its distinct destination independently of whether the current page changes

#### Scenario: Rotated or zoomed destination
- **WHEN** a TOC destination uses XYZ, Fit, FitB, FitH, FitBH, FitV, FitBV or FitR on a rotated or zoomed page
- **THEN** coordinates are transformed to the actual rendered viewport and null XYZ coordinates preserve their corresponding viewport axis

#### Scenario: Delayed reflow analysis
- **WHEN** the user selects a reflow heading before its semantic blocks are available
- **THEN** the latest request waits for block readiness and reaches that block; a later manual scroll cancels any deferred correction

#### Scenario: User input interrupts delayed rendering
- **WHEN** manual input occurs while a destination page or block is still rendering
- **THEN** no later rendering, resize compensation or saved-state restoration can reclaim the viewport for that destination
