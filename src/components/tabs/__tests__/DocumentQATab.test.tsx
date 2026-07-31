import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// --- Mocks -----------------------------------------------------------------

// Real session store (pure localStorage) is exercised directly via imports.
vi.mock("../../../api/llm", () => ({ chatWithContext: vi.fn() }));
vi.mock("../../../api/documents", () => ({
  getDocument: vi.fn().mockResolvedValue(null),
  extractDocumentText: vi.fn().mockResolvedValue({ content: "" }),
}));
vi.mock("../../../api/extracts", () => ({ getExtracts: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../api/mcp", () => ({
  callIncrementumMCPTool: vi.fn(),
  getIncrementumMCPTools: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../api/integrations", () => ({
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
  createDocumentQaRequestContent: vi.fn().mockReturnValue({ userPromptContent: "", contextContent: "" }),
  loadDocumentQaText: vi.fn().mockResolvedValue(""),
}));
vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return { ...actual, invokeCommand: vi.fn().mockResolvedValue(null), isTauri: () => false };
});
vi.mock("../../../utils/markdown", () => ({ renderMarkdown: (s: string) => s }));
vi.mock("../../../hooks/useDocumentSections", () => ({
  useDocumentSections: () => ({ tree: [], flat: [], getById: () => undefined }),
}));

// Seed a single document so the tab renders past the empty-documents guard.
import { useDocumentStore } from "../../../stores/documentStore";
beforeEach(() => {
  useDocumentStore.setState({
    documents: [{ id: "doc-1", title: "Biology Textbook", content: "cell biology" } as never],
    currentDocument: null,
  });
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

// --- Tests -----------------------------------------------------------------

describe("DocumentQATab sessions sidebar", () => {
  it("renders the sidebar with a New chat button and chat history heading", () => {
    render(<DocumentQATab />);
    expect(screen.getByText("Chat history")).toBeInTheDocument();
    expect(screen.getAllByText("New chat").length).toBeGreaterThan(0);
  });

  it("starts a new chat and preserves the prior session in the list", async () => {
    // Seed an existing active session with a message.
    const existing = createSession({ messages: [userMsg("prior question")] });
    saveSessions([existing]);
    setActiveSessionId(existing.id);

    render(<DocumentQATab />);

    // Click the sidebar "New chat" button (the one inside the sidebar header,
    // which sits within the chat history aside).
    const aside = screen.getByText("Chat history").closest("aside")!;
    const newChatBtn = within(aside).getByText("New chat");
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
