## MODIFIED Requirements

### Requirement: Context window settings UI
The settings page SHALL include a "Context Window" configuration with presets (`auto`, `4k`, `8k`, `16k`, `32k`, `64k`, `128k`, `custom`) and a numeric input supporting values from 1,024 up to 1,000,000 tokens. The UI SHALL NOT clamp user-configured context window tokens to an arbitrary 32,000-token ceiling in AI Settings or Provider Settings. Context window controls SHALL be visible and editable for both local providers (such as Ollama) and cloud providers (such as OpenRouter, Anthropic, OpenAI, Gemini, and DeepSeek).

#### Scenario: Context window section renders
- **WHEN** user navigates to AI Settings
- **THEN** SHALL see a "Context Window" sub-section with all three controls

#### Scenario: Context window section renders for all providers
- **WHEN** user edits or creates a provider configuration in LLM Provider Settings (whether Ollama, OpenRouter, Anthropic, OpenAI, Gemini, or DeepSeek)
- **THEN** the UI displays the Context Window presets and custom token input

#### Scenario: User configures large context window in AI Settings
- **WHEN** the user enters 50,000 tokens in the AI Settings context window field and leaves the input field
- **THEN** the value 50,000 is saved to `settings.ai.maxTokens` without being clamped to 32,000

## ADDED Requirements

### Requirement: Global context window fallback propagation
The system SHALL propagate the user's global context window setting (`settings.ai.maxTokens`) as `globalContextTokens` to `resolveRequestPolicy` across all Assistant execution surfaces, including the Assistant sidebar (`AssistantPanel.tsx`), context action execution (`execution.ts`), and the mobile/PWA assistant (`PwaAssistantButton.tsx`). The policy resolver SHALL NOT receive `undefined` for `globalContextTokens` when a valid global value is configured.

#### Scenario: Global setting reaches request policy resolution
- **WHEN** the user has configured `settings.ai.maxTokens = 50000` and uses an OpenRouter provider with no provider-specific context override
- **THEN** `resolveRequestPolicy` resolves `configuredContextTokens` to 50,000 (or the model's published limit if lower) rather than falling back to 8,192

#### Scenario: Context action policy inherits global context setting
- **WHEN** a whole-source context action is resolved in `resolveActionEnvelope`
- **THEN** the policy resolution incorporates `globalContextTokens` from settings when provider-specific context is unset

### Requirement: Provider context window persistence
The system SHALL persist `contextWindowTokens` and `contextWindowPreset` on `LLMProviderConfig` for all provider types upon saving. Provider updates and additions for cloud providers (OpenRouter, Anthropic, OpenAI, Gemini, DeepSeek) SHALL NOT discard or omit context window fields.

#### Scenario: OpenRouter provider persists custom context window
- **WHEN** the user edits an OpenRouter provider configuration, selects the 64k preset or enters 50,000 tokens, and saves
- **THEN** `llmProvidersStore` updates the provider record with `contextWindowTokens = 50000` and `contextWindowPreset = "custom"`
- **AND** subsequent Assistant turns using that provider resolve with the persisted context limit
