## ADDED Requirements

### Requirement: Successful AI provider save shows a success toast
The system SHALL display a Plethora-native success toast (via `useToast()` from `src/components/common/Toast.tsx`) when an AI/LLM provider configuration is successfully saved or added. This SHALL apply to all provider types sharing the save mechanism (openai, anthropic, gemini, deepseek, ollama, openrouter), not a single hard-coded provider. The toast SHALL NOT be shown before persistence succeeds.

#### Scenario: Add provider succeeds
- **WHEN** the user adds a new valid provider and the save completes successfully (store persist + native `set_api_key`/`set_ai_config` sync succeed)
- **THEN** a success toast SHALL appear (e.g. "Provider saved"), and SHALL NOT appear before the persistence completes

#### Scenario: Update provider succeeds
- **WHEN** the user edits an existing provider's model/name/key and saves successfully
- **THEN** a success toast SHALL appear

#### Scenario: Persistence fails
- **WHEN** the save operation fails (e.g. native key-store write rejects)
- **THEN** an error toast SHALL appear and the success toast SHALL NOT appear; the UI SHALL NOT claim the settings were saved

### Requirement: Failure is reported accurately
On any failure path, the system SHALL surface an error toast/state that does not falsely claim success.

#### Scenario: Validation prevents save
- **WHEN** the provider requires an API key and the key is empty (or other required validation fails)
- **THEN** the save SHALL be blocked, no success toast SHALL appear, and the existing inline validation state SHALL communicate the error

### Requirement: Feedback is immediate and non-invasive
The toast SHALL use the app's existing toast/notification system, SHALL be immediate, and SHALL NOT introduce new vibration behavior. On supported mobile platforms, existing subtle haptic patterns may be reused but new haptics SHALL NOT be added for this feature.

#### Scenario: Toast uses existing system
- **WHEN** a provider save completes
- **THEN** the toast SHALL render through the app's global Toast container with the existing styling, and no new vibration/haptics SHALL be introduced