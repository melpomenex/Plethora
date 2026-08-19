import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssistantPanel } from "../AssistantPanel";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { useDocumentStore } from "../../../stores/documentStore";
import { resolveTwitterThreadAssistantContext } from "../../../utils/assistantContext";
import type { Document } from "../../../types/document";

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

describe("AssistantPanel Twitter Thread Integration", () => {
  beforeEach(() => {
    localStorage.clear();
    Element.prototype.scrollTo = vi.fn();
    seedProviders();
  });

  const mockThreadDoc = {
    id: "thread-doc-1",
    title: "X Thread by @karpathy",
    filePath: "https://x.com/karpathy/status/1880000000000000000",
    fileType: "html",
    category: "X Threads",
    tags: ["x", "twitter", "thread"],
    content: "Post 1 text\n\nPost 2 text",
    metadata: {
      source: "https://x.com/karpathy/status/1880000000000000000",
      xThread: {
        id: "1880000000000000000",
        rootId: "1880000000000000000",
        rootUrl: "https://x.com/karpathy/status/1880000000000000000",
        title: "Thread by @karpathy",
        htmlContent: "<p>Post 1</p>",
        author: {
          name: "Andrej Karpathy",
          screenName: "karpathy",
          profileUrl: "https://x.com/karpathy",
          verified: true,
        },
        posts: [
          {
            id: "1880000000000000000",
            postIndex: 1,
            author: {
              name: "Andrej Karpathy",
              screenName: "karpathy",
              profileUrl: "https://x.com/karpathy",
              verified: true,
            },
            text: "Deep dive on transformer architectures.",
            fullText: "Deep dive on transformer architectures.",
            media: [],
            isNoteTweet: false,
            url: "https://x.com/karpathy/status/1880000000000000000",
          },
          {
            id: "1880000000000000001",
            postIndex: 2,
            author: {
              name: "Andrej Karpathy",
              screenName: "karpathy",
              profileUrl: "https://x.com/karpathy",
              verified: true,
            },
            text: "Attention mechanisms allow quadratic context scaling.",
            fullText: "Attention mechanisms allow quadratic context scaling.",
            media: [],
            isNoteTweet: false,
            url: "https://x.com/karpathy/status/1880000000000000001",
          },
        ],
        structuredText: "X Thread by Andrej Karpathy (@karpathy):\n\n[Post 1 by @karpathy]\nDeep dive on transformer architectures.\n\n[Post 2 by @karpathy]\nAttention mechanisms allow quadratic context scaling.\n\n",
        totalPosts: 2,
      },
    },
    dateAdded: new Date().toISOString(),
    dateModified: new Date().toISOString(),
  } as unknown as Document;

  it("renders thread scope badge and quick actions when thread context is active", () => {
    useDocumentStore.setState({
      documents: [mockThreadDoc],
      currentDocument: mockThreadDoc,
    });

    render(
      <AssistantPanel
        context={{
          type: "document",
          documentId: mockThreadDoc.id,
          content: mockThreadDoc.metadata!.xThread!.structuredText,
          metadata: {
            title: mockThreadDoc.title,
          },
        }}
      />
    );

    // Verify scope badge
    expect(screen.getByText("Scope: This X thread")).toBeInTheDocument();

    // Verify quick action buttons in empty state
    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getByText("Insights")).toBeInTheDocument();
    expect(screen.getByText("Flashcards (/20rules)")).toBeInTheDocument();
    expect(screen.getByText("Ask Questions")).toBeInTheDocument();
  });

  it("clicking Summary button fills the composer with summary prompt", async () => {
    useDocumentStore.setState({
      documents: [mockThreadDoc],
      currentDocument: mockThreadDoc,
    });

    render(
      <AssistantPanel
        context={{
          type: "document",
          documentId: mockThreadDoc.id,
          content: mockThreadDoc.metadata!.xThread!.structuredText,
        }}
      />
    );

    const summaryButton = screen.getByText("Summary").closest("button")!;
    fireEvent.click(summaryButton);

    const input = screen.getByPlaceholderText(/Ask about your document/i) as HTMLTextAreaElement;
    expect(input.value).toContain("comprehensive summary of this X/Twitter thread");
  });

  it("clicking Insights button fills the composer with structured insights prompt", async () => {
    useDocumentStore.setState({
      documents: [mockThreadDoc],
      currentDocument: mockThreadDoc,
    });

    render(
      <AssistantPanel
        context={{
          type: "document",
          documentId: mockThreadDoc.id,
          content: mockThreadDoc.metadata!.xThread!.structuredText,
        }}
      />
    );

    const insightsButton = screen.getByText("Insights").closest("button")!;
    fireEvent.click(insightsButton);

    const input = screen.getByPlaceholderText(/Ask about your document/i) as HTMLTextAreaElement;
    expect(input.value).toContain("Core Claims");
    expect(input.value).toContain("Actionable Takeaways");
  });

  it("resolveTwitterThreadAssistantContext builds normalized post-delimited context", () => {
    const res = resolveTwitterThreadAssistantContext(mockThreadDoc);
    expect(res.status).toBe("ready");
    expect(res.content).toContain("[Post 1 by @karpathy]");
    expect(res.content).toContain("Deep dive on transformer architectures.");
    expect(res.content).toContain("[Post 2 by @karpathy]");
  });
});
