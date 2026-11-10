## Purpose

Guarantees persistent, jitter-free scroll position retention in the Assistant conversation panel during user reading, periodic background re-renders, window and element resizing, and queue navigation.

## ADDED Requirements

### Requirement: Assistant conversation scroll position retention
The Assistant conversation viewport SHALL preserve the user's current scroll offset and reading position across background component re-renders, periodic layout recalculations, and container resizes. The viewport SHALL NOT reset or jump to the top when the container dimensions fluctuate or briefly collapse during background processing.

#### Scenario: Periodic background update while reading
- **GIVEN** an active Assistant conversation containing enough messages to require scrolling
- **WHEN** the user scrolls down to read recent messages or remains at the bottom of the conversation
- **AND** a periodic background process executes after an idle interval
- **THEN** the Assistant viewport SHALL retain the user's scroll position
- **AND** the viewport SHALL NOT reset or scroll to the top of the conversation

### Requirement: Reliable bottom-following mode
When the Assistant conversation viewport is scrolled to the bottom (within the follow threshold of the newest message), the viewport SHALL enter and maintain follow mode. While follow mode is active, the viewport SHALL remain anchored to the bottom as new content loads or container resizing occurs, and SHALL NOT misinterpret layout transitions or unmeasured container states as an intentional user scroll to the top.

#### Scenario: Maintaining bottom anchor across container resize
- **GIVEN** the Assistant viewport is scrolled to the bottom with follow mode active
- **WHEN** the container is resized or its layout is recalculated
- **THEN** the Assistant viewport SHALL remain anchored at the bottom
- **AND** subsequent scroll state capture SHALL NOT register a scroll to top with follow mode disabled

### Requirement: Scroll continuity across queue context transitions
In queue views and scroll mode, transitioning between queue items or resolving item-specific conversation context SHALL maintain conversation scroll continuity. Asynchronous loading or metadata updates for the active queue item SHALL NOT cause the Assistant viewport to discard its saved position or jump to the top.

#### Scenario: Item context resolution in Queue Scroll Mode
- **GIVEN** the user is viewing an item in Queue Scroll Mode with the Assistant panel open
- **WHEN** item-specific conversation context or metadata is asynchronously resolved or updated
- **AND** the conversation remains on the active queue item session
- **THEN** the Assistant panel SHALL maintain the active scroll position without jumping to the top
