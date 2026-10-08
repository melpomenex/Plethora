import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssistantPanel } from "../AssistantPanel";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    isTauri: () => false,
    isNativeMobile: () => false,
    invokeCommand: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("../../../api/llm", () => ({
  chatWithContext: vi.fn(),
}));

vi.mock("../../../api/mcp", () => ({
  callAppMCPTool: vi.fn(),
  getAppMCPTools: vi.fn().mockResolvedValue([]),
}));

function seedProviders() {
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

describe("AssistantPanel pinned selection (selection-aware-assistant)", () => {
  beforeEach(() => {
    localStorage.clear();
    Element.prototype.scrollTo = vi.fn();
    seedProviders();
  });

  it("right-click Ask handoff pins selection into a visible thread chip", async () => {
    render(
      <AssistantPanel
        context={{
          type: "document",
          documentId: "doc-ask-1",
          selection: "selected paragraph about photosynthesis",
          content: "full document body here",
          metadata: { title: "Photosynthesis" },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("selection-context-chip")).toBeInTheDocument();
    });
    expect(screen.getByTestId("selection-context-chip")).toHaveTextContent("Photosynthesis");
    expect(screen.getByTestId("selection-context-chip")).toHaveTextContent("selected paragraph");
  });

  it("clearing the chip reverts to plain context", async () => {
    render(
      <AssistantPanel
        context={{
          type: "document",
          documentId: "doc-ask-2",
          selection: "pinned excerpt",
          content: "document body",
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("selection-context-chip")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("selection-context-clear"));
    await waitFor(() => {
      expect(screen.queryByTestId("selection-context-chip")).not.toBeInTheDocument();
    });
  });
});
