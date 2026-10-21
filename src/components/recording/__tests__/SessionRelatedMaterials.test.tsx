import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionRelatedMaterials } from "../SessionRelatedMaterials";
import * as recordingSessionsApi from "../../../api/recordingSessions";
import * as openDocUtil from "../../../utils/openDocumentAtLocation";
import { useDocumentStore } from "../../../stores/documentStore";
import type { RecordingSession, SessionRelatedDocument } from "../../../types/recordingSession";
import type { Document } from "../../../types/document";

vi.mock("../../../api/recordingSessions", () => ({
  associateSessionDocument: vi.fn(),
  disassociateSessionDocument: vi.fn(),
  listSessionRelatedDocuments: vi.fn(),
}));

vi.mock("../../../utils/openDocumentAtLocation", () => ({
  openDocumentAtLocation: vi.fn(),
}));

describe("SessionRelatedMaterials (Task 5.3)", () => {
  const baseSession: RecordingSession = {
    id: "sess-materials-1",
    documentId: "doc-session-main",
    version: 1,
    origin: "recorded",
    contentType: "lecture",
    profileJson: "{}",
    mediaAssetId: "asset-1",
    transcriptId: 10,
    transcriptRevision: 2,
    overviewJson: null,
    overviewRevision: null,
    ingestionState: "saved",
    captureState: "saved",
    createdAt: "2026-10-20T12:00:00Z",
    updatedAt: "2026-10-20T12:00:00Z",
  };

  const sampleLibraryDocs: Document[] = [
    {
      id: "doc-slides-pdf",
      title: "Lecture 01 Slides",
      filePath: "/docs/slides.pdf",
      fileType: "pdf",
      tags: [],
      dateAdded: "2026-10-20",
      dateModified: "2026-10-20",
      extractCount: 0,
      learningItemCount: 0,
      priorityRating: 0,
      prioritySlider: 0,
      priorityScore: 0,
      isArchived: false,
      isFavorite: false,
      isLocalOnly: true,
      isAiExcluded: false,
    },
    {
      id: "doc-reading-epub",
      title: "Chapter 3 Reading",
      filePath: "/docs/chapter3.epub",
      fileType: "epub",
      tags: [],
      dateAdded: "2026-10-20",
      dateModified: "2026-10-20",
      extractCount: 0,
      learningItemCount: 0,
      priorityRating: 0,
      prioritySlider: 0,
      priorityScore: 0,
      isArchived: false,
      isFavorite: false,
      isLocalOnly: false,
      isAiExcluded: true,
    },
    {
      id: "doc-session-main", // Session's own document - should be filtered out from picker!
      title: "Session Audio Doc",
      filePath: "/docs/audio.mp3",
      fileType: "audio",
      tags: [],
      dateAdded: "2026-10-20",
      dateModified: "2026-10-20",
      extractCount: 0,
      learningItemCount: 0,
      priorityRating: 0,
      prioritySlider: 0,
      priorityScore: 0,
      isArchived: false,
      isFavorite: false,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    useDocumentStore.setState({ documents: sampleLibraryDocs });
  });

  it("renders empty state when no materials are associated", async () => {
    vi.mocked(recordingSessionsApi.listSessionRelatedDocuments).mockResolvedValue([]);

    render(<SessionRelatedMaterials session={baseSession} />);

    await waitFor(() => {
      expect(
        screen.getByText(/No related slides or documents associated yet/)
      ).toBeInTheDocument();
    });
  });

  it("lists associated materials with filetype and independent privacy badges", async () => {
    const initialList: SessionRelatedDocument[] = [
      {
        id: "doc-slides-pdf",
        title: "Lecture 01 Slides",
        fileType: "pdf",
        isLocalOnly: true,
        isAiExcluded: false,
        isAvailable: true,
      },
      {
        id: "doc-reading-epub",
        title: "Chapter 3 Reading",
        fileType: "epub",
        isLocalOnly: false,
        isAiExcluded: true,
        isAvailable: true,
      },
    ];
    vi.mocked(recordingSessionsApi.listSessionRelatedDocuments).mockResolvedValue(initialList);

    render(<SessionRelatedMaterials session={baseSession} />);

    await waitFor(() => {
      expect(screen.getByText("Lecture 01 Slides")).toBeInTheDocument();
      expect(screen.getByText("Chapter 3 Reading")).toBeInTheDocument();
    });

    // Check independent privacy badges
    expect(screen.getByText("Local-only")).toBeInTheDocument();
    expect(screen.getByText("AI excluded")).toBeInTheDocument();
  });

  it("attaches a new document from library via picker modal", async () => {
    vi.mocked(recordingSessionsApi.listSessionRelatedDocuments).mockResolvedValue([]);
    const updatedList: SessionRelatedDocument[] = [
      {
        id: "doc-slides-pdf",
        title: "Lecture 01 Slides",
        fileType: "pdf",
        isLocalOnly: true,
        isAiExcluded: false,
        isAvailable: true,
      },
    ];
    vi.mocked(recordingSessionsApi.associateSessionDocument).mockResolvedValue(updatedList);

    render(<SessionRelatedMaterials session={baseSession} />);

    await waitFor(() => {
      expect(screen.getByText(/No related slides/)).toBeInTheDocument();
    });

    // Open attach dialog
    fireEvent.click(screen.getByRole("button", { name: "Attach related material" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Attach Material from Library")).toBeInTheDocument();

    // Verify session's own document (doc-session-main) is NOT in the picker options
    const select = screen.getByLabelText("Choose Document");
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(options).toContain("doc-slides-pdf");
    expect(options).toContain("doc-reading-epub");
    expect(options).not.toContain("doc-session-main");

    // Select PDF
    fireEvent.change(select, { target: { value: "doc-slides-pdf" } });

    // Click Attach button
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));

    await waitFor(() => {
      expect(recordingSessionsApi.associateSessionDocument).toHaveBeenCalledWith(
        "sess-materials-1",
        "doc-slides-pdf"
      );
    });

    // Verify list updated
    await waitFor(() => {
      expect(screen.getByText("Lecture 01 Slides")).toBeInTheDocument();
    });
  });

  it("disassociates a document when remove button is clicked", async () => {
    const initialList: SessionRelatedDocument[] = [
      {
        id: "doc-slides-pdf",
        title: "Lecture 01 Slides",
        fileType: "pdf",
        isLocalOnly: false,
        isAiExcluded: false,
        isAvailable: true,
      },
    ];
    vi.mocked(recordingSessionsApi.listSessionRelatedDocuments).mockResolvedValue(initialList);
    vi.mocked(recordingSessionsApi.disassociateSessionDocument).mockResolvedValue([]);

    render(<SessionRelatedMaterials session={baseSession} />);

    await waitFor(() => {
      expect(screen.getByText("Lecture 01 Slides")).toBeInTheDocument();
    });

    // Click remove button
    fireEvent.click(screen.getByLabelText("Remove Lecture 01 Slides"));

    await waitFor(() => {
      expect(recordingSessionsApi.disassociateSessionDocument).toHaveBeenCalledWith(
        "sess-materials-1",
        "doc-slides-pdf"
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/No related slides/)).toBeInTheDocument();
    });
  });

  it("handles deleted PDF gracefully with unavailable indicator and safe removal", async () => {
    const listWithDeleted: SessionRelatedDocument[] = [
      {
        id: "doc-deleted-pdf",
        title: "Missing Syllabus.pdf",
        fileType: "pdf",
        isLocalOnly: false,
        isAiExcluded: false,
        isAvailable: false,
      },
    ];
    vi.mocked(recordingSessionsApi.listSessionRelatedDocuments).mockResolvedValue(listWithDeleted);
    vi.mocked(recordingSessionsApi.disassociateSessionDocument).mockResolvedValue([]);

    render(<SessionRelatedMaterials session={baseSession} />);

    await waitFor(() => {
      expect(screen.getByText("Missing Syllabus.pdf")).toBeInTheDocument();
      expect(screen.getByText("Deleted from library")).toBeInTheDocument();
    });

    // Open button should NOT be rendered for deleted document
    expect(screen.queryByLabelText("Open Missing Syllabus.pdf")).not.toBeInTheDocument();

    // Remove button should be available and functional
    fireEvent.click(screen.getByLabelText("Remove Missing Syllabus.pdf"));

    await waitFor(() => {
      expect(recordingSessionsApi.disassociateSessionDocument).toHaveBeenCalledWith(
        "sess-materials-1",
        "doc-deleted-pdf"
      );
    });
  });

  it("navigates to source via openDocumentAtLocation without altering transcript or cards", async () => {
    const docItem: SessionRelatedDocument = {
      id: "doc-slides-pdf",
      title: "Lecture 01 Slides",
      fileType: "pdf",
      isLocalOnly: false,
      isAiExcluded: false,
      isAvailable: true,
    };
    vi.mocked(recordingSessionsApi.listSessionRelatedDocuments).mockResolvedValue([docItem]);
    vi.mocked(openDocUtil.openDocumentAtLocation).mockResolvedValue(true);

    render(<SessionRelatedMaterials session={baseSession} />);

    await waitFor(() => {
      expect(screen.getByText("Lecture 01 Slides")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Open Lecture 01 Slides"));

    await waitFor(() => {
      expect(openDocUtil.openDocumentAtLocation).toHaveBeenCalledWith(
        "doc-slides-pdf",
        { ensureExists: true },
        expect.any(Function)
      );
    });
  });
});
