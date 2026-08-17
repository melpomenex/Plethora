import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssistantPanel } from "../AssistantPanel";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { useDocumentStore } from "../../../stores/documentStore";
import { chatWithContext } from "../../../api/llm";

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

vi.mock("../../../api/documents", () => ({
  getDocument: vi.fn().mockResolvedValue({ id: "doc-1", content: "Photosynthesis converts light into chemical energy." }),
  extractDocumentText: vi.fn().mockResolvedValue({ content: "Photosynthesis converts light into chemical energy." }),
}));

vi.mock("../../../api/mcp", () => ({
  callAppMCPTool: vi.fn(),
  getAppMCPTools: vi.fn().mockResolvedValue([
    {
      name: "create_qa_card",
      description: "Create a Q&A card",
      inputSchema: {},
    },
    {
      name: "create_cloze_card",
      description: "Create a cloze card",
      inputSchema: {},
    },
  ]),
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

describe("AssistantPanel 20 Rules Integration", () => {
  beforeEach(() => {
    localStorage.clear();
    Element.prototype.scrollTo = vi.fn();
    seedProviders();
    useDocumentStore.setState({
      documents: [{ id: "doc-1", title: "Biology 101", content: "Photosynthesis details" } as never],
      currentDocument: null,
    });
    vi.mocked(chatWithContext).mockReset();
  });

  it("renders the /20rules quick action button in the footer", () => {
    render(<AssistantPanel />);
    const button = screen.getByRole("button", { name: /\/20rules/i });
    expect(button).toBeInTheDocument();
  });

  it("clicking /20rules populates the composer input", () => {
    render(<AssistantPanel />);
    const button = screen.getByRole("button", { name: /\/20rules/i });
    fireEvent.click(button);

    const input = screen.getByPlaceholderText(/Ask about your document, or type \/help for commands.../i) as HTMLTextAreaElement;
    expect(input.value).toBe("/20rules");
  });

  it("displays the 20 rules educational reminder when /20rules is sent without document context", async () => {
    render(<AssistantPanel />);
    const input = screen.getByPlaceholderText(/Ask about your document, or type \/help for commands.../i);
    fireEvent.change(input, { target: { value: "/20rules" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText(/20 Rules of Knowledge Formulation/i)).toBeInTheDocument();
    });
    expect(chatWithContext).not.toHaveBeenCalled();
  });

  it("includes /20rules in the /help command output", async () => {
    render(<AssistantPanel />);
    const input = screen.getByPlaceholderText(/Ask about your document, or type \/help for commands.../i);
    fireEvent.change(input, { target: { value: "/help" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText(/Available Commands:/i)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/\/20rules/i).length).toBeGreaterThan(0);
  });
});
