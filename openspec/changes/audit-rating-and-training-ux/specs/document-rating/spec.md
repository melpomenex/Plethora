## MODIFIED Requirements

### Requirement: Document Review and Navigation
The system SHALL support rating documents during reading, which triggers rescheduling and navigation. The rating interface SHALL be fully accessible and usable on both desktop and mobile viewport sizes, including visible interval previews on all screen sizes.

#### Scenario: User rates a document after reading
- **Given** the user is viewing a document in the "Document" view mode
- **When** the user selects a rating (Again, Hard, Good, Easy) via the `HoverRatingControls` or keyboard shortcuts
- **Then** the application should submit the rating to the backend with the time spent
- **And** the backend should reschedule the document using FSRS
- **And** the application should automatically navigate to the next document in the queue

#### Scenario: Interval preview visible on mobile
- **Given** the user is viewing the rating buttons on a mobile/narrow viewport
- **When** preview intervals are available
- **Then** the next-review interval text SHALL be visible on each rating button (not hidden behind a `md:block` breakpoint)
- **And** the interval text SHALL be legible at the smaller button size

#### Scenario: Keyboard navigation and focus ordering
- **Given** the user is navigating the rating buttons via keyboard
- **When** the user tabs through or uses number keys (1–4)
- **Then** the focused button SHALL display a visible focus ring
- **And** the tab order SHALL follow the logical rating order (Again → Hard → Good → Easy)
