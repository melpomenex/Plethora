## ADDED Requirements

### Requirement: Single pricing unit across providers
All model pricing exposed by `llm_get_models` SHALL be expressed in USD per 1,000 tokens as a finite number, regardless of the unit used by the upstream provider API. Provider adapters SHALL convert upstream units at the fetch boundary.

#### Scenario: OpenRouter per-token pricing is converted
- **WHEN** OpenRouter's `/models` response reports a model whose `pricing.prompt` is `"0.000003"` (USD per token)
- **THEN** `llm_get_models` returns that model with `pricing.prompt === 0.003` (USD per 1K tokens)

#### Scenario: String-encoded prices are parsed
- **WHEN** an OpenRouter pricing field is a numeric string rather than a JSON number
- **THEN** it is parsed to a number before conversion, and never surfaced as a string

#### Scenario: Non-numeric pricing is omitted
- **WHEN** an OpenRouter pricing field is absent, empty, `null`, or unparseable
- **THEN** the corresponding `ModelPricing` field is omitted rather than defaulted to zero

### Requirement: Free and unpriced model sentinels
The system SHALL distinguish a genuinely free price from an absent price. A value of `0` SHALL be preserved as zero, and a negative value (OpenRouter's "not priced" sentinel) SHALL be treated as unknown.

#### Scenario: Free model
- **WHEN** a model reports `pricing.prompt` of `"0"`
- **THEN** the returned pricing has `prompt === 0` and the UI displays "Free"

#### Scenario: Negative sentinel
- **WHEN** a model reports a pricing field of `"-1"`
- **THEN** that field is omitted from the returned pricing and the UI displays "N/A"

### Requirement: Cache pricing fields are populated
The OpenRouter adapter SHALL map OpenRouter's `input_cache_read` and `input_cache_write` pricing keys onto `ModelPricing.cache_read` and `ModelPricing.cache_write`, applying the same unit conversion.

#### Scenario: Cached-input pricing surfaced
- **WHEN** an OpenRouter model reports `pricing.input_cache_read` of `"0.0000003"`
- **THEN** the returned model has `pricing.cache_read === 0.0003` and the settings panel shows a cache-read price

### Requirement: Consistent normalization across backends
The Tauri backend and the browser fallback backend SHALL return identically normalized pricing for the same OpenRouter response, so that pricing does not depend on which runtime the app is using.

#### Scenario: Browser fallback matches Tauri
- **WHEN** the same OpenRouter `/models` payload is processed by the browser backend and by the Tauri command
- **THEN** both return the same `ModelPricing` values in USD per 1K tokens, including cache fields

### Requirement: Stored pricing is shown without a manual refresh
Provider settings SHALL display model names and prices for a saved provider using its persisted `modelPricing` when the form is opened, without requiring the user to click "Refresh Models" first.

#### Scenario: Editing a saved provider
- **WHEN** the user opens a saved OpenRouter provider for editing and that provider has stored `modelPricing`
- **THEN** the model dropdown lists those models with their input and output prices, and the pricing panel for the selected model is populated

#### Scenario: No stored pricing
- **WHEN** a saved provider has no stored `modelPricing`
- **THEN** the dropdown falls back to the static model list and no price text is shown for those entries

### Requirement: Readable price formatting
Prices SHALL be rendered at a magnitude that is legible for the value: sub-cent per-1K prices SHALL be shown per 1M tokens with enough precision to be non-zero, and larger prices per 1K tokens.

#### Scenario: Very cheap model
- **WHEN** a model's per-1K input price is `0.000003`
- **THEN** the displayed price is `$0.003 per 1M tokens`, not `$0.00 per 1M tokens`

#### Scenario: Standard model
- **WHEN** a model's per-1K input price is `0.003`
- **THEN** the displayed price is a per-1K figure of `$0.0030 per 1K tokens`
