# mobile-ask-sheet Specification

## Purpose

Gives mobile readers a fast, uncluttered way to ask questions about what they're reading: selecting text surfaces one primary Ask action, and asking happens in a bottom-sheet composer with answers delivered as docked cards that never take the user away from the document.

## ADDED Requirements

### Requirement: Selection surfaces a single primary Ask action on mobile

On mobile viewports, selecting text in a reader SHALL surface a floating action with exactly one primary action, Ask. All other selection actions SHALL be reachable through an overflow control, never requiring horizontal scrolling to reach Ask.

#### Scenario: Ask is reachable without scrolling

- **WHEN** the user selects text in the document reader on a mobile viewport
- **THEN** an Ask action is visible immediately without scrolling the action menu

#### Scenario: Other actions remain available via overflow

- **WHEN** the user opens the overflow control on the selection action menu
- **THEN** the remaining selection actions (e.g. copy, highlight, extract) are listed

### Requirement: Ask opens a bottom-sheet composer with a context chip

Tapping Ask SHALL open a bottom sheet containing: the selected passage rendered as a context chip, a scope picker, a question input with voice input, and suggested questions. The context chip SHALL be tappable to edit the passage text and SHALL offer a remove control; removing the chip SHALL fall back to the current document scope.

#### Scenario: Composer opens with selected passage as context

- **WHEN** the user taps Ask with text selected
- **THEN** the bottom sheet opens with the selected passage shown as a context chip

#### Scenario: Context chip can be edited or removed

- **WHEN** the user taps the context chip
- **THEN** the passage text becomes editable
- **WHEN** the user removes the context chip
- **THEN** the composer scope falls back to the current document

#### Scenario: Voice input is available without typing

- **WHEN** the bottom-sheet composer is open
- **THEN** a voice input control is visible alongside the text input
- **AND** the on-screen keyboard is not forced open until the user focuses the text field

### Requirement: No-selection entry point asks about the visible page

The reader SHALL offer an "Ask about this page" entry point that needs no text selection. Invoking it SHALL open the composer with the currently visible section as the context.

#### Scenario: Asking without selecting text

- **WHEN** the user invokes "Ask about this page" while reading
- **THEN** the composer opens with the visible section as context
- **AND** no text selection is required

### Requirement: Answers render as docked cards over the document

Answers SHALL appear as cards docked to the bottom of the reader, with the document remaining visible and scrollable above the card. A collapsed card SHALL show the answer summary; expanding the card SHALL reveal the full answer, source citations, and actions. The user SHALL be able to dismiss the card with a downward swipe or a close control, returning to the uninterrupted document.

#### Scenario: Answer does not navigate away from the document

- **WHEN** an answer is ready
- **THEN** it appears as a bottom-docked card
- **AND** the document remains visible above the card

#### Scenario: Card expands and dismisses with gestures

- **WHEN** the user swipes up on a collapsed answer card
- **THEN** the card expands to show the full answer, sources, and actions
- **WHEN** the user swipes down on or closes the card
- **THEN** the card dismisses and the document returns to full height

### Requirement: Answer cards offer flashcard, read-aloud, and copy actions

Each answer card SHALL offer: Make flashcard, Read aloud, and Copy. Make flashcard SHALL create a flashcard carrying the answer and its source citations. Read aloud SHALL speak the answer via text-to-speech. The card SHALL also show follow-up suggestion chips; tapping a chip SHALL submit that follow-up as the next question without opening the keyboard.

#### Scenario: Answer becomes a flashcard in one tap

- **WHEN** the user taps Make flashcard on an answer card
- **THEN** a flashcard is created containing the question, the answer, and the source citations

#### Scenario: Follow-up chips continue the conversation

- **WHEN** the user taps a follow-up suggestion chip on an answer card
- **THEN** the follow-up is submitted as the next question
- **AND** the on-screen keyboard is not opened
