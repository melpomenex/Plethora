/**
 * Honest transcript availability badges (youtube-canonical-transcript-intelligence):
 * the context banner must never claim "Transcript attached" while a transcript
 * is loading, unavailable, or failed — and a failed fetch offers Retry.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

const videoContext = (extra: Record<string, unknown>) =>
  ({
    type: "video" as const,
    documentId: "video-doc-1",
    metadata: { title: "Lecture", videoId: "vid-1" },
    ...extra,
  });

describe("AssistantPanel transcript availability badges", () => {
  beforeEach(() => {
    localStorage.clear();
    Element.prototype.scrollTo = vi.fn();
    seedProviders();
  });

  it("shows a loading badge while the transcript is still loading", () => {
    render(<AssistantPanel context={videoContext({ transcriptStatus: "loading" })} />);
    expect(screen.getByText("Loading transcript…")).toBeInTheDocument();
    expect(screen.queryByText("Transcript attached")).not.toBeInTheDocument();
  });

  it("shows ready only when transcript content is actually attached", () => {
    render(
      <AssistantPanel
        context={videoContext({ content: "[00:00] Hello", transcriptStatus: "ready-full" })}
      />,
    );
    expect(screen.getByText("Transcript ready")).toBeInTheDocument();
  });

  it("reports an unavailable transcript instead of faking readiness", () => {
    render(
      <AssistantPanel
        context={videoContext({ status: "unavailable", transcriptStatus: "unavailable" })}
      />,
    );
    expect(screen.getByText("Transcript unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Transcript attached")).not.toBeInTheDocument();
  });

  it("shows a failed badge with a working Retry control", () => {
    const retryTranscript = vi.fn();
    render(
      <AssistantPanel
        context={videoContext({ transcriptStatus: "failed", retryTranscript })}
      />,
    );
    expect(screen.getByText("Transcript failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retryTranscript).toHaveBeenCalledOnce();
  });

  it("distinguishes a partial transcript", () => {
    render(
      <AssistantPanel
        context={videoContext({ content: "[00:00] partial", transcriptStatus: "partial" })}
      />,
    );
    expect(screen.getByText("Partial transcript")).toBeInTheDocument();
  });
});
