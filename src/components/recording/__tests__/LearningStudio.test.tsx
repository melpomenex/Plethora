import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LearningStudio } from "../LearningStudio";
import * as recordingSessionsApi from "../../../api/recordingSessions";
import * as documentPrivacyModule from "../../../lib/documentPrivacy";
import type { RecordingSession } from "../../../types/recordingSession";

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("../../../api/recordingSessions", () => ({
  findSessionByDocumentId: vi.fn(),
  getRecordingAsset: vi.fn(),
  getSessionSegments: vi.fn().mockResolvedValue({ items: [], revision: 1 }),
  listSessionMarkers: vi.fn().mockResolvedValue([]),
  listSessionLearningDrafts: vi.fn().mockResolvedValue({ items: [], total: 0, hasMore: false }),
  listSessionRelatedDocuments: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../lib/documentPrivacy", () => ({
  getDocumentPrivacy: vi.fn(),
}));

describe("LearningStudio Component", () => {
  const mockSession: RecordingSession = {
    id: "sess-studio-1",
    version: 1,
    documentId: "doc-123",
    origin: "recorded",
    contentType: "lecture",
    profileJson: "{}",
    mediaAssetId: null,
    transcriptId: null,
    transcriptRevision: 0,
    overviewJson: null,
    overviewRevision: null,
    ingestionState: "saved",
    captureState: "saved",
    createdAt: "2026-10-20T12:00:00Z",
    updatedAt: "2026-10-20T12:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(recordingSessionsApi.findSessionByDocumentId).mockResolvedValue(mockSession);
    vi.mocked(documentPrivacyModule.getDocumentPrivacy).mockResolvedValue({
      isLocalOnly: true,
      isAiExcluded: false,
      privacyVersion: 1,
    });
  });

  it("resolves session by documentId and renders overview by default", async () => {
    render(
      <LearningStudio
        documentId="doc-123"
        documentTitle="Lecture on Machine Learning"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Lecture on Machine Learning")).toBeInTheDocument();
    });

    expect(screen.getByRole("tab", { name: /Overview/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Transcript/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Extracts/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Flashcards/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Ask Plethora/i })).toBeInTheDocument();
    expect(screen.getByTestId("tab-overview")).toBeInTheDocument();
  });

  it("switches tabs between Overview, Transcript, Extracts, Flashcards, and Ask", async () => {
    render(
      <LearningStudio
        session={mockSession}
        documentTitle="Algorithms 101"
      />
    );

    // Initial is Overview
    expect(screen.getByTestId("tab-overview")).toBeInTheDocument();

    // Click Transcript tab
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /Transcript/i }));
    });
    expect(screen.getByTestId("tab-transcript")).toBeInTheDocument();

    // Click Extracts tab
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /Extracts/i }));
    });
    expect(screen.getByTestId("tab-extracts")).toBeInTheDocument();

    // Click Flashcards tab
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /Flashcards/i }));
    });
    expect(screen.getByTestId("tab-flashcards")).toBeInTheDocument();

    // Click Ask Plethora tab
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: /Ask Plethora/i }));
    });
    expect(screen.getByTestId("tab-ask")).toBeInTheDocument();
  });

  it("calls onBack when Back button is clicked", async () => {
    const handleBack = vi.fn();
    render(
      <LearningStudio
        session={mockSession}
        documentTitle="Physics Lecture"
        onBack={handleBack}
      />
    );

    const backButton = screen.getByRole("button", { name: "Back" });
    act(() => {
      fireEvent.click(backButton);
    });
    expect(handleBack).toHaveBeenCalledTimes(1);
  });

  it("shows local-only and AI-excluded privacy indicators truthfully", async () => {
    vi.mocked(documentPrivacyModule.getDocumentPrivacy).mockResolvedValue({
      isLocalOnly: true,
      isAiExcluded: true,
      privacyVersion: 1,
    });

    render(
      <LearningStudio
        documentId="doc-123"
        session={mockSession}
        documentTitle="Private Notes"
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText("Local only").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/AI excluded/i).length).toBeGreaterThanOrEqual(1);
    });
  });
});
