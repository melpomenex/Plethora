## ADDED Requirements

### Requirement: Selection UI suppressed during active selection adjustment
While the user is actively creating or adjusting a text selection in any reader surface (dragging selection handles, extending or shrinking the range, long-press selecting), the system SHALL NOT display Incrementum's contextual action UI. The suppression SHALL apply from the first selection-change event of a gesture until the selection settles, SHALL be re-established immediately if the user resumes adjusting a completed selection, and SHALL NOT obscure the selected passage or the native selection handles. The system SHALL NOT collapse the native selection, steal focus, or trigger any selection action during this phase.

#### Scenario: Handle drag keeps UI hidden
- **WHEN** a touch user long-presses to create a selection and drags the start or end handle, producing continuous selection-change events
- **THEN** no Incrementum action sheet, action bar, scrim, or menu SHALL be visible while the selection keeps changing

#### Scenario: Repeated adjustments stay suppressed
- **WHEN** the user adjusts the right handle, pauses, then adjusts the left handle, repeatedly changing the selection
- **THEN** Incrementum's action UI SHALL remain hidden or be immediately re-hidden on each new selection change or content touch, until the selection settles after the final adjustment

#### Scenario: Resuming adjustment hides visible action UI
- **WHEN** an action UI is visible for a completed selection and the user begins moving a selection handle again
- **THEN** the action UI SHALL disappear immediately, and reappear only after the updated selection settles, positioned for the updated selection geometry

#### Scenario: Native selection is never collapsed by the UI
- **WHEN** Incrementum shows, hides, or repositions its selection UI during touch interaction
- **THEN** the system SHALL NOT programmatically clear the native selection on touch platforms, and native selection handles, magnifier, and system copy functionality SHALL remain available

### Requirement: Action UI appears after the selection settles
The system SHALL surface Incrementum's contextual action UI only after it can determine the selection interaction has ended: no active touch or pointer on the content AND a stable selection range. Stability SHALL be detected from selection-release signals (touch/pointer end plus range-identity stability over a bounded window), not from a fixed visual delay. On desktop, mouse selection SHALL surface actions at mouse-up with equivalent semantics.

#### Scenario: Touch selection surfaces after release
- **WHEN** a touch user releases the selection handles and the selection range remains unchanged for the stability window with no finger down
- **THEN** the action UI SHALL become visible promptly

#### Scenario: Desktop mouse selection
- **WHEN** a desktop user drags a mouse selection and releases the button
- **THEN** the action UI SHALL appear with no artificial additional delay, and SHALL not have interfered with the active drag

#### Scenario: System-consumed gesture does not wedge detection
- **WHEN** the platform swallows touch-end events for a native selection gesture
- **THEN** the system SHALL bound its deferral so detection still completes or resets without an infinite wait

### Requirement: Viewport-safe anchored placement of the action UI
When Incrementum's touch action UI appears, it SHALL be positioned relative to the actual selection geometry: above the selection when space allows, below when it does not, otherwise in the nearest safe viewport region. The UI SHALL remain fully inside the visible viewport at all times, accounting for visual-viewport behavior, scroll position, page zoom, safe-area insets, Android navigation/gesture areas, virtual keyboard, iframe offsets (EPUB content), and reflow-container offsets. It SHALL NOT be centered over the selected passage, and SHALL NOT cover the passage or its handles when any alternative placement exists.

#### Scenario: Selection near viewport top
- **WHEN** the settled selection is near the top of the viewport with insufficient room above
- **THEN** the action UI SHALL be placed below the selection and remain fully visible

#### Scenario: Selection near viewport edges and bottom
- **WHEN** the settled selection touches the left/right edges or the bottom of the viewport
- **THEN** the action UI SHALL be clamped inside the viewport with safe-area insets respected and SHALL not cover the selection's visible handles

#### Scenario: EPUB iframe coordinates
- **WHEN** a selection settles inside EPUB iframe content
- **THEN** placement SHALL use selection geometry transformed from iframe coordinates into the app viewport, remaining correct under scrolled and paginated EPUB modes and after font-size changes

#### Scenario: Tall or multi-line selection
- **WHEN** the selection spans many lines or extends beyond the viewport
- **THEN** the action UI SHALL anchor to a visible portion of the selection and remain inside the viewport

#### Scenario: Narrow viewport action layout
- **WHEN** the viewport is narrow (Boox Palma 2-class) and not all actions fit
- **THEN** the action UI SHALL present a compact, horizontally scrollable set of primary actions with lower-priority actions in an overflow control, without covering half the selected passage

### Requirement: One selection interaction model across reader surfaces
Selection-phase behavior (suppression, settle detection, re-hide on adjustment, placement, invalidation) SHALL be provided by a single shared selection-interaction abstraction used by EPUB (scrolled and paginated), reflowed PDF, native/fixed PDF, markdown, HTML-iframe, and OCR-HTML reader surfaces, with surface-specific adapters limited to event sourcing and coordinate transformation. The behavior SHALL be equivalent across surfaces, and a selection interaction SHALL be invalidated when its reading context ends (EPUB chapter/page transition, document switch, reflow relayout or typography change that invalidates geometry).

#### Scenario: Reflowed PDF selection lifecycle
- **WHEN** the user selects text in a reflowed PDF across multiple blocks or spanning headings, paragraphs, figures, or page-boundary blocks
- **THEN** suppression, settle, placement, and action capture SHALL behave identically to other surfaces, with geometry from the reflowed representation and validity maintained across reflow font/width changes

#### Scenario: EPUB page turn invalidates stale selection UI
- **WHEN** the user navigates to another EPUB chapter or page while selection action UI is visible or an anchored placement exists
- **THEN** the stale selection UI SHALL be dismissed and no action SHALL remain anchored to the previous page's geometry

#### Scenario: Reflow typography change invalidates geometry
- **WHEN** the user changes reflow font size, line height, or width while action UI is anchored
- **THEN** the anchored UI SHALL be repositioned from fresh geometry or dismissed; it SHALL NOT remain at stale coordinates

### Requirement: Scroll coexistence with selection UI
While no action is running, a content scroll SHALL dismiss or reposition the anchored action UI without flicker or repeated show/hide cycles, using throttled geometry recomputation. Geometry recomputation SHALL NOT perform layout reads on every raw selection-change event, and the implementation SHALL NOT introduce persistent polling to detect selection completion.

#### Scenario: Scroll after selection
- **WHEN** the user scrolls the document after the action UI appears and before invoking an action
- **THEN** the action UI SHALL be dismissed or smoothly repositioned at most once per animation frame, without uncovering the selection or thrashing

#### Scenario: Event discipline during handle drags
- **WHEN** selection-change events fire continuously during handle manipulation
- **THEN** per-event work SHALL be limited to cheap state comparison with no synchronous layout measurement and no React re-render per event

### Requirement: E-ink and reduced-motion discipline
On e-ink displays or when reduced-motion is active, the selection interaction SHALL avoid animations, repeated open/close cycles, continuous movement, and rapid repositioning. State communication SHALL NOT depend on high-refresh animation, and placement changes SHALL be stable single-step layout changes.

#### Scenario: E-ink selection flow
- **WHEN** a user on an e-ink device completes a selection, invokes an action, and views the result
- **THEN** the UI transitions without animation-dependent feedback and without unnecessary repaints or reposition loops

### Requirement: Desktop and accessibility parity
Selection interaction SHALL remain fully operable on desktop (mouse and keyboard) and accessible: action controls keyboard-focusable with meaningful labels, Escape dismisses, focus is restored sensibly after closing any selection UI, loading states expose accessible state, and touch targets meet minimum size. Existing desktop reader behavior and keyboard interactions SHALL be preserved.

#### Scenario: Keyboard dismissal and focus return
- **WHEN** a selection action UI is open and the user presses Escape
- **THEN** the UI closes and focus returns to the reader container rather than being lost

#### Scenario: Desktop regression safety
- **WHEN** the shared interaction model is active for desktop mouse selection and right-click menus across EPUB, reflowed PDF, and fixed-layout PDF
- **THEN** existing desktop selection features (highlight popup, context menu actions, copy) continue to function with correct selected text
