import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { useLibraryAskHandoffStore } from "../../../commandPalette/libraryAskHandoff";
import { askLibrary } from "../../../lib/ai/tasks/definitions/libraryTask";
vi.mock("../../../lib/ai/tasks/definitions/libraryTask", () => ({ askLibrary: vi.fn() }));
vi.mock("../../../lib/ai/resolveLibraryRag", () => ({ resolveLibraryRagComposition: vi.fn().mockResolvedValue({ retrieverId: "ai_learning", generatorKind: "ondevice", namespace: "library" }) }));
vi.mock("../../assistant/ragConfig", () => ({ resolveEmbeddingConfigForRag: vi.fn().mockResolvedValue(undefined) }));

// --- Mocks -----------------------------------------------------------------

const sectionHookState = vi.hoisted(() => ({
  tree: [] as SectionNode[],
  flat: [] as SectionNode[],
}));

// Real session store (pure localStorage) is exercised directly via imports.
vi.mock("../../../api/llm", () => ({ chatWithContext: vi.fn() }));
vi.mock("../../../api/documents", () => ({
  getDocument: vi.fn().mockResolvedValue(null),
  extractDocumentText: vi.fn().mockResolvedValue({ content: "" }),
}));
vi.mock("../../../api/extracts", () => ({ getExtracts: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../api/mcp", () => ({
  callAppMCPTool: vi.fn(),
  getAppMCPTools: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../api/integrations", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
  getIntegrationSettings: vi.fn().mockReturnValue({}),
  notebooklmGetSettings: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../../features/documentQa/notebooklmResearch", () => ({
  // Return a minimal valid session shape so the component's research effects
  // don't crash on .draftText / .documentId access.
  loadOrCreateResearchSession: vi.fn().mockReturnValue({
    id: "research-1",
    documentId: "doc-1",
    draftText: "",
    artifacts: [],
    createdAt: 1_000,
    updatedAt: 1_000,
  }),
  orchestrateNotebooklmResearch: vi.fn(),
  saveResearchDraft: vi.fn().mockImplementation((session: { draftText: string }) => session),
  buildClozeFromSelection: vi.fn(),
  buildQaFromSelection: vi.fn(),
  createArtifactDraft: vi.fn(),
  createSelectionRange: vi.fn(),
  upsertArtifactDraft: vi.fn(),
}));
vi.mock("../../../features/documentQa/sectionContextRequest", () => ({
  createDocumentQaRequestContent: vi.fn().mockImplementation((request: {
    documentContext: string;
    userQuestion: string;
  }) => ({
    userPromptContent: `${request.userQuestion}\n\n${request.documentContext}`,
    contextContent: request.documentContext,
  })),
  loadDocumentQaText: vi.fn().mockResolvedValue(""),
}));
vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return { ...actual, invokeCommand: vi.fn().mockResolvedValue(null), isTauri: () => false };
});
vi.mock("../../../utils/markdown", () => ({ renderMarkdown: (s: string) => s }));
vi.mock("../../../hooks/useDocumentSections", () => ({
  useDocumentSections: () => ({
    tree: sectionHookState.tree,
    flat: sectionHookState.flat,
    getById: (id: string) => sectionHookState.flat.find((section) => section.id === id),
  }),
}));

// Seed a single document so the tab renders past the empty-documents guard.
import { copyToClipboard } from "../../../api/integrations";
import { getDocument, extractDocumentText } from "../../../api/documents";
import { chatWithContext } from "../../../api/llm";
import { callAppMCPTool } from "../../../api/mcp";
import { useDocumentQAStore, useLLMProvidersStore, useReviewStore, useStudyDeckStore, useTabsStore } from "../../../stores";
import { useDocumentStore } from "../../../stores/documentStore";
import { useDocumentOutlineStore } from "../../../stores/documentOutlineStore";
import type { SectionNode } from "../../../utils/sectionIndex";
beforeEach(() => {
  useLibraryAskHandoffStore.getState().consumeAsk();
  vi.mocked(askLibrary).mockReset();
  sectionHookState.tree = [];
  sectionHookState.flat = [];
  useDocumentStore.setState({
    documents: [{ id: "doc-1", title: "Biology Textbook", content: "cell biology" } as never],
    currentDocument: null,
  });
  useDocumentQAStore.setState({ messages: [], isProcessing: false });
  useLLMProvidersStore.setState({ providers: [] });
  useStudyDeckStore.setState({ decks: [], activeDeckIds: [] });
  useDocumentOutlineStore.setState({
    outlineByDocId: new Map(),
    mediaSectionsByDocId: new Map(),
  });
  vi.mocked(copyToClipboard).mockClear();
  vi.mocked(callAppMCPTool).mockReset();
  vi.mocked(chatWithContext).mockReset();
});

import { DocumentQATab } from "../DocumentQATab";
import {
  STORAGE_KEYS,
  createSession,
  loadSessions,
  saveSessions,
  setActiveSessionId,
  LEGACY_STORAGE_KEYS,
} from "../documentQaSessions";
import type { QAMessage } from "../../../stores";

const userMsg = (content: string, id = "m1"): QAMessage => ({
  id,
  role: "user",
  content,
  timestamp: 1_000,
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// --- Helpers ---------------------------------------------------------------

/** Wait for the debounced save effect (500ms) to flush into the store. */
const waitForSave = () => waitFor(() => expect(loadSessions().length).toBeGreaterThan(0), { timeout: 3000 });

function selectFocusDocument() {
  fireEvent.click(screen.getByRole("button", { name: "Choose sources" }));
  fireEvent.click(screen.getByRole("button", { name: useDocumentStore.getState().documents.find((doc) => doc.id === "doc-1")!.title }));
}

// --- Tests -----------------------------------------------------------------

describe("DocumentQATab sessions sidebar", () => {
  it("renders the sidebar with a New chat button and chat history heading", () => {
    render(<DocumentQATab />);
    expect(screen.getByText("Chat history")).toBeInTheDocument();
    expect(screen.getAllByText("New conversation").length).toBeGreaterThan(0);
  });

  it("starts a new chat and preserves the prior session in the list", async () => {
    // Seed an existing active session with a message.
    const existing = createSession({ messages: [userMsg("prior question")] });
    saveSessions([existing]);
    setActiveSessionId(existing.id);

    render(<DocumentQATab />);

    // Click the sidebar "New conversation" button (the one inside the sidebar header,
    // which sits within the chat history aside).
    const aside = screen.getByText("Chat history").closest("aside")!;
    const newChatBtn = within(aside).getByText("New conversation");
    fireEvent.click(newChatBtn);

    // A fresh active session is created (empty messages) and the prior one
    // remains listed.
    await waitFor(() => {
      const sessions = loadSessions();
      expect(sessions.length).toBe(2);
      expect(sessions.some((s) => s.id === existing.id)).toBe(true);
    });
    // The prior session is preserved (not lost).
    expect(loadSessions().find((s) => s.id === existing.id)?.messages).toHaveLength(1);
    // The new active session is empty.
    const newActiveId = localStorage.getItem(STORAGE_KEYS.activeSession);
    expect(newActiveId).not.toBe(existing.id);
    expect(loadSessions().find((s) => s.id === newActiveId)?.messages).toEqual([]);
  });

  it("resumes a past session and makes it active", async () => {
    const target = createSession({ messages: [userMsg("resumable conversation", "r1")] });
    const other = createSession({ messages: [userMsg("something else", "o1")] });
    saveSessions([target, other]);
    setActiveSessionId(other.id);

    render(<DocumentQATab />);

    // The target title appears in the sidebar; click it to resume.
    const targetRow = await screen.findByText("resumable conversation");
    fireEvent.click(targetRow);

    // After resume, the target becomes the active session.
    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEYS.activeSession)).toBe(target.id);
    });
  });

  it("migrates a legacy messages blob into a default active session on first load", async () => {
    const legacy = {
      state: { messages: [userMsg("legacy chat", "lm1")] },
      version: 0,
    };
    localStorage.setItem(LEGACY_STORAGE_KEYS.state, JSON.stringify(legacy));

    render(<DocumentQATab />);

    await waitForSave();
    const sessions = loadSessions();
    expect(sessions.length).toBeGreaterThan(0);
    const active = sessions.find((s) => s.id === localStorage.getItem(STORAGE_KEYS.activeSession));
    expect(active?.messages.map((m) => m.content)).toContain("legacy chat");
  });

  it("does not crash when the legacy blob is malformed", () => {
    localStorage.setItem(LEGACY_STORAGE_KEYS.state, "{not valid json");
    expect(() => render(<DocumentQATab />)).not.toThrow();
  });

  it("deleting a non-active session leaves the active one unchanged", async () => {
    const active = createSession({ messages: [userMsg("active one", "a1")] });
    const other = createSession({ messages: [userMsg("deletable one", "d1")] });
    saveSessions([active, other]);
    setActiveSessionId(active.id);

    render(<DocumentQATab />);

    // The non-active row is 'other' (deletable one). Find its delete button and confirm.
    const row = await screen.findByText("deletable one");
    const deleteBtn = within(row.closest("[role=button]")!).getByLabelText("Delete conversation");
    fireEvent.click(deleteBtn);
    // Confirm dialog — its confirm button is labelled "Delete conversation"
    // but sits inside a role="dialog"; scope to it to disambiguate.
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete conversation" }));

    await waitFor(() => {
      expect(loadSessions().some((s) => s.id === other.id)).toBe(false);
    });
    // Active session untouched.
    expect(loadSessions().find((s) => s.id === active.id)?.messages).toHaveLength(1);
    expect(localStorage.getItem(STORAGE_KEYS.activeSession)).toBe(active.id);
  });

  it("deleting the active session creates and activates an empty session", async () => {
    const active = createSession({ messages: [userMsg("active one", "a1")] });
    saveSessions([active]);
    setActiveSessionId(active.id);

    render(<DocumentQATab />);

    // Scope to the sidebar (the title also appears as a rendered chat message).
    const aside = screen.getByText("Chat history").closest("aside")!;
    const row = await within(aside).findByText("active one");
    const deleteBtn = within(row.closest("[role=button]")!).getByLabelText("Delete conversation");
    fireEvent.click(deleteBtn);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete conversation" }));

    await waitFor(() => {
      expect(loadSessions().some((s) => s.id === active.id)).toBe(false);
    });
    const newActiveId = localStorage.getItem(STORAGE_KEYS.activeSession);
    expect(newActiveId).toBeTruthy();
    expect(newActiveId).not.toBe(active.id);
    expect(loadSessions().find((s) => s.id === newActiveId)?.messages).toEqual([]);
  });
});

describe("DocumentQATab generated flashcards", () => {
  it("creates the document-title deck from the artifact header and then offers to open it", async () => {
    const session = createSession({
      selectedDocumentId: "doc-1",
      messages: [{
        id: "assistant-cards",
        role: "assistant",
        content: "Here are your cards.",
        timestamp: 2_000,
        sourceDocuments: ["doc-1"],
        toolCalls: [{
          name: "create_qa_card",
          parameters: {
            question: "What is the powerhouse of the cell?",
            answer: "The mitochondrion.",
            document_id: "doc-1",
            tags: ["deck:Biology Textbook"],
          },
          status: "pending",
        }],
      }],
    });
    saveSessions([session]);
    setActiveSessionId(session.id);

    render(<DocumentQATab />);

    const createDeck = await screen.findByRole("button", { name: "Create deck Biology Textbook" });
    expect(screen.getByRole("button", { name: "Copy all flashcards" })).toBeInTheDocument();
    fireEvent.click(createDeck);

    await waitFor(() => {
      expect(useStudyDeckStore.getState().decks).toEqual([
        expect.objectContaining({
          name: "Biology Textbook",
          documentId: "doc-1",
          filterType: "all",
        }),
      ]);
      expect(screen.getByRole("button", { name: "Open deck Biology Textbook" })).toBeInTheDocument();
    });

    const deckId = useStudyDeckStore.getState().decks[0].id;
    fireEvent.click(screen.getByRole("button", { name: "Open deck Biology Textbook" }));
    expect(useReviewStore.getState().selectedDeckId).toBe(deckId);
    expect(useReviewStore.getState().reviewTabMode).toBe("deck-manager");
    expect(useTabsStore.getState().tabs.some((tab) => tab.type === "review")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Copy all flashcards" }));
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledWith(
      "1. **Q:** What is the powerhouse of the cell?\n   **A:** The mitochondrion.",
    ));
  });

  it("adds document ownership and the title deck tag when retrying a failed card", async () => {
    vi.mocked(callAppMCPTool).mockResolvedValue({
      isError: false,
      content: [{ type: "text", text: JSON.stringify({ success: true, id: "card-1" }) }],
    } as never);
    const session = createSession({
      selectedDocumentId: "doc-1",
      messages: [{
        id: "assistant-retry",
        role: "assistant",
        content: "The first save failed.",
        timestamp: 3_000,
        sourceDocuments: ["doc-1"],
        toolCalls: [{
          name: "create_qa_card",
          parameters: {
            question: "What carries genetic information?",
            answer: "DNA.",
            document_id: "doc-1",
          },
          result: "temporary failure",
          status: "error",
        }],
      }],
    });
    saveSessions([session]);
    setActiveSessionId(session.id);

    render(<DocumentQATab />);
    fireEvent.click(await screen.findByRole("button", {
      name: "Retry saving flashcard: What carries genetic information?",
    }));

    await waitFor(() => expect(callAppMCPTool).toHaveBeenCalledWith(
      "create_qa_card",
      expect.objectContaining({
        document_id: "doc-1",
        tags: ["deck:Biology Textbook"],
      }),
    ));
    expect(useStudyDeckStore.getState().decks).toEqual([
      expect.objectContaining({
        name: "Biology Textbook",
        documentId: "doc-1",
        filterType: "all",
      }),
    ]);
  });
});

describe("DocumentQATab audiobook section parity", () => {
  it("lists the complete viewer-published transcript chapter catalog after typing #", async () => {
    const chapters: SectionNode[] = ["001", "008", "050"].map((title) => ({
      id: `media-${title}`,
      title,
      level: 1,
      breadcrumb: ["Transcript"],
      preview: `Preview ${title}`,
      content: `Transcript content ${title}`,
      children: [],
      parentId: null,
      source: "media-transcript",
      hasAuthoritativeRange: false,
      documentId: "doc-1",
    }));
    sectionHookState.tree = chapters;
    sectionHookState.flat = chapters;
    useDocumentStore.setState({
      documents: [{
        id: "doc-1",
        title: "A Thousand Brains",
        filePath: "/books/a-thousand-brains.m4b",
        fileType: "audio",
        tags: ["audiobook"],
        content: "flattened transcript",
      } as never],
      currentDocument: null,
    });
    useDocumentOutlineStore.setState({
      mediaSectionsByDocId: new Map([["doc-1", chapters]]),
    });

    render(<DocumentQATab />);
    selectFocusDocument();
    const composer = screen.getByRole("textbox", { name: "Your question" });
    fireEvent.change(composer, { target: { value: "#", selectionStart: 1 } });

    const sectionList = await screen.findByRole("listbox", { name: "Sections" });
    const options = within(sectionList).getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining("001"),
      expect.stringContaining("008"),
      expect.stringContaining("050"),
    ]);
    expect(screen.getByText("Sections in this document (3)")).toBeInTheDocument();
  });

  it("sends the selected timed chapter text directly and excludes the foreword", async () => {
    const chapters: SectionNode[] = [
      { title: "001", content: "FOREWORD_ONLY" },
      { title: "008", content: "CORTICAL_COLUMN_CONTENT" },
    ].map((chapter) => ({
      id: `media-${chapter.title}`,
      title: chapter.title,
      level: 1,
      breadcrumb: ["Transcript"],
      preview: chapter.content,
      content: chapter.content,
      children: [],
      parentId: null,
      source: "media-transcript",
      hasAuthoritativeRange: false,
      documentId: "doc-1",
    }));
    sectionHookState.tree = chapters;
    sectionHookState.flat = chapters;
    useDocumentStore.setState({
      documents: [{
        id: "doc-1",
        title: "A Thousand Brains",
        filePath: "/books/a-thousand-brains.m4b",
        fileType: "audio",
        tags: ["audiobook"],
        content: "FOREWORD_ONLY flattened transcript",
      } as never],
      currentDocument: null,
    });
    useDocumentOutlineStore.setState({
      mediaSectionsByDocId: new Map([["doc-1", chapters]]),
    });
    useLLMProvidersStore.setState({
      providers: [{
        id: "provider-1",
        provider: "openai",
        name: "Test provider",
        apiKey: "test-key",
        model: "test-model",
        enabled: true,
        temperature: 0.2,
        maxTokens: 1000,
      }],
    });
    vi.mocked(chatWithContext).mockResolvedValue({ content: "Created cards." } as never);

    render(<DocumentQATab />);
    selectFocusDocument();
    const composer = screen.getByRole("textbox", { name: "Your question" });
    fireEvent.change(composer, { target: { value: "#", selectionStart: 1 } });
    const sectionList = await screen.findByRole("listbox", { name: "Sections" });
    fireEvent.click(within(sectionList).getByRole("option", { name: /008/ }));
    const prompt = `${(composer as HTMLTextAreaElement).value}create flashcards for this section`;
    fireEvent.change(composer, { target: { value: prompt, selectionStart: prompt.length } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(chatWithContext).toHaveBeenCalledTimes(1));
    const request = JSON.stringify(vi.mocked(chatWithContext).mock.calls[0]);
    expect(request).toContain("CORTICAL_COLUMN_CONTENT");
    expect(request).not.toContain("FOREWORD_ONLY");
  });

  it("renders /20rules quick chip and clicking it populates the composer", async () => {
    render(<DocumentQATab />);
    const chip = screen.getByRole("button", { name: /\/20rules/i });
    expect(chip).toBeInTheDocument();

    fireEvent.click(chip);
    const composer = screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
    expect(composer.value).toBe("/20rules ");
  });

  it("injects 20 Rules formulation directives when /20rules is submitted with document mention", async () => {
    useLLMProvidersStore.setState({
      providers: [{
        id: "provider-1",
        provider: "openai",
        name: "Test provider",
        apiKey: "test-key",
        model: "test-model",
        enabled: true,
        temperature: 0.2,
        maxTokens: 1000,
      }],
    });
    vi.mocked(chatWithContext).mockResolvedValue({ content: "Created cards." } as never);

    render(<DocumentQATab />);
    const composer = screen.getByRole("textbox", { name: "Your question" });
    fireEvent.change(composer, { target: { value: "@{doc-1} /20rules create cards" } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(chatWithContext).toHaveBeenCalledTimes(1));
    const callArgs = vi.mocked(chatWithContext).mock.calls[0];
    const systemPrompt = callArgs[2][0]?.content as string;
    expect(systemPrompt).toContain("20 Rules of Knowledge Formulation");
    expect(systemPrompt).toContain("MINIMUM INFORMATION PRINCIPLE");
  });

  it("supports #section /20rules to focus a specific section and apply 20 rules", async () => {
    const chapters: SectionNode[] = [
      {
        id: "sec-photosynthesis",
        title: "001 Light Reactions",
        content: "LIGHT_REACTIONS_DETAIL: Chlorophyll absorbs photons in thylakoid membrane.",
        level: 1,
        source: "media-transcript",
        documentId: "doc-1",
        preview: "LIGHT_REACTIONS_DETAIL: Chlorophyll absorbs photons in thylakoid membrane.",
        parentId: null,
        children: [],
        breadcrumb: [],
      },
    ];
    sectionHookState.flat = chapters;
    sectionHookState.tree = chapters;
    useDocumentOutlineStore.setState({
      mediaSectionsByDocId: new Map([["doc-1", chapters]]),
    });
    useLLMProvidersStore.setState({
      providers: [{
        id: "provider-1",
        provider: "openai",
        name: "Test provider",
        apiKey: "test-key",
        model: "test-model",
        enabled: true,
        temperature: 0.2,
        maxTokens: 1000,
      }],
    });
    vi.mocked(chatWithContext).mockResolvedValue({ content: "Created atomic cards." } as never);

    render(<DocumentQATab />);
    selectFocusDocument();
    const composer = screen.getByRole("textbox", { name: "Your question" });
    fireEvent.change(composer, { target: { value: "#", selectionStart: 1 } });
    const sectionList = await screen.findByRole("listbox", { name: "Sections" });
    fireEvent.click(within(sectionList).getByRole("option", { name: /001/ }));
    const prompt = `${(composer as HTMLTextAreaElement).value} /20rules`;
    fireEvent.change(composer, { target: { value: prompt, selectionStart: prompt.length } });
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(chatWithContext).toHaveBeenCalledTimes(1));
    const callArgs = vi.mocked(chatWithContext).mock.calls[0];
    const systemPrompt = callArgs[2][0]?.content as string;
    const userPrompt = callArgs[2][1]?.content as string;

    expect(systemPrompt).toContain("20 Rules of Knowledge Formulation");
    expect(systemPrompt).toContain("MINIMUM INFORMATION PRINCIPLE");
    expect(userPrompt).toContain("LIGHT_REACTIONS_DETAIL");
  });

  // Issue #44 bug 03: a picked # chip vanished on the next keystroke because
  // insertion wrote the title while filtering keyed on ids.
  it("keeps a picked section chip across keystrokes and history restore", async () => {
    const chapters: SectionNode[] = [
      {
        id: "sec-001",
        title: "001",
        content: "CHAPTER_ONE_CONTENT",
        level: 1,
        source: "media-transcript",
        documentId: "doc-1",
        preview: "CHAPTER_ONE_CONTENT",
        parentId: null,
        children: [],
        breadcrumb: ["Transcript"],
      },
    ];
    sectionHookState.flat = chapters;
    sectionHookState.tree = chapters;
    useDocumentOutlineStore.setState({
      mediaSectionsByDocId: new Map([["doc-1", chapters]]),
    });
    useLLMProvidersStore.setState({
      providers: [{
        id: "provider-1",
        provider: "openai",
        name: "Test provider",
        apiKey: "test-key",
        model: "test-model",
        enabled: true,
        temperature: 0.2,
        maxTokens: 1000,
      }],
    });
    vi.mocked(chatWithContext).mockResolvedValue({ content: "ok" } as never);

    render(<DocumentQATab />);
    selectFocusDocument();
    const composer = screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "#", selectionStart: 1 } });
    const sectionList = await screen.findByRole("listbox", { name: "Sections" });
    fireEvent.click(within(sectionList).getByRole("option", { name: /001/ }));

    // The pick inserted a stable id token, not the title.
    expect(composer.value).toContain("#{sec-001}");

    // Typing after the pick must not drop the chip.
    const withSuffix = `${composer.value}summarize`;
    fireEvent.change(composer, { target: { value: withSuffix, selectionStart: withSuffix.length } });
    expect(composer.value).toContain("#{sec-001}");
    expect(screen.getByText("Transcript > 001")).toBeInTheDocument();

    // Send, then restore via history: the raw token history brings the chip
    // back with its section selected.
    fireEvent.keyDown(composer, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(chatWithContext).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(composer, { key: "ArrowUp" });
    await waitFor(() => expect(composer.value).toContain("#{sec-001}"));
    expect(screen.getByText("Transcript > 001")).toBeInTheDocument();
  });
});


const groundedResult = () => ({
  answer: { answer: "Cells share a common structure [1].", sourceRefs: [{ refId: "chunk-1", quote: "Cells share a common structure." }], evidenceLevel: "supported" },
  sources: [{ chunkId: "chunk-1", documentId: "doc-1", documentTitle: "Biology Textbook", sourceType: "document", text: "Cells share a common structure.", location: { ordinal: 0 }, score: 1 }],
  retrievalOnly: false, mode: "semantic",
});
const questionInput = () => screen.getByRole("textbox", { name: "Your question" }) as HTMLTextAreaElement;

describe("Document Q&A workspace entry", () => {
  it("opens cleanly while preserving and restoring the previous draft and conversation", async () => {
    const old = createSession({ selectedDocumentId: "doc-1", messages: [userMsg("Earlier research")],
      draft: { text: "@{doc-1} #{cells} Explain this", sections: [{ id: "cells", title: "Cells", documentId: "doc-1" }] } });
    saveSessions([old]); setActiveSessionId(old.id);
    useLibraryAskHandoffStore.getState().requestOpen();
    const view = render(<DocumentQATab />);
    await waitFor(() => expect(useLibraryAskHandoffStore.getState().pending).toBeNull());
    expect(questionInput().value).toBe("");
    expect(localStorage.getItem(STORAGE_KEYS.activeSession)).not.toBe(old.id);
    expect(loadSessions().find((session) => session.id === old.id)?.draft?.text).toBe("@{doc-1} #{cells} Explain this");
    fireEvent.click(screen.getByText("Earlier research"));
    await waitFor(() => expect(questionInput().value).toBe("@{doc-1} #{cells} Explain this"));
    view.unmount();
    render(<DocumentQATab />);
    expect(questionInput().value).toBe("@{doc-1} #{cells} Explain this");
    expect(chatWithContext).not.toHaveBeenCalled(); expect(askLibrary).not.toHaveBeenCalled();
  });

  it("prefills a complete document suggestion exactly once under Strict Mode", async () => {
    useLibraryAskHandoffStore.getState().requestAsk({ question: "Explain cell division", documentId: "doc-1" });
    render(<StrictMode><DocumentQATab /></StrictMode>);
    await waitFor(() => expect(questionInput().value).toBe("Explain cell division"));
    expect(screen.getByRole("button", { name: "Choose sources" })).toHaveTextContent("Biology Textbook");
    expect(loadSessions()).toHaveLength(2);
    expect(askLibrary).not.toHaveBeenCalled(); expect(chatWithContext).not.toHaveBeenCalled();
  });

  it("dismisses a source picker before focusing a palette handoff", async () => {
    render(<DocumentQATab />);
    fireEvent.click(screen.getByRole("button", { name: "Choose sources" }));
    act(() => useLibraryAskHandoffStore.getState().requestAsk({ question: "A new question", documentId: "doc-1" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(questionInput()).toHaveFocus());
    expect(questionInput().value).toBe("A new question");
  });

  it("does not force input focus when a touch user opens the workspace", async () => {
    const original = window.matchMedia.bind(window);
    const media = vi.spyOn(window, "matchMedia").mockImplementation((query) => {
      const result = original(query);
      return query === "(pointer: coarse)" ? { ...result, matches: true } : result;
    });
    try {
      useLibraryAskHandoffStore.getState().requestOpen();
      render(<DocumentQATab />);
      await waitFor(() => expect(useLibraryAskHandoffStore.getState().pending).toBeNull());
      expect(questionInput()).not.toHaveFocus();
    } finally { media.mockRestore(); }
  });

  it("reuses a clean conversation on repeated bare entries", async () => {
    useLibraryAskHandoffStore.getState().requestOpen();
    render(<DocumentQATab />);
    await waitFor(() => expect(useLibraryAskHandoffStore.getState().pending).toBeNull());
    const id = localStorage.getItem(STORAGE_KEYS.activeSession);
    act(() => useLibraryAskHandoffStore.getState().requestOpen());
    await waitFor(() => expect(useLibraryAskHandoffStore.getState().pending).toBeNull());
    expect(localStorage.getItem(STORAGE_KEYS.activeSession)).toBe(id);
    expect(loadSessions()).toHaveLength(1);
    await waitFor(() => expect(questionInput()).toHaveFocus());
  });

  it("keeps an in-flight answer in its original session before applying queued entry", async () => {
    let finish!: (value: never) => void;
    vi.mocked(askLibrary).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<DocumentQATab />);
    fireEvent.click(screen.getByRole("button", { name: /^Answer from:/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^My library/ }));
    const id = localStorage.getItem(STORAGE_KEYS.activeSession);
    fireEvent.change(questionInput(), { target: { value: "How do cells work?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(askLibrary).toHaveBeenCalledTimes(1));
    act(() => useLibraryAskHandoffStore.getState().requestOpen());
    expect(screen.getByText(/This answer will finish/)).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEYS.activeSession)).toBe(id);
    await act(async () => finish(groundedResult() as never));
    await waitFor(() => expect(useLibraryAskHandoffStore.getState().pending).toBeNull());
    expect(loadSessions().find((session) => session.id === id)?.messages.some((message) => message.content.includes("common structure"))).toBe(true);
    const active = loadSessions().find((session) => session.id === localStorage.getItem(STORAGE_KEYS.activeSession));
    expect(active?.id).not.toBe(id); expect(active?.messages).toEqual([]);
  });

  it("uses selected-document retrieval and preserves source evidence on reload", async () => {
    vi.mocked(askLibrary).mockResolvedValue(groundedResult() as never);
    const view = render(<DocumentQATab />); selectFocusDocument();
    fireEvent.change(questionInput(), { target: { value: "Explain cells" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(askLibrary).toHaveBeenCalledWith(expect.objectContaining({ query: "Explain cells", filters: { documentIds: ["doc-1"] } })));
    await screen.findByText("Cells share a common structure [1].");
    view.unmount(); render(<DocumentQATab />);
    expect(screen.getByText(/Source documents: 1/)).toBeInTheDocument();
    const answer = useDocumentQAStore.getState().messages.find((message) => message.role === "assistant");
    expect(answer?.submittedScope?.label).toBe("Biology Textbook");
    expect(answer?.citations?.[0].citationNumber).toBe(1);
  });

  it("retries explicitly without duplicating the failed user turn", async () => {
    vi.mocked(askLibrary).mockRejectedValueOnce(new Error("index unavailable")).mockResolvedValueOnce(groundedResult() as never);
    render(<DocumentQATab />);
    fireEvent.click(screen.getByRole("button", { name: /^Answer from:/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^My library/ }));
    fireEvent.change(questionInput(), { target: { value: "Explain cells" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText(/Could not answer from these sources/);
    fireEvent.click(screen.getByRole("button", { name: "Review and retry" }));
    expect(askLibrary).toHaveBeenCalledTimes(1); expect(questionInput().value).toBe("Explain cells");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("Cells share a common structure [1].");
    expect(useDocumentQAStore.getState().messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(chatWithContext).not.toHaveBeenCalled();
  });

  it("preserves the live draft and session if storage fails during a new conversation", async () => {
    render(<DocumentQATab />);
    fireEvent.change(questionInput(), { target: { value: "Keep this unsent question" } });
    const id = localStorage.getItem(STORAGE_KEYS.activeSession);
    const original = Storage.prototype.setItem;
    const failure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === STORAGE_KEYS.sessions) throw new Error("quota");
      original.call(this, key, value);
    });
    fireEvent.click(screen.getAllByRole("button", { name: "New conversation" })[0]);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save this conversation");
    expect(questionInput().value).toBe("Keep this unsent question");
    expect(localStorage.getItem(STORAGE_KEYS.activeSession)).toBe(id);
    failure.mockRestore();
  });

  it("imports into an empty library without losing the typed question", async () => {
    const importDocuments = vi.fn().mockResolvedValue([]);
    const previous = useDocumentStore.getState().openFilePickerAndImport;
    useDocumentStore.setState({ documents: [], openFilePickerAndImport: importDocuments });
    render(<DocumentQATab />);
    fireEvent.change(questionInput(), { target: { value: "My future question" } });
    fireEvent.click(screen.getByRole("button", { name: "Import documents" }));
    await waitFor(() => expect(importDocuments).toHaveBeenCalledTimes(1));
    expect(questionInput().value).toBe("My future question");
    expect(screen.getByRole("button", { name: "Ask" })).not.toBeDisabled();
    useDocumentStore.setState({ openFilePickerAndImport: previous });
  });

  it("makes starters editable, protects existing text and ignores IME Enter", async () => {
    render(<DocumentQATab />);
    fireEvent.click(screen.getByRole("button", { name: "Compare viewpoints" }));
    expect(questionInput().value).toContain("agree or disagree");
    expect(screen.getByRole("button", { name: "Find connections" })).toBeDisabled();
    fireEvent.keyDown(questionInput(), { key: "Enter", isComposing: true });
    expect(askLibrary).not.toHaveBeenCalled(); expect(chatWithContext).not.toHaveBeenCalled();
  });

  it("prepares a summary only after choosing a document and focuses the editable question", async () => {
    render(<DocumentQATab />);
    fireEvent.click(screen.getByRole("button", { name: "Summarize a document" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Biology Textbook" }));
    await waitFor(() => expect(questionInput()).toHaveFocus());
    expect(questionInput().value).toContain("Summarize the main arguments");
    expect(screen.getByRole("button", { name: "Choose sources" })).toHaveTextContent("Biology Textbook");
    expect(askLibrary).not.toHaveBeenCalled();
  });

  it("bounds the source picker to metadata for 3,000 documents", async () => {
    const docs = Array.from({ length: 3000 }, (_, index) => ({ id: `doc-${index}`, title: `Research source ${index}`, tags: [] }));
    useDocumentStore.setState({ documents: docs as never });
    vi.mocked(getDocument).mockClear(); vi.mocked(extractDocumentText).mockClear();
    render(<DocumentQATab />);
    fireEvent.click(screen.getByRole("button", { name: "Choose sources" }));
    const list = screen.getByRole("list", { name: "Choose document" });
    expect(within(list).getAllByRole("button")).toHaveLength(60);
    fireEvent.change(screen.getByLabelText("Search your documents"), { target: { value: "Research source 2999" } });
    fireEvent.click(screen.getByRole("button", { name: "Research source 2999" }));
    expect(screen.getByRole("button", { name: "Choose sources" })).toHaveTextContent("Research source 2999");
    expect(getDocument).not.toHaveBeenCalled(); expect(extractDocumentText).not.toHaveBeenCalled(); expect(askLibrary).not.toHaveBeenCalled();
  });

  it("renders the scope selector adjacent to composer sources rather than as an isolated root column", () => {
    const { container } = render(<DocumentQATab />);
    const workspace = container.querySelector(".document-qa-workspace");
    expect(workspace).toBeInTheDocument();
    // Verify the first child of the root workspace is NOT the scope picker wrapper div
    expect(workspace?.children[0]?.querySelector?.('[data-assistant-answer-from]')).toBeNull();
    // Verify the scope picker exists adjacent to the composer sources
    expect(screen.getByRole("button", { name: /^Answer from:/ }).closest(".qa-composer-wrap")).not.toBeNull();
  });
});

describe("DocumentQATab transcript coverage disclosure", () => {
  const assistantWithEvidence = (id: string, evidence: QAMessage["evidence"]): QAMessage => ({
    id,
    role: "assistant",
    content: "The video's main claim is precise neural control.",
    timestamp: 2_000,
    sourceDocuments: ["doc-1"],
    evidence,
  });

  it("renders the actual transcript coverage beside the evidence summary", async () => {
    const session = createSession({
      selectedDocumentId: "doc-1",
      messages: [
        assistantWithEvidence("assistant-full", {
          level: "supported",
          retrievalOnly: false,
          mode: "semantic",
          documentCount: 1,
          coverage: "hierarchical-full",
          transcriptStatus: "ready-full",
        }),
      ],
    });
    saveSessions([session]);
    setActiveSessionId(session.id);

    render(<DocumentQATab />);

    expect(await screen.findByText(/Source documents: 1 · Full-transcript synthesis/)).toBeInTheDocument();
  });

  it("discloses an unavailable transcript instead of presenting fragments as the video", async () => {
    const session = createSession({
      selectedDocumentId: "doc-1",
      messages: [
        assistantWithEvidence("assistant-no-transcript", {
          level: "weak",
          retrievalOnly: false,
          mode: "semantic",
          documentCount: 1,
          coverage: "chunks",
          transcriptStatus: "unavailable",
        }),
      ],
    });
    saveSessions([session]);
    setActiveSessionId(session.id);

    render(<DocumentQATab />);

    expect(await screen.findByText(/Transcript unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Selected passages/)).toBeInTheDocument();
  });

  it("renders legacy evidence without coverage fields unchanged", async () => {
    const session = createSession({
      selectedDocumentId: "doc-1",
      messages: [
        assistantWithEvidence("assistant-legacy", {
          level: "supported",
          retrievalOnly: false,
          mode: "semantic",
          documentCount: 2,
        }),
      ],
    });
    saveSessions([session]);
    setActiveSessionId(session.id);

    render(<DocumentQATab />);

    expect(await screen.findByText("Source documents: 2")).toBeInTheDocument();
    expect(screen.queryByText(/Full transcript|Selected passages|Transcript unavailable/)).toBeNull();
  });
});
