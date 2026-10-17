## MODIFIED Requirements

### Requirement: Ask opens a bottom-sheet composer with a context chip

Tapping Ask SHALL prepare a canonical conversation in the existing global mobile Assistant host, with the captured passage/source chip, question input, visible dictation affordance, optional contextual suggestions and secondary source controls. It SHALL not open a competing second Assistant dialog. The passage SHALL be editable/removable with original provenance retained; removing it SHALL reveal the underlying document/context policy without overriding an explicit strict restriction. Opening SHALL not force the keyboard. The compact mobile composer, command/attachment menu and other legitimate selection actions SHALL remain accessible.

#### Scenario: Composer opens with selected passage as context
- **GIVEN** text is selected in a mobile reader
- **WHEN** the user taps Ask
- **THEN** the existing Assistant sheet opens with the captured quote and source visible in a canonical thread
- **AND** no additional AI dialog or automatic question submission occurs

#### Scenario: Context chip can be edited or removed
- **GIVEN** a passage is attached with a document underneath it
- **WHEN** the user edits the chip
- **THEN** the original and edited provenance are retained honestly
- **WHEN** the user removes it
- **THEN** the underlying policy applies and the removed passage is not silently restored

#### Scenario: Voice input is available without typing
- **GIVEN** the sheet composer is open on a platform with or without app speech capability
- **WHEN** the user inspects the input controls
- **THEN** dictation availability and its limitation/fallback are visible
- **AND** the keyboard opens only after deliberate input interaction

### Requirement: Answers render as docked cards over the document

Selection answers SHALL be presented as turns in the canonical mobile conversation, with a compact bottom-docked/partial presentation that retains the reading material above and an expanded conversation presentation for longer answers, citations and actions. Partial mode SHALL allow interaction with the visible reader where available; expanded mode SHALL own modal focus and dismissal. A constrained viewport SHALL use an accessible expanded-only fallback. Dismissing the presentation SHALL preserve the thread/draft and return focus and reading state appropriately. Dragging SHALL remain confined to existing sheet handles and invocation affordances.

#### Scenario: Answer does not navigate away from the document
- **GIVEN** a selection question is generating over a reader with sufficient visible area
- **WHEN** its answer is ready in partial mode
- **THEN** the canonical answer appears docked and the exposed reader remains scrollable and operable
- **AND** there is no duplicate ephemeral answer store

#### Scenario: Card expands and dismisses with gestures
- **GIVEN** the answer is in partial mode
- **WHEN** the user expands using the handle or accessible button
- **THEN** full conversation, source details and actions appear with modal focus ownership
- **WHEN** the user collapses or closes through supported controls/handle
- **THEN** the reader becomes operable again and conversation/draft state remains saved

#### Scenario: Small viewport or keyboard
- **GIVEN** partial mode cannot retain a usable reading/composer area
- **WHEN** keyboard, safe area or enlarged text reduces the viewport
- **THEN** expanded-only mode keeps input/send/close reachable and explains state accessibly
- **AND** keyboard dismissal restores the prior usable detent where supported

## ADDED Requirements

### Requirement: Mobile invocation and input preserve native navigation

Assistant invocation SHALL retain deliberate affordance-local gestures, deduplicated existing haptic policy and accessible tap controls. It SHALL not capture Android edge Back or the app's established swipe-to-go-back gesture. Overlay priority, fullscreen/review suppression, safe areas, foreground changes and focus restoration SHALL remain enforced. Dictation SHALL insert once into an unchanged draft, obey permissions/local-only policy, expose recording/stop and never submit automatically. Typing and keyboard dictation SHALL remain available on unsupported/denied speech paths.

#### Scenario: Native Back remains owned by navigation
- **GIVEN** the sheet is closed and the reader supports system/app back navigation
- **WHEN** the user performs the existing edge Back or swipe-to-go-back gesture
- **THEN** navigation behaves as before and Assistant does not invoke
- **AND** when Assistant is open an applicable Back dismisses the highest owned overlay before navigating

#### Scenario: Dictate then edit before sending
- **GIVEN** a draft is present and permitted dictation is available
- **WHEN** the user starts, stops and edits the inserted transcript
- **THEN** text is inserted once at the saved selection and no request is submitted until Send
- **AND** cancellation, denied permission, unavailable on-device processing or a late duplicate callback preserves a usable draft with typing recovery
