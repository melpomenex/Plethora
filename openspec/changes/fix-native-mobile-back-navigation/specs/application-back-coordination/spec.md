## Purpose

Coordinate all supported application Back inputs through visible-layer ownership, data-preserving guards and workspace traversal, with accessible controls and optional completion feedback.

## ADDED Requirements

### Requirement: Back consumes the highest eligible visual layer
Back SHALL dismiss or act on the highest eligible visible overlay before active contextual hierarchy, then workspace history, then safe root fallback. A pending or non-dismissible top layer SHALL consume Back without navigating underlying content. Each input SHALL change at most one logical layer; dismissal SHALL preserve any existing data-loss guard.

#### Scenario: Dialog above a document
- **WHEN** Back is requested while a dismissible dialog is above a document
- **THEN** only the dialog SHALL close and the document/history SHALL remain unchanged

#### Scenario: Nested overlays
- **GIVEN** a menu, child popover and modal are stacked
- **WHEN** Back is requested
- **THEN** only the top visible eligible surface SHALL respond
- **AND** another input during its closing interval SHALL NOT navigate underlying content

#### Scenario: Non-dismissible or failing overlay
- **WHEN** the top surface blocks dismissal or its dismissal handler fails
- **THEN** Back SHALL be consumed safely without activating a previous workspace tab

### Requirement: Only the active owning view consumes contextual Back
Mounted hidden tabs SHALL NOT consume contextual Back or view-owned overlay dismissal. Split-pane global Back SHALL resolve the currently visible navigation-owning pane, with deterministic fallback if focus ownership disappears. Eligibility SHALL reflect current workspace state even before a visibility-render update completes.

#### Scenario: Settings mounted but inactive
- **GIVEN** Settings remains mounted after Document becomes active
- **WHEN** Back is requested from Document
- **THEN** Settings SHALL NOT consume the input, change its hierarchy or open a discard prompt
- **AND** Document's eligible context/history SHALL handle it

#### Scenario: Rapid activation before React effects
- **WHEN** another view is activated and Back immediately follows before old registration cleanup
- **THEN** the old view SHALL not intercept the action

#### Scenario: Wide tablet with two visible panes
- **WHEN** global Back is requested after interaction with a visible pane
- **THEN** only that pane's contextual hierarchy/history SHALL handle it
- **AND** a hidden Settings tab in either pane SHALL not interfere

### Requirement: Existing Podcast hierarchy shares application Back
Podcast Back SHALL follow its existing player-view to selected-feed to feed-list hierarchy before workspace history, using the same overlay priority and active-view eligibility as other features. It SHALL not own a parallel native Back listener.

#### Scenario: Podcast local Back and overlay precedence
- **GIVEN** a Podcast episode view is active beneath a dialog
- **WHEN** Back is invoked twice after each action settles
- **THEN** the dialog SHALL respond first and the episode view SHALL close next according to existing playback semantics
- **AND** subsequent Back SHALL return from selected feed to feed list before workspace history

#### Scenario: Cached Podcast cannot intercept
- **WHEN** Podcast remains mounted but another tab owns navigation
- **THEN** Podcast SHALL not consume that view's Back input

### Requirement: Settings hierarchy and return share guarded chronological navigation
Supported Back inputs from a compact Settings section SHALL first show the Settings menu; from the menu they SHALL return to the most recent valid non-Settings chronological destination or Dashboard. Explicit app-return SHALL skip only the local menu step. Every path leaving a dirty section SHALL use one existing discard confirmation and protect history until confirmed.

#### Scenario: Back within Settings subsection
- **WHEN** Back is requested from a clean compact Settings subsection
- **THEN** the Settings menu SHALL appear and workspace history SHALL remain unchanged

#### Scenario: Dirty Settings confirms
- **WHEN** a dirty Settings Back opens a discard prompt and the user confirms
- **THEN** the requested hierarchy or app-return transition SHALL occur once
- **AND** dirty-state clearing SHALL follow the existing discard behavior

#### Scenario: Cancel discard confirmation
- **WHEN** the user cancels the discard prompt or presses Back while it is pending
- **THEN** the prompt SHALL close/cancel without a second navigation
- **AND** section, unsaved values and navigation history SHALL remain unchanged

#### Scenario: Confirm after ownership changes
- **WHEN** another view becomes active before a pending discard confirmation resolves
- **THEN** the obsolete continuation SHALL not navigate, clear unrelated state or corrupt history

### Requirement: Cross-platform fallback and content gestures remain compatible
Native Android SHALL use OS Back instead of the JavaScript edge recognizer regardless of viewport/fullscreen. Browser/PWA/iOS SHALL retain existing protected left-edge fallback semantics; content-owned horizontal gestures SHALL remain functional. Browser URL navigation SHALL not be repurposed as workspace Back. Explicit app Back at exhausted root on browser/PWA/iOS SHALL be a no-op.

#### Scenario: Browser PWA or iOS fallback
- **WHEN** a qualifying fallback edge gesture occurs outside protected controls
- **THEN** it SHALL follow the same overlay/context/workspace policy once
- **AND** vertical, multi-touch, cancelled and protected-target sequences SHALL remain excluded

#### Scenario: Reader, queue and review interactions
- **WHEN** the user scrolls Library horizontally, turns EPUB/PDF pages, swipes a queue row, grades a flashcard or selects/annotates text outside OS-owned gesture regions
- **THEN** those local interactions SHALL remain functional without global Back/tab cycling

#### Scenario: Fullscreen reader on native Android
- **WHEN** system Back is committed while reading fullscreen
- **THEN** eligible overlays and fullscreen context SHALL be honored before workspace navigation
- **AND** the native listener SHALL remain available without a JavaScript edge fallback

#### Scenario: Browser URL Back remains separate
- **WHEN** browser chrome Back changes existing document URL/hash state
- **THEN** existing URL listeners SHALL continue to operate without fabricating a workspace Back transition

### Requirement: Back navigation remains accessible
Visible Back/app-return controls SHALL be semantic keyboard-operable buttons with localized destination names and visible focus. Overlay dismissal SHALL restore focus to a connected visible invoker or active view fallback. Native recovery controls SHALL be assistive-technology reachable. No workflow SHALL require an edge gesture as its sole in-app navigation control.

#### Scenario: Keyboard Settings return
- **WHEN** a keyboard user activates Settings return with a standard button key
- **THEN** the same guard and chronological return behavior SHALL apply

#### Scenario: Focus after dismissal
- **WHEN** a dialog is dismissed through system Back
- **THEN** focus SHALL return to a visible connected invoking control or the active view's accessible fallback
- **AND** hidden cached tabs SHALL not receive focus

#### Scenario: TalkBack recovery
- **WHEN** native navigation recovery appears with TalkBack enabled
- **THEN** its message and Retry, Stay and Background app controls SHALL be announced and operable

### Requirement: Optional haptics acknowledge successful navigation only
Navigation feedback SHALL have an optional best-effort selection/confirmation haptic completion hook. It SHALL respect existing user opt-in and applicable system settings, produce at most one effect per completed action and never delay navigation. Unsupported delivery SHALL silently do nothing; this change SHALL not depend on a separate native-haptics upgrade or add navigation sounds/notifications.

#### Scenario: Successful and duplicate input
- **GIVEN** haptic feedback is supported and enabled
- **WHEN** one Back action successfully changes an overlay, hierarchy or workspace destination despite duplicate delivery
- **THEN** at most one subtle haptic SHALL occur for that completed transition

#### Scenario: Pending, cancelled or root action
- **WHEN** navigation is blocked, pending, cancelled, fails, or merely backgrounds at root
- **THEN** no navigation haptic SHALL occur
- **AND** cancelling a discard prompt SHALL remain silent

#### Scenario: Unsupported or rejected haptic
- **WHEN** haptics are disabled, unsupported or delivery rejects
- **THEN** navigation and acknowledgment SHALL complete normally without feedback errors
