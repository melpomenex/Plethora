## ADDED Requirements

### Requirement: Double-tap commits authoritative paragraph selection
When the reader recognizes a double-tap paragraph gesture, the system SHALL immediately commit a `ReadySelection` snapshot built from the target paragraph element without waiting for live DOM settle.

#### Scenario: Paragraph snapshot on double-tap
- **WHEN** the user double-taps a paragraph in the reader content
- **THEN** the selection controller enters `ready` with the full paragraph text, fingerprint, and `gestureOrigin: "double-tap"`

#### Scenario: Sequential actions use committed paragraph
- **WHEN** the user double-taps a paragraph, runs Summarize, then runs Extract while native DOM selection may show one word
- **THEN** both actions receive the full committed paragraph text from `captureForAction()`

### Requirement: Native word-selection fallout cannot replace committed double-tap selection
The system SHALL prevent browser native double-tap word selection from demoting or dismissing a committed double-tap paragraph selection for the same gesture.

#### Scenario: Native selectionchange after double-tap
- **WHEN** a double-tap paragraph selection is committed and a subsequent `selectionchange` collapses live DOM selection to one word from the same gesture
- **THEN** `readySelection` remains the full paragraph and the action bar continues to show paragraph text

#### Scenario: New user selection replaces double-tap selection
- **WHEN** the user performs a genuinely new selection gesture (long-press drag, new tap elsewhere)
- **THEN** the committed double-tap selection is replaced by the new selection per normal machine rules

### Requirement: Double-tap touch listener allows preventDefault
Double-tap detection `touchstart` listeners SHALL be registered with `passive: false` so `preventDefault()` can suppress native double-tap word selection.

#### Scenario: preventDefault effective on second tap
- **WHEN** the second tap of a double-tap is recognized on a paragraph
- **THEN** `preventDefault()` is called on a cancelable event and native word selection is suppressed where the platform supports it

### Requirement: EPUB iframe double-tap parity
Double-tap paragraph authority SHALL work in iframe content documents via the content-document bridge adapter.

#### Scenario: Iframe paragraph double-tap
- **WHEN** the user double-taps a paragraph inside an EPUB iframe
- **THEN** the committed selection contains the full iframe paragraph text with correct reader context

### Requirement: Manual selection gestures unaffected
Long-press, drag-to-adjust, desktop double-click, and Android selection handles SHALL continue to function without regression.

#### Scenario: Long-press manual selection
- **WHEN** the user long-presses and drags selection handles
- **THEN** selection follows live DOM adjustment and settles normally without forced paragraph commit
