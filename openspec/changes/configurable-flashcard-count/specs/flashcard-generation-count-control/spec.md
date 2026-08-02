## ADDED Requirements

### Requirement: Global default flashcard generation target is configurable

The system SHALL provide a global "Flashcard generation target" setting in Settings → AI, stored in `AIControlsSettings`, with a mode of either `fixed` (an exact card count) or `auto` (a density-based count that scales with the size of the generation context, bounded by a configurable minimum and maximum). This setting SHALL apply as the default target for both the Flashcard Studio chat-based generation and the extract auto-generation path.

#### Scenario: User sets a fixed global default

- **WHEN** the user opens Settings → AI and sets the flashcard generation target to "Fixed" with a value of 12
- **THEN** the setting is persisted
- **AND** subsequent flashcard generations that do not have a session-level override request 12 cards

#### Scenario: User sets an auto global default with bounds

- **WHEN** the user sets the flashcard generation target to "Auto" with a minimum of 3 and a maximum of 25
- **THEN** the setting is persisted
- **AND** subsequent flashcard generations compute a target count between 3 and 25 based on the size of the selected content

#### Scenario: Existing cardsPerExtract setting is migrated without behavior change

- **WHEN** a user who previously configured `cardsPerExtract` opens the app after this change is deployed
- **THEN** the new fixed-count field is seeded from their prior `cardsPerExtract` value
- **AND** extract auto-generation continues to request the same count as before until the user changes the new setting

### Requirement: Auto mode scales the target count with content size

When the generation target mode is `auto`, the system SHALL compute the target card count from the word count of the currently selected generation context (document, chapter, section, or excerpt), clamped between the configured minimum and maximum, rather than using a fixed number regardless of content length.

#### Scenario: Short excerpt yields a low count

- **WHEN** the mode is "Auto" (min 3, max 25) and the user generates from a short excerpt of a few hundred words
- **THEN** the computed target is close to the configured minimum, not a flat default like 7

#### Scenario: Long chapter yields a higher count

- **WHEN** the mode is "Auto" (min 3, max 25) and the user generates from a long chapter of many thousands of words
- **THEN** the computed target is higher than for a short excerpt, up to the configured maximum

#### Scenario: Auto target never exceeds configured bounds

- **WHEN** the mode is "Auto" and the computed word-count-based estimate would fall outside [min, max]
- **THEN** the system clamps the target to stay within the configured minimum and maximum

### Requirement: Flashcard Studio exposes the current generation target and allows a session-local override

The Flashcard Studio SHALL display the current effective flashcard generation target (mode and resulting count/range) near the generation controls, and SHALL allow the user to override it for the active session without changing the global default in Settings.

#### Scenario: Studio shows the effective target before generating

- **WHEN** the user opens the Flashcard Studio and has not set a session override
- **THEN** the generation controls display the current mode and resulting target derived from the global AI settings default

#### Scenario: User overrides the target for the current session only

- **WHEN** the user changes the generation target control within an active Flashcard Studio session
- **THEN** subsequent generations in that session use the overridden target
- **AND** the global default in Settings → AI remains unchanged

#### Scenario: New session resets to the global default

- **WHEN** the user starts a new Flashcard Studio session after having overridden the target in a previous session
- **THEN** the new session's generation target starts from the current global default, not the prior session's override

### Requirement: Chat-based generation prompt reflects the resolved target instead of a fixed range

The Flashcard Studio's chat-based generation SHALL interpolate the resolved target count (from the effective global or session setting) into the instructions sent to the LLM, replacing any fixed hardcoded range, so the model is told a concrete target derived from the user's configuration and the selected content's size.

#### Scenario: Resolved count is included in the model instructions

- **WHEN** the user sends a generation request in the Flashcard Studio chat
- **THEN** the instructions given to the LLM state the resolved target count (or the auto-computed number for that content) rather than a static "3-7 cards" instruction

#### Scenario: User can still explicitly override the count via free-text chat instruction

- **WHEN** the user's chat message explicitly requests a specific number of cards (e.g., "give me 20 cards")
- **THEN** that explicit request takes precedence over the configured target for that single generation

### Requirement: Extract auto-generation honors the requested count

The extract-based auto-generation backend command SHALL use the `count` provided in `FlashcardGenerationOptions` when building its generation prompt, instead of discarding it and falling back to a separate hardcoded count.

#### Scenario: Extract generation requests the configured count

- **WHEN** the frontend calls extract auto-generation with `FlashcardGenerationOptions.count` set to a value derived from the resolved target
- **THEN** the backend prompt construction uses that count
- **AND** the previously hardcoded "1-3 flashcards" instruction is no longer used unconditionally
