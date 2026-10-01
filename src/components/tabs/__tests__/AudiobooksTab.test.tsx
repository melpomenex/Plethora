import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { AudiobooksTab } from "../AudiobooksTab";
import { useDocumentStore } from "../../../stores";
import { useAudioEditionGenerationStore } from "../../../stores/audioEditionGenerationStore";
import type { AudioEdition } from "../../../types/audioEdition";

const mockListAudioEditions = vi.fn<() => Promise<AudioEdition[]>>();

vi.mock("../../../api/audioEditions", () => ({
  listAudioEditions: () => mockListAudioEditions(),
}));

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    isTauri: () => false,
    isNativeMobile: () => false,
    isNativePhone: () => false,
    getPlatform: () => "linux",
    invokeCommand: vi.fn(),
  };
});

describe("AudiobooksTab - Audio Edition Generation Shelf & Controls", () => {
  const testDoc = {
    id: "doc-text-1",
    title: "Philosophy of Logic",
    filePath: "/books/logic.epub",
    fileType: "epub" as const,
    tags: ["Philosophy"],
    dateAdded: "2024-01-01T00:00:00.000Z",
    dateModified: "2024-01-01T00:00:00.000Z",
    extractCount: 0,
    learningItemCount: 0,
    isArchived: false,
    isFavorite: false,
  };

  const testEdition: AudioEdition = {
    id: "ed-logic-1",
    sourceDocumentId: "doc-text-1",
    sourceRevisionHash: "hash-123",
    provider: "pocket",
    model: "default",
    voice: "voice-1",
    totalDurationSec: 120,
    status: "generating",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sections: [
      {
        id: "sec-1",
        editionId: "ed-logic-1",
        sectionIndex: 0,
        title: "Chapter 1",
        characterCount: 500,
        audioMimeType: "audio/mp3",
        durationSec: 120,
        generationStatus: "ready",
        retryCount: 0,
        cacheKey: "k1",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: "sec-2",
        editionId: "ed-logic-1",
        sectionIndex: 1,
        title: "Chapter 2",
        characterCount: 600,
        audioMimeType: "audio/mp3",
        durationSec: 0,
        generationStatus: "generating",
        retryCount: 0,
        cacheKey: "k2",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: "sec-3",
        editionId: "ed-logic-1",
        sectionIndex: 2,
        title: "Chapter 3",
        characterCount: 700,
        audioMimeType: "audio/mp3",
        durationSec: 0,
        generationStatus: "queued",
        retryCount: 0,
        cacheKey: "k3",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useDocumentStore.setState({
      documents: [testDoc],
    });
    useAudioEditionGenerationStore.setState({
      jobs: {},
      activeJobs: [],
      isGlobalPaused: false,
    });
    mockListAudioEditions.mockResolvedValue([testEdition]);
  });

  it("prioritizes generating status badge over partial readiness", async () => {
    // 1 of 3 sections is ready, but job is actively generating
    useAudioEditionGenerationStore.setState({
      jobs: {
        "ed-logic-1": {
          editionId: "ed-logic-1",
          documentId: "doc-text-1",
          status: "generating",
          totalSections: 3,
          completedSections: 1,
          failedSections: 0,
          currentSectionId: "sec-2",
          progressPercent: 33,
        },
      },
      activeJobs: ["ed-logic-1"],
    });

    render(<AudiobooksTab />);

    await waitFor(() => {
      expect(screen.getByTestId("edition-card-ed-logic-1")).toBeInTheDocument();
    });

    const badge = screen.getByTestId("edition-status-badge-ed-logic-1");
    // Must display Generating 33%, NOT "1/3 ready"
    expect(badge.textContent).toBe("Generating 33%");
    expect(badge.className).toContain("text-blue-600");
  });

  it("renders progress bar, section counter, and allows pausing an active job", async () => {
    const pauseJobSpy = vi.spyOn(useAudioEditionGenerationStore.getState(), "pauseJob");

    useAudioEditionGenerationStore.setState({
      jobs: {
        "ed-logic-1": {
          editionId: "ed-logic-1",
          documentId: "doc-text-1",
          status: "generating",
          totalSections: 3,
          completedSections: 1,
          failedSections: 0,
          currentSectionId: "sec-2",
          progressPercent: 33,
        },
      },
      activeJobs: ["ed-logic-1"],
    });

    render(<AudiobooksTab />);

    await waitFor(() => {
      expect(screen.getByTestId("edition-card-ed-logic-1")).toBeInTheDocument();
    });

    // Check section counter and progress
    expect(screen.getByText("Section 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("33%")).toBeInTheDocument();

    // Check pause button and click it
    const pauseBtn = screen.getByRole("button", { name: "Pause generation" });
    expect(pauseBtn).toBeInTheDocument();

    fireEvent.click(pauseBtn);
    expect(pauseJobSpy).toHaveBeenCalledWith("ed-logic-1");
  });

  it("renders resume button when job is paused and allows resuming", async () => {
    const resumeJobSpy = vi.spyOn(useAudioEditionGenerationStore.getState(), "resumeJob")
      .mockImplementation(async () => {});

    useAudioEditionGenerationStore.setState({
      jobs: {
        "ed-logic-1": {
          editionId: "ed-logic-1",
          documentId: "doc-text-1",
          status: "paused",
          totalSections: 3,
          completedSections: 1,
          failedSections: 0,
          currentSectionId: "sec-2",
          progressPercent: 33,
        },
      },
      activeJobs: [],
    });

    render(<AudiobooksTab />);

    await waitFor(() => {
      expect(screen.getByTestId("edition-card-ed-logic-1")).toBeInTheDocument();
    });

    const badge = screen.getByTestId("edition-status-badge-ed-logic-1");
    expect(badge.textContent).toBe("Paused (33%)");

    const resumeBtn = screen.getByRole("button", { name: "Resume generation" });
    expect(resumeBtn).toBeInTheDocument();

    fireEvent.click(resumeBtn);
    expect(resumeJobSpy).toHaveBeenCalledWith("ed-logic-1");
  });

  it("renders retry button when job has failed and allows retrying failed sections", async () => {
    const retrySpy = vi.spyOn(useAudioEditionGenerationStore.getState(), "retryFailedSections")
      .mockImplementation(async () => {});

    useAudioEditionGenerationStore.setState({
      jobs: {
        "ed-logic-1": {
          editionId: "ed-logic-1",
          documentId: "doc-text-1",
          status: "error",
          totalSections: 3,
          completedSections: 1,
          failedSections: 2,
          currentSectionId: null,
          progressPercent: 33,
        },
      },
      activeJobs: [],
    });

    render(<AudiobooksTab />);

    await waitFor(() => {
      expect(screen.getByTestId("edition-card-ed-logic-1")).toBeInTheDocument();
    });

    const badge = screen.getByTestId("edition-status-badge-ed-logic-1");
    expect(badge.textContent).toBe("Failed");

    const retryBtn = screen.getByRole("button", { name: "Retry failed sections" });
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);
    expect(retrySpy).toHaveBeenCalledWith("ed-logic-1");
  });

  it("reactively reloads editions when generation store updates", async () => {
    render(<AudiobooksTab />);

    await waitFor(() => {
      expect(mockListAudioEditions).toHaveBeenCalledTimes(1);
    });

    // Simulate new job started in store
    act(() => {
      useAudioEditionGenerationStore.setState({
        jobs: {
          "ed-logic-1": {
            editionId: "ed-logic-1",
            documentId: "doc-text-1",
            status: "generating",
            totalSections: 3,
            completedSections: 0,
            failedSections: 0,
            currentSectionId: "sec-1",
            progressPercent: 0,
          },
        },
        activeJobs: ["ed-logic-1"],
      });
    });

    await waitFor(() => {
      expect(mockListAudioEditions).toHaveBeenCalledTimes(2);
    });
  });
});
