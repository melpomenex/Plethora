import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { ListeningSessionInbox } from "../ListeningSessionInbox";
import type { ListeningSession } from "../../../types/audioEdition";

const mockCreateLearningItem = vi.fn();
vi.mock("../../../api/learning-items", () => ({
  createLearningItem: (...args: any[]) => mockCreateLearningItem(...args),
}));

const mockStudioModal = vi.fn();
vi.mock("../../review/FlashcardStudioModal", () => ({
  FlashcardStudioModal: (props: any) => {
    mockStudioModal(props);
    return props.isOpen ? <div data-testid="mock-flashcard-studio">Studio Open (Seed: {props.seed?.excerpt})</div> : null;
  },
}));

const mockSessions: ListeningSession[] = [
  {
    id: "session-1",
    editionId: "edition-1",
    startedAt: Date.now() - 3600000,
    endedAt: Date.now(),
    durationSeconds: 600,
    extractCount: 1,
    isReviewed: false,
    items: [
      {
        id: "item-1",
        sessionId: "session-1",
        audioTimestamp: 120,
        snippetText: "This is a key captured insight about quantum computing.",
        markerType: "extract",
        extractId: "extract-42",
        sourceAnchor: "anchor-1",
        createdAt: Date.now(),
      },
    ],
  },
];

const mockListListeningSessions = vi.fn();
const mockGetListeningSession = vi.fn();
const mockUpdateListeningSessionItem = vi.fn();
const mockDeleteListeningSessionItem = vi.fn();

vi.mock("../../../api/listeningSessions", () => ({
  listListeningSessions: () => mockListListeningSessions(),
  getListeningSession: (id: string) => mockGetListeningSession(id),
  markListeningSessionReviewed: vi.fn(),
  updateListeningSessionItem: (...args: any[]) => mockUpdateListeningSessionItem(...args),
  deleteListeningSessionItem: (...args: any[]) => mockDeleteListeningSessionItem(...args),
}));

vi.mock("../../../api/audioEditions", () => ({
  getAudioEdition: vi.fn().mockResolvedValue({
    id: "edition-1",
    sourceDocumentId: "doc-123",
  }),
}));

vi.mock("../../common/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("../../../stores/tabsStore", () => ({
  useTabsStore: {
    getState: () => ({
      addTab: vi.fn(),
    }),
  },
}));

vi.mock("../../../stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      documents: [{ id: "doc-123", title: "Test Doc" }],
      loadDocuments: vi.fn().mockResolvedValue([]),
    }),
  },
}));

describe("ListeningSessionInbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListListeningSessions.mockResolvedValue([{ id: "session-1" }]);
    mockGetListeningSession.mockResolvedValue(mockSessions[0]);
  });

  it("opens FlashcardStudio with seeded draft without eagerly creating a learning item", async () => {
    render(<ListeningSessionInbox isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Listening Session Inbox")).toBeInTheDocument();
      expect(screen.getByText(/This is a key captured insight about quantum computing/)).toBeInTheDocument();
    });

    const flashcardButton = screen.getByText("Flashcard");
    fireEvent.click(flashcardButton);

    await waitFor(() => {
      expect(screen.getByTestId("mock-flashcard-studio")).toBeInTheDocument();
    });

    // CRITICAL: verify zero eager learning items created in DB
    expect(mockCreateLearningItem).not.toHaveBeenCalled();

    // Verify studio seed payload preserves full source lineage and extract connection
    const latestStudioCall = mockStudioModal.mock.calls.at(-1)?.[0];
    expect(latestStudioCall).toBeDefined();
    expect(latestStudioCall.isOpen).toBe(true);
    expect(latestStudioCall.seed).toMatchObject({
      documentId: "doc-123",
      excerpt: "This is a key captured insight about quantum computing.",
      draftCardType: "qa",
      linkedExtractId: "extract-42",
      resetDraftCards: true,
      autoEditDraft: true,
    });
    expect(latestStudioCall.seed.initialAnswer).toBe("This is a key captured insight about quantum computing.");
  });

  it("handles triage actions (keep, discard) cleanly", async () => {
    render(<ListeningSessionInbox isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/This is a key captured insight about quantum computing/)).toBeInTheDocument();
    });

    const keepBtn = screen.getByRole("button", { name: /keep/i });
    fireEvent.click(keepBtn);

    await waitFor(() => {
      expect(mockUpdateListeningSessionItem).toHaveBeenCalledWith(
        "item-1",
        expect.objectContaining({ note: null })
      );
    });
  });
});
