## Purpose

Defines how reader-adjacent chrome (toolbars, floating TTS player, selection toolbar, reader settings surfaces) adopts Material 3 while guaranteeing that document content rendering, reader typography settings, and reading focus are unaffected.

## ADDED Requirements

### Requirement: Document content isolation

Applying the Material system SHALL NOT alter document content rendering: PDF canvases, EPUB iframe content, reflowed HTML, markdown prose, word-highlight overlays, and reader typography settings SHALL render identically to before migration. Only chrome (toolbars, controls, sheets, menus, players, progress UI) restyles.

#### Scenario: Reader typography untouched

- **WHEN** a user's reader font family/size/line-height settings are applied
- **THEN** in-document typography is identical before and after the Material migration, including inside the EPUB iframe

#### Scenario: Selection DOM contracts preserved

- **WHEN** text is selected in a document
- **THEN** the imperative lookups the selection toolbar, word highlighter (`[data-document-scroll-container]`, `.viewer-content-area`), and extract FAB depend on still resolve, and selection→extract→flashcard flows work unchanged

### Requirement: Reader chrome token compliance

Reader toolbars, floating pills, minimap, dictionary cards, and settings panels SHALL be styled from semantic tokens with tonal elevation (surface-container roles) replacing stacked shadows and hardcoded translucency, and SHALL keep their auto-hide/fullscreen behavior.

#### Scenario: Toolbar on scroll/focus modes

- **WHEN** the reader enters fullscreen or mobile reading mode
- **THEN** chrome hides and reveals exactly as before, now with Material surface styling and motion tokens governing the transition

### Requirement: TTS player morphing

The floating TTS control surface SHALL present an idle form (reader actions) and a playback form (rewind, play/pause, forward, speed, progress, more) and SHALL transform between them with a Material motion transition where motion is enabled. In E-Ink mode or reduced motion, the transform SHALL be an instant state swap. Playback functionality (chunk navigation, voice, speed, highlighter follow, re-center) SHALL be preserved.

#### Scenario: Idle to playback

- **WHEN** TTS playback starts
- **THEN** the floating control surface transitions to the playback form within one motion-token duration, and play/pause remains reachable in a stable position

#### Scenario: Reduced motion instant swap

- **WHEN** reduced motion is preferred and playback starts
- **THEN** the surface switches forms instantly with no transition

### Requirement: Selection action presentation

On desktop presentations, selection actions SHALL render as a compact floating toolbar with primary actions directly visible and secondary actions behind an overflow menu. On touch presentations, when the action set is large it SHALL present as the existing mobile sheet. All current actions (summarize, explain, learn/create card, ask, read from here, extract, copy, dictionary) SHALL remain available and functional.

#### Scenario: Desktop overflow

- **WHEN** a selection is made on a desktop presentation
- **THEN** the most-used actions are immediately clickable on the floating toolbar and the remainder are reachable via one overflow interaction

#### Scenario: Touch sheet

- **WHEN** a selection is made on a phone presentation
- **THEN** actions present in the bottom sheet and every desktop action remains available there
