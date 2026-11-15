# Specification: Unified Session Chrome, Provenance & Split-Sheet Extraction

## ADDED Requirements

### Requirement: Interleaved session header and action dock keep invariant viewport coordinates across item types

The system SHALL render a unified `[data-queue-header]` top bar (fixed `48px` height, anchored at `top: 12px`) and `[data-rating-dock]` bottom dock (minimum height `56px`, anchored at `bottom: 24px`) via shared session chrome primitives across Flashcard review (`FlashcardScrollItem`), Extract review (`ExtractScrollItem`), Document views (`DocumentViewer` for PDF/EPUB/HTML/Markdown), and YouTube/video views (`YouTubeViewer`) inside `QueueScrollPage`. Navigating between different `ScrollItem` types MUST NOT shift header height, header vertical offset, or bottom dock coordinates, and scrollable content SHALL reserve deterministic top/bottom safe padding so controls never overlap content.

#### Scenario: Stepping from a flashcard to a PDF document keeps header and dock coordinates invariant
- **GIVEN** an interleaved queue session containing a `flashcard` item followed by a `document` PDF item
- **WHEN** the user finishes rating the flashcard and advances to the PDF document in `QueueScrollPage`
- **THEN** `[data-queue-header]` retains its `48px` height and top coordinate without vertical jump
- **AND** `[data-rating-dock]` remains anchored at `bottom-6` with no layout reflow of the chrome container

#### Scenario: Stepping from an extract to a YouTube item preserves docked chrome separation
- **GIVEN** an active queue session displaying an `extract` item
- **WHEN** the user advances to a `video-extract` or YouTube document item
- **THEN** item-specific controls render strictly inside the content safe area rather than displacing `[data-queue-header]` or `[data-rating-dock]`

---

### Requirement: Queue Provenance Pill surfaces scheduling rationale and 1-click overrides

The system SHALL display an interactive `QueueProvenancePill` inside `[data-queue-header]` summarizing *why* the active `ScrollItem` was scheduled: the active scheduling source (`Pinned: Strict Manual` when `queueOrderingSettings` is `"strict_manual"`, or `Due via <Algorithm>` / `Adaptive DAQE` using `FSRS-7`, `SM-20`, `SM-18`, or `SM-2`), the resolved display priority (`Priority <1-100>`), and priority inheritance provenance (`Inherited from <Document Title>` when `!item.priorityExplicitlySet` and a parent title exists, or `Explicit Priority` otherwise). Activating the pill SHALL open a popover (`[data-provenance-popover]`) providing 1-click **Snooze** (`1d`, `3d`, `7d`), **Reprioritize** slider/steps via `dispatchPriorityCommit`, and **Ordering Mode** switch (`Adaptive` <-> `Strict Manual`).

#### Scenario: Inherited FSRS-7 extract shows algorithm, priority, and parent provenance
- **GIVEN** an extract queue item scheduled under `adaptive` ordering with `algorithmType = "fsrs"`, `priorityDisplaySlider = 12`, `priorityExplicitlySet = false`, and `documentTitle = "Distributed Systems"`
- **WHEN** the item becomes active in `QueueScrollPage`
- **THEN** `QueueProvenancePill` displays `Due via FSRS-7 • Priority 12 • Inherited from Distributed Systems`

#### Scenario: Strict Manual mode shows pinned badge and allows 1-click switch to Adaptive
- **GIVEN** the user's queue ordering mode is `strict_manual` and `QueueProvenancePill` shows `Pinned: Strict Manual`
- **WHEN** the user clicks the pill to open `[data-provenance-popover]` and selects `Switch to Adaptive`
- **THEN** `setQueueOrderingMode("adaptive")` is called, the badge updates to the adaptive scheduling reason, and no FSRS/SM card parameters are altered

#### Scenario: Popover snooze and reprioritize actions mutate item scheduling cleanly
- **GIVEN** `[data-provenance-popover]` is open on the current queue item
- **WHEN** the user clicks `Snooze 3d` or adjusts the priority slider to `18`
- **THEN** the postpone handler (`3` days) or `dispatchPriorityCommit` (`slider: 18`) executes, the popover reflects the updated priority, and invalid slider values outside `[1, 100]` are clamped

---

### Requirement: End-of-Item Micro-Triage Bar enables keyboard-first extract and media triage

The system SHALL render `EndOfItemTriageBar` above `[data-rating-dock]` on extract and document/media review views, exposing visual hotkey badges and keyboard bindings when focus is outside editable elements (`INPUT`, `TEXTAREA`, `[contenteditable="true"]`, `.ProseMirror`): `[Space]` advances to the next queue item, `[E]` triggers extract creation from the active selection (or quick-extract hook), `[Q]` opens the docked `QACreatorPopup` split-sheet, `[D]` archives/marks the current item done, and `[P]` opens/focuses inline priority editing.

#### Scenario: Keyboard triage actions dispatch extract, Q&A, archive, and advance cleanly
- **GIVEN** an active `ExtractScrollItem` with no text input focused
- **WHEN** the user presses `q`, then closes the split-sheet and presses `d`, or presses `Space`
- **THEN** pressing `q` invokes `onCreateQA`, pressing `d` invokes `onArchive` (dismiss/archive), and pressing `Space` invokes `onNext`

#### Scenario: Editable element focus blocks single-key triage shortcuts
- **GIVEN** the user's cursor is focused inside a `<textarea>` or `[contenteditable="true"]` note editor
- **WHEN** the user types `e`, `q`, `d`, `p`, or `Space`
- **THEN** `EndOfItemTriageBar` ignores all five shortcuts and allows the character/space to be entered into the active input

---

### Requirement: QACreatorPopup and ClozeCreatorPopup operate as non-modal split-sheets by default

`QACreatorPopup` and `ClozeCreatorPopup` SHALL accept a `mode?: "docked" | "modal"` prop (defaulting to `"docked"` in `QueueScrollPage` and `DocumentViewer`, toggled open/closed via `Cmd/Ctrl+Shift+Q`). In `"docked"` mode, the component SHALL render inside a non-blocking right slide-over or bottom split-sheet container without a full-screen blocking backdrop (`pointer-events-none` wrapper with `pointer-events-auto` sheet only), isolating form input focus and `keydown` propagation while permitting simultaneous scrolling and secondary text selection in the parent document viewer, and offering a 1-click **Insert Current Selection** action to paste newly highlighted parent text into the Question or Answer field.

#### Scenario: Docked split-sheet allows scrolling and grabbing a second highlight from parent viewer
- **GIVEN** the user opens `QACreatorPopup` with `mode="docked"` from `QueueScrollPage` or `DocumentViewer` via `Cmd+Shift+Q`
- **WHEN** the user scrolls the parent document underneath/beside the sheet and highlights a second sentence, then clicks `Insert Selection into Answer`
- **THEN** no modal backdrop intercepts wheel/scroll or text selection events in the parent viewer
- **AND** the newly selected text is appended to the Answer field while keeping the existing Question draft intact

#### Scenario: Typing triage hotkeys inside docked Q&A form does not trigger queue shortcuts
- **GIVEN** `QACreatorPopup` is open in `"docked"` mode and focus is inside the Question `<textarea>`
- **WHEN** the user types characters including `e`, `q`, `d`, `p`, and `Space`
- **THEN** `stopPropagation()` prevents parent queue or viewer key handlers from navigating away or opening duplicate popups

---

### Requirement: Selection toolbar displays inherited priority, supports inline nudging, and performs 1-keystroke Chained Cloze

`SelectionActionBar` SHALL display an inline inheritance chip (`P<slider> • Inherited from <Parent Title>` or `P<slider> • Explicit`) computed from the active document/extract priority. Supporting hooks (`useToastExtract`, `useInlineExtraction`) SHALL support `Shift+Wheel` on the selection chip and `ArrowUp`/`ArrowDown` within a 4-second interactive window after extract creation to nudge the new extract's priority by $\pm 5\%$ steps (clamped to `[1, 100]`) via `dispatchPriorityCommit`. Pressing the Chained Cloze trigger (`[C]` on `SelectionActionBar` or `Alt+Z` / `Cmd+Shift+C`) SHALL create a child extract AND generate its cloze flashcard in the background without opening a modal, apply the `.animate-flash-extract-green` pulse on the highlight, and preserve the user's scroll position and selection range bounds in the parent viewer.

#### Scenario: Nudging priority via ArrowUp/Down immediately after extract creation
- **GIVEN** a document with `priorityDisplaySlider = 20` and a newly created child extract whose toast confirmation window (`4000ms`) is active
- **WHEN** the user presses `ArrowUp` once (or scrolls up with `Shift+Wheel`)
- **THEN** the target extract priority decreases numerically (higher urgency) by `-5` slider points to `15`, calls `dispatchPriorityCommit`, and updates the inline HUD/toast badge to `Priority 15 (-5%)`

#### Scenario: 1-keystroke Chained Cloze creates extract and card without moving scroll or focus
- **GIVEN** the user has selected `"monotonic clock drift"` inside `DocumentViewer` at `scrollTop = 1420`
- **WHEN** the user triggers Chained Cloze (`[C]` button or `Alt+Z`)
- **THEN** a child extract and linked cloze flashcard (`{{c1::monotonic clock drift}}`) are persisted in the background
- **AND** no blocking modal opens, the green pulse highlight feedback renders, and parent `scrollTop` remains `1420`
