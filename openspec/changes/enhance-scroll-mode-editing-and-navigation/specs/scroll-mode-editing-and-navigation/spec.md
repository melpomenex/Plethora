## ADDED Requirements

### Requirement: Extracts in Scroll Mode support image insertion and persistence

Users editing an extract in Scroll Mode SHALL be able to insert images via file selection, clipboard paste, or drag-and-drop using the shared Image Registry, see them inline, remove them, and persist `html_content` across navigation and restart.

#### Scenario: Inserting an image into a Scroll Mode extract persists html_content
- **WHEN** the user inserts an image into an extract in Scroll Mode
- **THEN** the image renders inline without overflowing and `updateExtract` persists `html_content`

### Requirement: Mouse-wheel-driven Scroll Mode navigation is configurable

Users SHALL be able to disable mouse-wheel-driven item navigation via a persisted setting (`scrollQueue.wheelNavigationEnabled`), keeping normal content scrolling and explicit Next/Previous navigation functional.

#### Scenario: Disabling wheel navigation prevents accidental topic advances
- **WHEN** `scrollQueue.wheelNavigationEnabled` is `false` and the user scrolls to the bottom of an item with the mouse wheel
- **THEN** the current item remains active and explicit Next/Previous buttons and keyboard shortcuts still navigate
