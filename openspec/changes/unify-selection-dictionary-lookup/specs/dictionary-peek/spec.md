# Spec Delta: dictionary-peek

## ADDED Requirements

### Requirement: Auto-open on single-word settle
When a settled selection on a supported reading surface resolves to a single lexical word and the dictionary-peek feature flag is enabled, the system SHALL present a compact Dictionary Peek automatically — without requiring the user to first open a generic action sheet — and SHALL provide subtle haptic feedback on supported devices when the presentation opens.

#### Scenario: Long-press and release on one word in the Queue
- **WHEN** a user long-presses a single word in a Queue Scroll Mode item and releases without extending the selection
- **THEN** the Dictionary Peek opens automatically over the current reading surface and a subtle haptic fires on devices with haptics support

#### Scenario: Haptics failure is non-blocking
- **WHEN** the haptics subsystem is unavailable or fails
- **THEN** the Dictionary Peek still opens and no error is surfaced

#### Scenario: Feature flag off keeps explicit paths
- **WHEN** the dictionary-peek flag is disabled and a single word is selected
- **THEN** no automatic peek opens, but dictionary remains available from the selection action sheet row and context menu

### Requirement: Peek content and performance
The Dictionary Peek SHALL open its shell immediately, then render the word, pronunciation/phonetic information and part of speech where the provider supplies them, the primary concise definition, and synonyms as secondary content. The peek MUST NOT block its shell on network requests, LLM inference, flashcard infrastructure, or pronunciation audio.

#### Scenario: Shell before data
- **WHEN** the peek opens and the definition has not resolved yet
- **THEN** the peek shell with the selected word is visible immediately in a lightweight loading state

#### Scenario: Provider metadata rendered
- **WHEN** the dictionary provider returns phonetics and part-of-speech data for the looked-up word
- **THEN** the peek shows the word, phonetic transcription, part of speech, and the primary definition

### Requirement: Dictionary independence from LLM
Dictionary lookup MUST NOT depend on LLM availability: the standard definition path SHALL work with AI features disabled, without an API key, and offline when the entry is already cached. The context-aware explanation SHALL be an optional, asynchronous enhancement that never blocks or gates the definition.

#### Scenario: AI features disabled
- **WHEN** the user has disabled all AI features and looks up a word
- **THEN** the peek shows the standard definition and secondary actions, with no contextual explanation section

#### Scenario: Slow contextual explanation
- **WHEN** the contextual explanation request is still in flight or fails
- **THEN** the definition is fully usable, the explanation section shows its own lightweight loading or failure state, and the peek is not blocked

### Requirement: Dismissal and selection persistence
The Dictionary Peek SHALL be dismissible by tapping outside it, by deliberate content scroll, by Escape on desktop, and by the platform back/swipe gesture on mobile. While open, the peek SHALL keep the selected word visibly highlighted, preserve scroll position and reading settings, and on touch devices the system MUST NOT clear the native selection as a side effect of presentation or dismissal.

#### Scenario: Dismiss returns to the exact reading position
- **WHEN** the user dismisses the peek after it opens over a Queue item
- **THEN** the reader is at the same scroll position with the same zoom/reflow settings and the current item still mounted

#### Scenario: Android native selection survives dismissal
- **WHEN** the peek is dismissed on a touch device where the native selection survives
- **THEN** dismissal uses text-keyed suppression and does not call `removeAllRanges` on the live selection

### Requirement: Reading continuity and queue lifecycle safety
Opening, using, or dismissing the Dictionary Peek MUST NOT navigate away from the reader, unmount or reset the reading surface, mutate queue state (complete, rate, advance, dismiss, postpone, reschedule), or trigger review completion. Dictionary interaction SHALL be a non-destructive reading interaction; the only persistent side effects SHALL come from explicit user actions (creating an extract, flashcard, or vocabulary entry).

#### Scenario: Queue state unchanged by lookup
- **WHEN** a dictionary lookup round-trip (open, load, dismiss) occurs inside a Queue Scroll Mode item
- **THEN** the queue store state, scheduling data, and current item are unchanged and the queue has not advanced

### Requirement: Cached and normalized dictionary service
The dictionary service SHALL normalize the query word through the shared intent resolver before querying, SHALL cache entries so repeated lookups of the same word do not repeat network work, and SHALL serve cached entries when offline.

#### Scenario: Punctuated selection queries the normalized word
- **WHEN** the user selects `"ephemeral,"` and the dictionary action runs
- **THEN** the service queries the normalized word `ephemeral`, not the raw selected text

#### Scenario: Repeat lookup served from cache
- **WHEN** the same word is looked up a second time in a session
- **THEN** the result resolves from the local cache without a repeated provider request, including when the device is offline

### Requirement: Failure states
When the dictionary provider returns no entry, is unreachable, or the word is not cached while offline, the peek SHALL display a lightweight explicit failure state naming the word and offer applicable fallback actions (such as Explain, Copy, or manual flashcard creation). The UI MUST NOT spin indefinitely or fail silently.

#### Scenario: No dictionary entry found
- **WHEN** the provider returns no entry for the queried word
- **THEN** the peek shows a "No dictionary entry found for '<word>'" state with fallback actions

#### Scenario: Provider unreachable
- **WHEN** the provider request fails due to network error
- **THEN** the peek shows an unavailable state distinct from not-found, with retry or fallback actions

### Requirement: Pronounce action
The peek SHALL offer a Pronounce action that speaks the selected word through the application's existing TTS infrastructure, and the implementation MUST NOT introduce a separate speech system for the dictionary.

#### Scenario: Pronounce speaks the word
- **WHEN** the user activates Pronounce in the peek
- **THEN** the word is spoken via the existing TTS pipeline

### Requirement: Extract action with provenance
The peek SHALL offer an Extract action that creates an extract combining the word and its definition, preserving source document, source location via the existing selection-context anchoring (EPUB CFI, PDF canonical anchors, or text offsets), and original selected word.

#### Scenario: Extract from dictionary
- **WHEN** the user activates Extract on a word looked up in an EPUB
- **THEN** an extract is created with the word/definition content, the source document, and the EPUB CFI selection context of the original word

### Requirement: Low-friction flashcard action
The peek SHALL offer a Flashcard action that creates a vocabulary card programmatically — word as the front, definition as the back, original sentence/passage preserved as context, source metadata attached — without forcing a modal editor, and SHALL confirm with a lightweight toast offering Undo where item deletion is supported.

#### Scenario: One-tap flashcard creation
- **WHEN** the user activates Flashcard in the peek
- **THEN** a vocabulary card is created with word, definition, passage context, and source metadata, and a small confirmation toast is shown, all without opening a full-screen editor

### Requirement: Path to full selection actions
The peek SHALL provide a More affordance leading to the standard selection action surface (context menu or selection action sheet), and the selection action sheet SHALL include an explicit Dictionary action so dictionary is reachable for multi-word selections and via keyboard/screen-reader flows.

#### Scenario: More opens standard actions
- **WHEN** the user activates More in the peek
- **THEN** the host's standard selection action surface opens for the same selection

#### Scenario: Dictionary row in the action sheet
- **WHEN** the user opens the selection action sheet for any selection on a supported surface
- **THEN** a Dictionary action is present and opens the peek using the shared resolver

### Requirement: Platform-adaptive presentation
The peek SHALL present as an anchored popover near the selection on desktop, a compact anchored card on mobile that avoids covering the selection, and SHALL adapt to e-ink mode by disabling animations and translucent effects and preferring instant state changes — using a single shared implementation with adaptive presentation, not separate dictionary UIs.

#### Scenario: E-ink mode presentation
- **WHEN** the device is in e-ink display mode and the peek opens
- **THEN** the peek appears without animation-heavy transitions or large translucent overlays

### Requirement: Accessibility
The peek SHALL expose accessible labels and semantic button names, support dismissal via keyboard (including Escape), maintain meaningful focus order without trapping focus, and dictionary SHALL remain invocable through non-long-press paths (selection action sheet row and context menu).

#### Scenario: Keyboard dismissal
- **WHEN** the peek has focus on desktop and the user presses Escape
- **THEN** the peek closes and focus returns to the reading surface

#### Scenario: Screen-reader invocation path
- **WHEN** a user cannot perform a long-press and uses the selection action sheet
- **THEN** the Dictionary action is exposed with an accessible name and opens the same peek
