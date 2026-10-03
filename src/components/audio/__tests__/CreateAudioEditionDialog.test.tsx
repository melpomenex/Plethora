import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { CreateAudioEditionDialog } from "../CreateAudioEditionDialog";
import * as documentsApi from "../../../api/documents";
import * as audioEditionsApi from "../../../api/audioEditions";
import { useAudioEditionGenerationStore } from "../../../stores/audioEditionGenerationStore";
import { useToastStore } from "../../common/Toast";
import * as pdfExtractor from "../../../utils/pdfTextExtractor";
import { useSettingsStore } from "../../../stores/settingsStore";
import type { Document } from "../../../types/document";

vi.mock("../../../api/documents", () => ({
  getDocument: vi.fn(),
  updateDocument: vi.fn().mockResolvedValue({}),
  updateDocumentContent: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../api/queue", () => ({
  bulkUnsuspendItems: vi.fn().mockResolvedValue({ succeeded: ["doc-1"], failed: [], errors: [] }),
}));

vi.mock("../../../utils/pdfTextExtractor", () => ({
  extractPdfData: vi.fn(),
}));

vi.mock("../../../api/audioEditions", () => ({
  createAudioEdition: vi.fn().mockResolvedValue({ id: "test-edition" }),
  auditionVoicePreview: vi.fn().mockResolvedValue(new Blob(["audio"], { type: "audio/wav" })),
}));

describe("CreateAudioEditionDialog", () => {
  const dummyDocSummary: Document = {
    id: "doc-1",
    title: "Philosophy of Science",
    filePath: "/docs/philosophy.txt",
    fileType: "other",
    content: null as any,
    dateAdded: new Date().toISOString(),
    dateModified: new Date().toISOString(),
    tags: [],
    extractCount: 0,
    learningItemCount: 0,
    priorityRating: 0,
    prioritySlider: 0,
    priorityScore: 0,
    isArchived: false,
    isFavorite: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        tts: {
          ...state.settings.tts,
          paidTtsEnabled: true,
        } as any,
      },
    }));
  });

  it("hydrates document content when summary has empty content and renders loading state", async () => {
    let resolveGetDoc: (doc: any) => void;
    const getDocPromise = new Promise((resolve) => {
      resolveGetDoc = resolve;
    });
    vi.mocked(documentsApi.getDocument).mockReturnValue(getDocPromise as any);

    render(
      <CreateAudioEditionDialog
        isOpen={true}
        onClose={vi.fn()}
        document={dummyDocSummary}
      />
    );

    // Should indicate loading document content
    expect(screen.getByText(/Reading document content/i)).toBeInTheDocument();
    // Submit button should be disabled during load
    const createButton = screen.getByRole("button", { name: /Create Audio Edition/i });
    expect(createButton).toBeDisabled();

    // Resolve with actual content
    resolveGetDoc!({
      ...dummyDocSummary,
      content: "This is the full philosophy text spanning several meaningful sentences.",
    });

    await waitFor(() => {
      expect(screen.queryByText(/Reading document content/i)).not.toBeInTheDocument();
    });

    // Button should now be enabled
    expect(createButton).not.toBeDisabled();
    expect(screen.getByText(/1 Chapters/i)).toBeInTheDocument();
  });

  it("displays alert banner and disables create button when document has 0 readable characters", async () => {
    vi.mocked(documentsApi.getDocument).mockResolvedValue({
      ...dummyDocSummary,
      content: "   ",
    });

    render(
      <CreateAudioEditionDialog
        isOpen={true}
        onClose={vi.fn()}
        document={dummyDocSummary}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText(/Reading document content/i)).not.toBeInTheDocument();
    });

    expect(
      screen.getByText(/This document has no readable text content to generate an audio edition/i)
    ).toBeInTheDocument();

    const createButton = screen.getByRole("button", { name: /Create Audio Edition/i });
    expect(createButton).toBeDisabled();
  });

  it("starts generation job and dispatches toast when submitted with valid content", async () => {
    vi.mocked(documentsApi.getDocument).mockResolvedValue({
      ...dummyDocSummary,
      content: "Chapter 1\nHere is a complete chapter for synthesis.",
    });

    const startJobSpy = vi.spyOn(useAudioEditionGenerationStore.getState(), "startJob").mockImplementation(async () => {});

    render(
      <CreateAudioEditionDialog
        isOpen={true}
        onClose={vi.fn()}
        document={dummyDocSummary}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText(/Reading document content/i)).not.toBeInTheDocument();
    });

    // Select Fast (Pocket / Local)
    const fastButton = screen.getByRole("button", { name: /Fast/i });
    fireEvent.click(fastButton);

    const createButton = screen.getByRole("button", { name: /Create Audio Edition/i });
    expect(createButton).not.toBeDisabled();

    fireEvent.click(createButton);

    await waitFor(() => {
      expect(audioEditionsApi.createAudioEdition).toHaveBeenCalled();
      expect(startJobSpy).toHaveBeenCalled();
    });

    // Check toast was added
    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].title).toBe("Generating Audio Edition");
    expect(toasts[0].message).toContain("Philosophy of Science");
  });

  it("hydrates PDF document with empty content using extractPdfData and updates SQLite", async () => {
    const dummyPdfSummary: Document = {
      id: "doc-pdf-1",
      title: "Machine Learning Textbook",
      filePath: "/books/ml.pdf",
      fileType: "pdf",
      content: null as any,
      dateAdded: new Date().toISOString(),
      dateModified: new Date().toISOString(),
      tags: [],
      extractCount: 0,
      learningItemCount: 0,
      priorityRating: 0,
      prioritySlider: 0,
      priorityScore: 0,
      isArchived: false,
      isFavorite: false,
    };

    // Database returns document with empty content
    vi.mocked(documentsApi.getDocument).mockResolvedValue({
      ...dummyPdfSummary,
      content: "",
    });

    vi.mocked(pdfExtractor.extractPdfData).mockResolvedValue({
      totalPages: 10,
      totalChars: 1200,
      fullText: "Chapter 1: Intro\nThis is machine learning.\n\nChapter 2: Neural Nets\nThis is deep learning.",
      outline: [
        { title: "Chapter 1: Intro", pageNumber: 1, level: 1 },
        { title: "Chapter 2: Neural Nets", pageNumber: 5, level: 1 },
      ],
      pageContents: [
        { pageNumber: 1, text: "Chapter 1: Intro\nThis is machine learning." },
        { pageNumber: 5, text: "Chapter 2: Neural Nets\nThis is deep learning." },
      ],
    });

    render(
      <CreateAudioEditionDialog
        isOpen={true}
        onClose={vi.fn()}
        document={dummyPdfSummary}
      />
    );

    // Verify extractPdfData was called
    await waitFor(() => {
      expect(pdfExtractor.extractPdfData).toHaveBeenCalledWith("/books/ml.pdf", expect.any(Object));
    });

    // Verify updateDocumentContent was called to persist extracted text to SQLite
    await waitFor(() => {
      expect(documentsApi.updateDocumentContent).toHaveBeenCalledWith(
        "doc-pdf-1",
        "Chapter 1: Intro\nThis is machine learning.\n\nChapter 2: Neural Nets\nThis is deep learning."
      );
    });

    // Button should be enabled and chapters rendered
    await waitFor(() => {
      const createButton = screen.getByRole("button", { name: /Create Audio Edition/i });
      expect(createButton).not.toBeDisabled();
      expect(screen.getByText(/2 Chapters/i)).toBeInTheDocument();
    });
  });

  it("renders progress indicator during PDF extraction", async () => {
    const dummyPdfSummary: Document = {
      id: "doc-pdf-2",
      title: "Large Textbook",
      filePath: "/books/large.pdf",
      fileType: "pdf",
      content: "",
      dateAdded: new Date().toISOString(),
      dateModified: new Date().toISOString(),
      tags: [],
      extractCount: 0,
      learningItemCount: 0,
      priorityRating: 0,
      prioritySlider: 0,
      priorityScore: 0,
      isArchived: false,
      isFavorite: false,
    };

    vi.mocked(documentsApi.getDocument).mockResolvedValue(dummyPdfSummary);

    let finishExtraction: ((val: any) => void) | undefined;
    vi.mocked(pdfExtractor.extractPdfData).mockImplementation((_path, options) => {
      options?.onProgress?.(5, 50);
      return new Promise((resolve) => {
        finishExtraction = resolve;
      });
    });

    render(
      <CreateAudioEditionDialog
        isOpen={true}
        onClose={vi.fn()}
        document={dummyPdfSummary}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Extracting PDF text and outline \(page 5 of 50\)/i)).toBeInTheDocument();
    });

    finishExtraction!({
      totalPages: 50,
      totalChars: 500,
      fullText: "Extracted text from page 5",
      outline: [],
      pageContents: [{ pageNumber: 5, text: "Extracted text from page 5" }],
    });

    await waitFor(() => {
      expect(screen.getByText(/1 Chapters/i)).toBeInTheDocument();
    });
  });

  it("enqueues document when Add to Queue toggle is enabled (default)", async () => {
    const queueApi = await import("../../../api/queue");
    vi.mocked(documentsApi.getDocument).mockResolvedValue({
      ...dummyDocSummary,
      content: "Chapter 1\nThis is a substantial text content that should generate an audio edition.",
    });
    vi.spyOn(useAudioEditionGenerationStore.getState(), "startJob").mockImplementation(async () => {});

    render(
      <CreateAudioEditionDialog
        isOpen={true}
        onClose={vi.fn()}
        document={dummyDocSummary}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText(/Reading document content/i)).not.toBeInTheDocument();
    });

    const fastButton = screen.getByRole("button", { name: /Fast/i });
    fireEvent.click(fastButton);

    const toggle = screen.getByTestId("add-to-queue-toggle") as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    const createButton = screen.getByRole("button", { name: /Create Audio Edition/i });
    expect(createButton).not.toBeDisabled();
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(queueApi.bulkUnsuspendItems).toHaveBeenCalledWith(["doc-1"]);
      expect(documentsApi.updateDocument).toHaveBeenCalledWith("doc-1", expect.objectContaining({
        isArchived: false,
        isDismissed: false,
      }));
    });
  });

  it("does not enqueue document when Add to Queue toggle is unchecked", async () => {
    const queueApi = await import("../../../api/queue");
    vi.mocked(documentsApi.getDocument).mockResolvedValue({
      ...dummyDocSummary,
      content: "Chapter 1\nThis is a substantial text content that should generate an audio edition.",
    });
    vi.spyOn(useAudioEditionGenerationStore.getState(), "startJob").mockImplementation(async () => {});

    render(
      <CreateAudioEditionDialog
        isOpen={true}
        onClose={vi.fn()}
        document={dummyDocSummary}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText(/Reading document content/i)).not.toBeInTheDocument();
    });

    const fastButton = screen.getByRole("button", { name: /Fast/i });
    fireEvent.click(fastButton);

    const toggle = screen.getByTestId("add-to-queue-toggle");
    fireEvent.click(toggle);

    const createButton = screen.getByRole("button", { name: /Create Audio Edition/i });
    expect(createButton).not.toBeDisabled();
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(audioEditionsApi.createAudioEdition).toHaveBeenCalled();
    });

    expect(queueApi.bulkUnsuspendItems).not.toHaveBeenCalled();
    expect(documentsApi.updateDocument).not.toHaveBeenCalled();
  });

  it("renders voice selector and allows selecting and auditioning different voices", async () => {
    vi.mocked(documentsApi.getDocument).mockResolvedValue({
      ...dummyDocSummary,
      content: "Paragraph 1: Testing audio voice selection and preview.",
    });

    render(
      <CreateAudioEditionDialog
        isOpen={true}
        onClose={vi.fn()}
        document={dummyDocSummary}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText(/Reading document content/i)).not.toBeInTheDocument();
    });

    // Select Fast (Pocket / Local)
    const fastButton = screen.getByRole("button", { name: /Fast/i });
    fireEvent.click(fastButton);

    const voiceSelect = screen.getByTestId("voice-select") as HTMLSelectElement;
    expect(voiceSelect).toBeInTheDocument();
    expect(voiceSelect.value).toBe("alba");

    // Check that Alba and Marius are available options
    expect(within(voiceSelect).getByRole("option", { name: /Alba/i })).toBeInTheDocument();
    expect(within(voiceSelect).getByRole("option", { name: /Marius/i })).toBeInTheDocument();

    // Select Marius
    fireEvent.change(voiceSelect, { target: { value: "marius" } });
    expect(voiceSelect.value).toBe("marius");

    // The audition section should display Marius
    expect(screen.getByText("(Marius)")).toBeInTheDocument();

    // Click Audition button
    const auditionButton = screen.getByTestId("audition-voice-button");
    fireEvent.click(auditionButton);

    await waitFor(() => {
      expect(audioEditionsApi.auditionVoicePreview).toHaveBeenCalledWith(
        expect.stringContaining("Paragraph 1"),
        "pocket",
        "default",
        "marius",
        expect.objectContaining({ speed: 1.0 })
      );
    });
  });

  it("updates voice options when switching quality presets and persists selected voice", async () => {
    vi.mocked(documentsApi.getDocument).mockResolvedValue({
      ...dummyDocSummary,
      content: "Chapter 1: The philosophy of audio editions and voice options.\nThis is a substantial text content that should generate an audio edition.",
    });
    vi.spyOn(useAudioEditionGenerationStore.getState(), "startJob").mockImplementation(async () => {});

    render(
      <CreateAudioEditionDialog
        isOpen={true}
        onClose={vi.fn()}
        document={dummyDocSummary}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText(/Reading document content/i)).not.toBeInTheDocument();
    });

    // 1. Best preset (ElevenLabs)
    const bestButton = screen.getByRole("button", { name: /Best/i });
    fireEvent.click(bestButton);

    const voiceSelect = screen.getByTestId("voice-select") as HTMLSelectElement;
    expect(voiceSelect.value).toBe("21m00Tcm4TlvDq8ikWAM"); // Rachel

    // Options should include Rachel and Adam
    expect(within(voiceSelect).getByRole("option", { name: /Rachel/i })).toBeInTheDocument();
    expect(within(voiceSelect).getByRole("option", { name: /Adam/i })).toBeInTheDocument();

    // Change to Adam
    fireEvent.change(voiceSelect, { target: { value: "pNInz6obpgDQGcFmaJgB" } });
    expect(voiceSelect.value).toBe("pNInz6obpgDQGcFmaJgB");

    // Create the edition
    const createButton = screen.getByRole("button", { name: /Create Audio Edition/i });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(audioEditionsApi.createAudioEdition).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "elevenlabs",
          model: "eleven_multilingual_v2",
          voice: "pNInz6obpgDQGcFmaJgB",
        }),
        expect.any(Array)
      );
    });
  });

  it("portals to document.body with z-[9999], overlay overflow, and min-h-0 scroll containment", () => {
    const { container } = render(
      <div data-testid="parent-container">
        <CreateAudioEditionDialog
          isOpen={true}
          onClose={vi.fn()}
          document={{ ...dummyDocSummary, content: "Some sample readable text" }}
        />
      </div>
    );

    // Dialog root should NOT be inside parent container because it's portaled
    const parentContainer = screen.getByTestId("parent-container");
    expect(parentContainer.querySelector("[role='dialog']")).toBeNull();

    // Dialog should be portaled directly under document.body
    const dialog = screen.getByRole("dialog", { name: /Create Audio Edition/i });
    expect(document.body.contains(dialog)).toBe(true);

    // Overlay should have elevated z-index and overflow-y-auto
    const overlay = dialog.parentElement as HTMLElement;
    expect(overlay.className).toContain("z-[9999]");
    expect(overlay.className).toContain("overflow-y-auto");

    // Content container should have min-h-0 and overflow-y-auto for flex scrolling
    const content = dialog.querySelector(".overflow-y-auto.min-h-0") as HTMLElement;
    expect(content).toBeInTheDocument();
    expect(content.className).toContain("flex-1");
  });
});

