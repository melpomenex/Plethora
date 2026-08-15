import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateExtractDialog } from "../CreateExtractDialog";

const mocks = vi.hoisted(() => ({
  createExtract: vi.fn(),
  ingestRemoteImage: vi.fn(),
  captureAppWindowRegion: vi.fn(),
  saveScreenshotToRegistry: vi.fn(),
  documents: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../../api/extracts", () => ({
  createExtract: mocks.createExtract,
}));
vi.mock("../../../api/learning-items", () => ({
  generateLearningItemsFromExtract: vi.fn(),
}));
vi.mock("../../../api/image-registry", () => ({
  ingestRemoteImage: mocks.ingestRemoteImage,
}));
vi.mock("../../../utils/screenshotCapture", () => ({
  captureAppWindowRegion: mocks.captureAppWindowRegion,
  saveScreenshotToRegistry: mocks.saveScreenshotToRegistry,
}));
vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  // Desktop-style environment so the rendered-pixel capture path is planned.
  isNativeMobile: () => false,
}));
vi.mock("../../../stores/documentStore", () => ({
  useDocumentStore: () => ({ documents: mocks.documents }),
}));
vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../common/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock("../ClozeCreatorPopup", () => ({
  ClozeCreatorPopup: () => null,
}));
vi.mock("../QACreatorPopup", () => ({
  QACreatorPopup: () => null,
}));
vi.mock("../../image-registry/ImageRegistryLibrary", () => ({
  ImageRegistryLibrary: ({
    onAssetsChange,
    onSelectedIdsChange,
  }: {
    onAssetsChange?: (assets: unknown[]) => void;
    onSelectedIdsChange?: (ids: string[]) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        onAssetsChange?.([{
          id: "registry-1",
          file_name: "diagram.png",
          data_url: "data:image/png;base64,UkVHSVNUUlk=",
        }]);
        onSelectedIdsChange?.(["registry-1"]);
      }}
    >
      Pick registry image
    </button>
  ),
}));

const createdExtract = {
  id: "extract-1",
  document_id: "document-1",
  content: "Selected passage",
  progressive_disclosure_level: 0,
  max_disclosure_level: 3,
  date_created: "2026-07-30T00:00:00Z",
  date_modified: "2026-07-30T00:00:00Z",
  tags: [],
  review_count: 0,
  reps: 0,
};

describe("CreateExtractDialog image attachments", () => {
  beforeEach(() => {
    mocks.createExtract.mockReset();
    mocks.createExtract.mockResolvedValue(createdExtract);
    mocks.ingestRemoteImage.mockReset();
    mocks.captureAppWindowRegion.mockReset();
    mocks.saveScreenshotToRegistry.mockReset();
    mocks.documents.length = 0;
  });

  it("embeds an arbitrary Image Registry asset in a normal extract", async () => {
    render(
      <CreateExtractDialog
        documentId="document-1"
        selectedText="Selected passage"
        isOpen
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Attach from Image Registry"));
    fireEvent.click(screen.getByText("Pick registry image"));
    fireEvent.click(screen.getByText("extracts.createExtract"));

    await waitFor(() => {
      expect(mocks.createExtract).toHaveBeenCalledWith(expect.objectContaining({
        document_id: "document-1",
        html_content: expect.stringContaining(
          "data:image/png;base64,UkVHSVNUUlk=",
        ),
      }));
    });
  });

  it("captures rendered article pixels when the image host rejects downloading", async () => {
    mocks.documents.push({
      id: "document-1",
      metadata: {
        originalUrl: "https://example.com/article",
        extractedImages: [{
          src: "https://images.example.com/protected.webp",
          alt: "A useful diagram",
        }],
      },
    });
    mocks.captureAppWindowRegion.mockResolvedValue("Q0FQVFVSRQ==");
    mocks.ingestRemoteImage.mockRejectedValue(new Error("HTTP 403 Forbidden"));
    mocks.saveScreenshotToRegistry.mockResolvedValue({
      id: "captured-1",
      file_name: "article-image.png",
      data_url: "data:image/png;base64,Q0FQVFVSRQ==",
    });

    render(
      <CreateExtractDialog
        documentId="document-1"
        selectedText="Selected passage"
        isOpen
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTitle("A useful diagram"));

    await waitFor(() => {
      expect(mocks.saveScreenshotToRegistry).toHaveBeenCalledWith(
        "Q0FQVFVSRQ==",
        expect.stringMatching(/^article-image-\d+\.png$/),
      );
    });

    fireEvent.click(screen.getByText("extracts.createExtract"));

    await waitFor(() => {
      expect(mocks.createExtract).toHaveBeenCalledWith(expect.objectContaining({
        html_content: expect.stringContaining(
          "data:image/png;base64,Q0FQVFVSRQ==",
        ),
      }));
    });
  });
});
