## MODIFIED Requirements

### Requirement: Dynamic provider-aware context budgeting without legacy maxTokens clamping
Context budgeting SHALL resolve the available prompt token budget from the active model and provider configuration following the strict precedence:
1. Per-model override (`modelContextWindows[modelId]`)
2. Per-provider default (`LLMProviderConfig.contextWindowTokens`)
3. Global context window (`settings.ai.maxTokens`)
4. Discovered model context (e.g., Ollama `/api/show` `num_ctx`)
5. Conservative fallback (8,192 tokens)

The system SHALL NOT clamp the input prompt budget to legacy 2,000-token defaults or apply arbitrary frontend multipliers (such as `0.55`) to eliminate source material before context planning. The available prompt budget SHALL be allocated component-wise to core instructions, tool schemas, conversation history, and source material while guaranteeing the output reserve tokens. When source content exceeds the available direct-inclusion budget, the system SHALL escalate to structured hierarchical processing or high-recall retrieval rather than silently discarding late source tokens.

#### Scenario: Large-context provider utilizes configured context window
- **WHEN** the active provider is configured with a 50,000-token context window
- **THEN** the resolved prompt budget reflects 50,000 minus output reserve (e.g., ~45,904 tokens) rather than 8,192 or 2,000 tokens

#### Scenario: Full transcript directly included when within budget
- **WHEN** a 2-hour video transcript has 25,000 tokens and the effective prompt budget is 45,904 tokens
- **THEN** the entire transcript is directly included in the prompt without head-slicing or map-reduce compression
- **AND** the turn reports `sourceCoverage: "full"`

#### Scenario: Disabled long-term memory is excluded from prompts
- **WHEN** `settings.ai.memoryEnabled` is `false` and `<app_data_dir>/memories/MEMORY.md` exists on disk
- **THEN** the prompt assembler does NOT inject `MEMORY.md` into the system prompt

## ADDED Requirements

### Requirement: Per-turn source coverage and context diagnostics
Every Assistant execution turn SHALL compute and record structured, privacy-safe diagnostics detailing how source material and token budgets were handled. The diagnostics SHALL record:
- Configured context window
- Effective model context window
- Prompt budget tokens
- Reserved output tokens
- Estimated source tokens
- Source tokens directly included
- Resolved source coverage mode (`full`, `hierarchical-full`, `window`, `chunks`, `none`)
- Transcript duration and segment/window count (for media sources)
- Any applied fallback and its reason

Diagnostics MUST NOT leak raw transcript text, user prompt content, or API keys.

#### Scenario: Turn diagnostics recorded for whole-video action
- **WHEN** a whole-source "Key points" action completes on a video
- **THEN** the assistant message diagnostics contain numeric token budgets, effective context, source coverage mode, and window processing stats
- **AND** no sensitive user text or credentials appear in debug logs or telemetry
