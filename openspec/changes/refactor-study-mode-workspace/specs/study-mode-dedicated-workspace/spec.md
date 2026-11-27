# Dedicated Study Mode Workspace Specification

## ADDED Requirements

### Requirement: Mutually Exclusive Document Presentation Modes
Each document tab SHALL own an explicit `DocumentPresentationMode` (`"read" | "study"`), defaulting to `"read"`. Entering Study Mode SHALL transition the document workspace into Study Mode without duplicating the document tab, resetting the document, or leaving the ordinary reader visibly rendered or keyboard-focusable behind Study Mode.

#### Scenario: Entering Study Mode replaces the primary reader presentation
- **GIVEN** a user is reading a document in Read Mode
- **WHEN** the user activates Study Mode
- **THEN** the existing document tab remains active
- **AND** Study Mode occupies the full document workspace width and height in Focused layout
- **AND** the ordinary reader surface is hidden and marked `inert` (not visible and not focusable).

#### Scenario: Ordinary Read Mode remains unaffected when Study Mode is inactive
- **GIVEN** a user opens any document without entering Study Mode
- **WHEN** the document is in Read Mode
- **THEN** `StudyModeWorkspace` is not mounted
- **AND** no Study Mode session initialization, artifact writes, or Study Mode AI calls occur.

### Requirement: Coordinated Study Workspace Layout Without Duplicate Rendering
Study Mode SHALL coordinate optional companion surfaces through a single `StudyWorkspaceLayout` state (`"focused" | "with-source" | "with-assistant"`), defaulting to `"focused"`. Study Mode SHALL NOT render a duplicate full-document plain-text copy alongside or inside the workspace.

#### Scenario: Viewing original source reuses the canonical reader
- **GIVEN** the user is in Focused Study Mode
- **WHEN** the user activates Source Comparison (`"with-source"`)
- **THEN** the single canonical document reader is revealed alongside Study Mode (with a resizable divider on desktop, or single-pane switch on mobile)
- **AND** no second plain-text document renderer is mounted.

#### Scenario: Opening Assistant replaces Source Comparison rather than adding a third column
- **GIVEN** Study Mode is in `"with-source"` layout
- **WHEN** the user opens the Assistant (`"with-assistant"`)
- **THEN** the layout transitions to `"with-assistant"` and closes the source comparison pane
- **AND** closing the Assistant returns to `"focused"` without losing Study Mode activity state.

### Requirement: Exact Return to Reading and Reader Panel Coordination
Entering Study Mode SHALL capture canonical reader state (locator/CFI, PDF page/zoom/scroll, media timestamp, prior Assistant visibility) and suspend competing reader panels (`GuidedReadingPanel`, floating reader chrome). Exiting Study Mode SHALL restore the prior reading position unless the user explicitly navigated to a cited passage.

#### Scenario: Exiting Study Mode restores reading position
- **GIVEN** a user is at chapter 3 of an EPUB or page 14 at 125% zoom of a PDF
- **WHEN** the user enters Study Mode, studies, and clicks Back to Reading
- **THEN** the reader returns to the exact prior reading position and zoom without jumping to the beginning of the document.

### Requirement: Redesigned Learn, Practice, Explore, and Progress Activities
Study Mode SHALL organize its workspace into `Learn`, `Practice`, `Explore`, and `Progress` destinations with descriptive activity cards, dedicated activity views (including interactive concept map, dedicated timeline view, audio lesson player, and slide deck), and zero automatic AI generation on tab visit.

#### Scenario: Learn presents structured learning activities without clutter
- **GIVEN** the user opens the `Learn` destination
- **WHEN** no learning materials have been generated yet
- **THEN** the user sees descriptive activity cards (Explain, Summarize, Worked Examples, Common Misconceptions, Memory Aids, Socratic Tutor)
- **AND** no AI generation runs until the user explicitly triggers an activity.
