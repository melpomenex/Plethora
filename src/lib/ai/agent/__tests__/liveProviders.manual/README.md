# Live-provider suite (opt-in, NOT in CI)

This suite asserts *serving-model identity* and agent-turn JSON compliance
against real providers. Absent live evidence, compatibility is never claimed:
passing unit tests with fake providers prove nothing about a specific model.

## Preconditions & consent

- **Ollama**: a model must be installed locally (`ollama pull llama3.2`).
  Local only; nothing leaves the machine.
- **OpenRouter**: set `PLETHORA_LIVE_OPENROUTER_KEY` and an explicit model
  (e.g. `meta-llama/llama-3-8b-instruct`). Sending prompts to OpenRouter is
  an off-device transmission — only run with your own key and consent.
- **Gemini**: set `PLETHORA_LIVE_GEMINI_KEY` and an explicit model id
  (e.g. `gemini-2.0-flash`). Off-device transmission — your key, your
  consent.

## Running

```bash
PLETHORA_LIVE_PROVIDERS=1 \
PLETHORA_LIVE_OPENROUTER_KEY=... PLETHORA_LIVE_OPENROUTER_MODEL=... \
PLETHORA_LIVE_GEMINI_KEY=... PLETHORA_LIVE_GEMINI_MODEL=... \
npx vitest run src/lib/ai/agent/__tests__/liveProviders.manual
```

Without `PLETHORA_LIVE_PROVIDERS=1` every test skips.

## What it asserts

1. The serving model (`AIResponse.baseModelName`) equals the explicitly
   configured model — not merely an HTTP 200.
2. `validateAgentTurn` passes on the probe response across ≥ N/6 prompts.
3. The deterministic protocol probe result is recorded per
   (providerId, model, contract revision).

## No-claim rule

A provider that serves plain chat successfully is NOT marked agent-turn
compatible by that evidence. Only this suite's served-model + compliance
results may support a compatibility claim.
