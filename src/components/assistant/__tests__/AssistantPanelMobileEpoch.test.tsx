import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantPanel } from "../AssistantPanel";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { runAssistantTurn } from "../../../lib/ai/assistant/orchestrator";
import { getDocument } from "../../../api/documents";
vi.mock("../../../lib/tauri", async original => ({ ...await original<typeof import("../../../lib/tauri")>(), isTauri: () => false, invokeCommand: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../lib/ai/assistant/orchestrator", () => ({ runAssistantTurn: vi.fn() }));
vi.mock("../../../api/documents", () => ({ getDocument: vi.fn(), extractDocumentText: vi.fn().mockResolvedValue({ content: "" }) }));
vi.mock("../../../api/mcp", () => ({ getAppMCPTools: vi.fn().mockResolvedValue([]), callAppMCPTool: vi.fn() }));
vi.mock("../../../lib/privacy/cloudAiDisclosure", () => ({ ensureCloudAiDisclosure: vi.fn().mockResolvedValue(true) }));
const props = { conversationKey: "mobile:global", mobilePresentation: { visible: true }, fillContainer: true, appendContextMessages: false };
const storageKey = "assistant-panel-conversations-v1";
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); Element.prototype.scrollTo = vi.fn();
  useLLMProvidersStore.setState({ providers: [{ id: "provider", provider: "openai", name: "Test", apiKey: "test", model: "frozen-model", enabled: true, temperature: 0.5, maxTokens: 2048 }] });
  vi.mocked(getDocument).mockResolvedValue({ id: "source", title: "Source", content: "body" } as never);
});
function submit(question = "A general question") { const field = screen.getByRole("textbox"); fireEvent.change(field, { target: { value: question } }); fireEvent.keyDown(field, { key: "Enter" }); }
function deferredTurn() {
  let finish!: (value: Awaited<ReturnType<typeof runAssistantTurn>>) => void;
  vi.mocked(runAssistantTurn).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  return (text: string) => finish({ rawContent: text } as Awaited<ReturnType<typeof runAssistantTurn>>);
}
describe("mobile conversation frozen turn and request epoch", () => {
  it("New conversation rejects a late response and preserves the new draft", async () => {
    const finish = deferredTurn(); render(<AssistantPanel {...props} context={{ type: "general" }} />); submit();
    await waitFor(() => expect(runAssistantTurn).toHaveBeenCalledOnce()); fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "new draft" } });
    await act(async () => { finish("old response must not return"); });
    expect(screen.queryByText("old response must not return")).not.toBeInTheDocument(); expect(screen.getByRole("textbox")).toHaveValue("new draft");
  });
  it("view changes and hidden completion retain the submitted source attribution", async () => {
    const finish = deferredTurn(); const view = render(<AssistantPanel {...props} context={{ type: "web", url: "https://example.test/a", content: "source A", metadata: { title: "A" } }} />); submit();
    await waitFor(() => expect(runAssistantTurn).toHaveBeenCalledOnce());
    view.rerender(<AssistantPanel {...props} mobilePresentation={{ visible: false }} context={{ type: "web", url: "https://example.test/b", content: "source B" }} />);
    await act(async () => { finish("response about A"); });
    const stored = JSON.parse(localStorage.getItem(storageKey)!)["mobile:global"];
    expect(stored.messages.find((m: { content: string }) => m.content === "response about A").provenance.sourceId).toBe("https://example.test/a");
    expect(runAssistantTurn).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl: "https://example.test/a" }));
  });
  it("blocks protected historical material before any provider request and keeps visible history", async () => {
    vi.mocked(getDocument).mockResolvedValue({ id: "protected", isLocalOnly: true } as never);
    localStorage.setItem(storageKey, JSON.stringify({ "mobile:global": { scope: "chat", input: "", messages: [{ id: "prior", role: "assistant", content: "protected visible history", timestamp: 1, provenance: { documentIds: ["protected"] } }] } }));
    render(<AssistantPanel {...props} context={{ type: "general" }} />); await screen.findByText("protected visible history"); submit();
    await screen.findByText(/Choose a permitted local provider or start a new conversation/);
    expect(runAssistantTurn).not.toHaveBeenCalled(); expect(screen.getByText("protected visible history")).toBeInTheDocument();
  });
  it("keeps the configured provider snapshot across asynchronous privacy resolution", async () => {
    let authorize!: (value: never) => void; vi.mocked(getDocument).mockReturnValueOnce(new Promise(resolve => { authorize = resolve; }));
    const finish = deferredTurn(); render(<AssistantPanel {...props} context={{ type: "document", documentId: "source", content: "Source content" }} />); submit("Explain this source");
    await waitFor(() => expect(getDocument).toHaveBeenCalled());
    act(() => useLLMProvidersStore.setState(state => ({ providers: state.providers.map(provider => ({ ...provider, model: "changed-model" })) })));
    await act(async () => { authorize({ id: "source", content: "body" } as never); });
    await waitFor(() => expect(runAssistantTurn).toHaveBeenCalledWith(expect.objectContaining({ model: "frozen-model" })));
    await act(async () => { finish("done"); });
  });
});
