import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCommandRegistry, matchCommands, type RegistryDeps } from "../registry";
import { en } from "../../lib/i18n/locales/en";
import { useLLMProvidersStore } from "../../stores/llmProvidersStore";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  peekLearningAgentMode,
  resetLearningAgentModeForTests,
} from "../../lib/ai/assistant/learningAgentHandoff";

function deps(): RegistryDeps {
  return {
    translate: (key, vars) => {
      const template = en[key] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
    },
    theme: { id: "theme-dark", name: "Dark", variant: "dark" },
    themes: [{ id: "theme-dark", name: "Dark", variant: "dark" }],
    setTheme: vi.fn(),
    isWeb: false,
    selectedDocumentTitle: null,
    savedQueues: [],
  };
}

function seedProvider() {
  useLLMProvidersStore.setState({
    providers: [
      {
        id: "openai-cfg",
        provider: "openai",
        name: "OpenAI",
        apiKey: "sk-test",
        model: "gpt-4o",
        enabled: true,
        temperature: 0.7,
        maxTokens: 4096,
      },
    ],
  });
}

function setAgentFlag(enabled: boolean) {
  useSettingsStore.setState((state) => ({
    settings: {
      ...state.settings,
      features: { ...state.settings.features, aiAgent: enabled },
    },
  }));
}

beforeEach(() => {
  localStorage.clear();
  resetLearningAgentModeForTests();
  seedProvider();
  setAgentFlag(true);
});

describe("Learning Agent palette entry", () => {
  it("opens the existing Assistant mode without sending a request", () => {
    const commands = buildCommandRegistry(deps());
    const matches = matchCommands(commands, "learning agent");
    expect(matches[0]?.command.id).toBe("open-learning-agent");
    const dispatch = vi.spyOn(window, "dispatchEvent");
    void matches[0].command.action();
    expect(peekLearningAgentMode()).not.toBeNull();
    expect(peekLearningAgentMode()?.intentId).toMatch(/^learning-agent-mode:/);
    // No navigation and no request text: the mode is selected, inference waits
    // for the user's own submit.
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "navigate" })
    );
    dispatch.mockRestore();
  });

  it("is omitted when the feature is disabled", () => {
    setAgentFlag(false);
    const commands = buildCommandRegistry(deps());
    expect(commands.find((command) => command.id === "open-learning-agent")).toBeUndefined();
  });

  it("is omitted when no provider route exists", () => {
    useLLMProvidersStore.setState({ providers: [] });
    const commands = buildCommandRegistry(deps());
    expect(commands.find((command) => command.id === "open-learning-agent")).toBeUndefined();
  });

  it("is available while a conversation is active without switching it", () => {
    // A provider-backed active conversation is irrelevant to the sync entry:
    // the request carries no conversation id, so the mounted Assistant keeps
    // the current conversation.
    const commands = buildCommandRegistry(deps());
    const command = commands.find((candidate) => candidate.id === "open-learning-agent")!;
    void command.action();
    expect(peekLearningAgentMode()).not.toHaveProperty("conversationId");
  });
});
