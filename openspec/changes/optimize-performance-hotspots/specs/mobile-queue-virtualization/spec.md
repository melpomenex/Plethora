# mobile-queue-virtualization

The mobile queue list virtualizes rendering above a small item threshold.

## ADDED Requirements

### Requirement: Mobile queue list is virtualized
The mobile queue view SHALL render its item list through list virtualization when the filtered item count exceeds the same threshold used by the desktop queue (20 items), mounting DOM rows only for the visible window plus overscan. At or below the threshold it MAY render the plain list.

#### Scenario: Large mobile queue renders a bounded DOM
- **WHEN** the mobile queue contains 1,000 filtered items
- **THEN** only the rows within the viewport plus overscan exist in the DOM, and scrolling remains smooth as rows are recycled

#### Scenario: Small queue keeps the simple path
- **WHEN** the mobile queue contains 10 filtered items
- **THEN** the list renders without virtualization overhead

### Requirement: Row interactions survive virtualization
Swipe gestures, selection mode, and item action sheets on mobile queue rows SHALL behave identically under virtualization, and the scroll container SHALL retain the scroll behavior established by the mobile-queue scrolling fix (commit 2b12f2f2).

#### Scenario: Swipe actions on a virtualized row
- **WHEN** the user swipes a row in a virtualized mobile queue
- **THEN** the same postpone/action behavior triggers as in the non-virtualized list

#### Scenario: Scroll regression check
- **WHEN** the user scrolls the mobile queue extracts area
- **THEN** scrolling behaves as fixed in commit 2b12f2f2 (no trapped or dead scroll regions)
