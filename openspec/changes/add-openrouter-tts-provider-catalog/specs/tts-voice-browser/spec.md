## ADDED Requirements

### Requirement: Voice browser replaces the voice dropdown

The system SHALL provide a dedicated voice browser for selecting a TTS voice, replacing the flat `<select>` element. The browser SHALL remain usable at catalog sizes of 200 or more voices — a single model such as Deepgram Aura-2 contributes 90 and Kokoro 54.

The browser SHALL present voices as cards showing at minimum the voice name, its provider and model, and any language or style metadata derivable from the voice identifier or catalog.

#### Scenario: Opening the browser

- **WHEN** the user activates the voice selector in TTS settings
- **THEN** the voice browser opens showing the voices available for the currently selected provider and model
- **AND** the currently selected voice is visibly marked and scrolled into view

#### Scenario: Large catalog remains navigable

- **WHEN** the selected model exposes 90 voices
- **THEN** the browser renders them in a scrollable, grouped layout without requiring the user to scan a single unstructured list

#### Scenario: Selecting a voice

- **WHEN** the user selects a voice card
- **THEN** it becomes the default voice for the current provider and model, the browser closes, and the settings summary reflects the new selection

### Requirement: Search and filtering

The voice browser SHALL provide incremental text search and filter controls so a user can narrow a large catalog to a small candidate set.

Filters SHALL include, where the underlying metadata supports it: provider, vendor, language, and voice style or gender.

#### Scenario: Text search

- **WHEN** the user types into the search field
- **THEN** the list narrows as they type to voices whose name, model, or vendor matches, case-insensitively

#### Scenario: Language filter

- **WHEN** the user filters by a language
- **THEN** only voices whose metadata or identifier indicates that language are shown, and the active filter is displayed as a removable chip

#### Scenario: Combined filters

- **WHEN** more than one filter is active
- **THEN** results satisfy all active filters simultaneously
- **AND** a control is available to clear all filters at once

#### Scenario: No matches

- **WHEN** the active search and filters match no voices
- **THEN** the browser shows an empty state explaining which criteria are active and offering to clear them, rather than a blank panel

### Requirement: Voice auditioning

The system SHALL let the user hear a voice before committing to it, from inside the browser.

#### Scenario: Playing a preview

- **WHEN** the user activates the preview control on a voice card
- **THEN** the system synthesizes a short fixed sample phrase with that voice and plays it
- **AND** the card shows a loading state while synthesis is in flight

#### Scenario: Previews are cached

- **WHEN** the user previews a voice already previewed with the same provider, model, and sample phrase
- **THEN** the cached audio plays without a new synthesis request

#### Scenario: Only one preview at a time

- **WHEN** the user starts a preview while another is playing
- **THEN** the previous preview stops before the new one begins

#### Scenario: Preview failure

- **WHEN** a preview request fails
- **THEN** the error is shown on the card without closing the browser or changing the current selection

#### Scenario: Preview cost is disclosed

- **WHEN** the selected provider bills per request
- **THEN** the browser states that previews consume API credit before the first preview in a session

### Requirement: Favorites and recents

The voice browser SHALL let users mark favorites and SHALL surface recently used voices, so that a preferred handful stays reachable without searching.

#### Scenario: Marking a favorite

- **WHEN** the user marks a voice as a favorite
- **THEN** it is persisted across sessions and appears in a favorites group pinned above the full list

#### Scenario: Recents

- **WHEN** the user has previously selected voices
- **THEN** the most recently selected appear in a recents group, most recent first, capped at a fixed count

#### Scenario: Favorites across providers

- **WHEN** the user has favorites under more than one provider
- **THEN** the favorites group shows all of them, each labeled with its provider, and selecting one switches the active provider and model accordingly

#### Scenario: Favorite of an unavailable voice

- **WHEN** a favorited voice's model is no longer present in the catalog
- **THEN** it is shown as unavailable with an explanation, and selecting it is prevented rather than producing a failed synthesis

### Requirement: Model browser

The system SHALL provide a model picker analogous to the voice browser, replacing the free-text model id input for providers whose adapter can enumerate models.

Model cards SHALL show the display name, vendor, voice count, and — where the adapter supplies it — price and supported capabilities.

#### Scenario: Browsing models

- **WHEN** the user opens the model picker for a provider that enumerates models
- **THEN** models are listed as cards with name, vendor, and voice count, searchable by name and vendor

#### Scenario: Free-text fallback

- **WHEN** the selected provider's adapter cannot enumerate models — for example `openai-compatible`
- **THEN** a free-text model id field is shown instead of the picker

#### Scenario: Capability badges

- **WHEN** a model supports speed control, tone instructions, or a non-default set of audio formats
- **THEN** the model card indicates those capabilities

### Requirement: Provider selection reflects configuration state

The provider selector SHALL communicate, before selection, whether each provider is ready to use, so the user is not routed into a dead end.

#### Scenario: Ready providers are distinguishable

- **WHEN** the provider selector is shown
- **THEN** each provider indicates whether it is configured, needs a key, or is unavailable on this platform

#### Scenario: Borrowed key surfaced

- **WHEN** a provider will authenticate with a key borrowed from another part of the app
- **THEN** the selector marks it as ready and names the source of the key

#### Scenario: Selecting an unconfigured provider

- **WHEN** the user selects a provider with no usable key
- **THEN** the settings panel focuses that provider's credential field and explains what is required, without discarding the selection
