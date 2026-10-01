import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { CreateAudioEditionDialog } from "../CreateAudioEditionDialog";
import * as documentsApi from "../../../api/documents";
import * as audioEditionsApi from "../../../api/audioEditions";
import { useAudioEditionGenerationStore } from "../../../stores/audioEditionGenerationStore";
import { useToastStore } from "../../common/Toast";
import type { Document } from "../../../types/document";

vi.mock("../../../api/documents", () => ({
  getDocument: vi.fn(),
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
    fileType: "txt",
    content: null as any,
    dateAdded: new Date().toISOString(),
    lastModified: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
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
});
