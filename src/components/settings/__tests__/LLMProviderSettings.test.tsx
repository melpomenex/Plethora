import { describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen } from "../../../test/utils";
import { LLMProviderSettings, type LLMProviderConfig } from "../LLMProviderSettings";

const openRouterProvider: LLMProviderConfig = {
  id: "or-1",
  provider: "openrouter",
  name: "My OpenRouter",
  apiKey: "sk-test",
  baseUrl: "https://openrouter.ai/api/v1",
  model: "anthropic/claude-3.5-sonnet",
  enabled: true,
  temperature: 0.7,
  maxTokens: 4096,
  modelPricing: {
    "anthropic/claude-3.5-sonnet": {
      id: "anthropic/claude-3.5-sonnet",
      name: "Claude 3.5 Sonnet",
      context_length: 200000,
      pricing: {
        prompt: 0.003,
        completion: 0.015,
        cache_read: 0.0003,
        cache_write: 0.00375,
      },
    },
  },
};

describe("LLMProviderSettings", () => {
  it("renders a saved OpenRouter provider's stored per-1K prices without a refresh click", () => {
    renderWithProviders(
      <LLMProviderSettings
        providers={[openRouterProvider]}
        onAddProvider={vi.fn()}
        onUpdateProvider={vi.fn()}
        onRemoveProvider={vi.fn()}
        onTestConnection={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTitle("Edit provider"));

    // Dropdown option carries in/out prices seeded from stored modelPricing.
    expect(screen.getByText(/in: \$0\.0030 per 1K tokens/)).toBeTruthy();
    expect(screen.getByText(/out: \$0\.0150 per 1K tokens/)).toBeTruthy();

    // Pricing panel for the selected model is populated from stored pricing,
    // including the cache fields, without any Refresh Models call.
    expect(screen.getByText("$0.0030 per 1K tokens", { exact: true })).toBeTruthy();
    expect(screen.getByText("$0.0150 per 1K tokens", { exact: true })).toBeTruthy();
    expect(screen.getByText("$0.3 per 1M tokens", { exact: true })).toBeTruthy();
    expect(screen.getByText("$0.0037 per 1K tokens", { exact: true })).toBeTruthy();
  });
});
