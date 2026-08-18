import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  createExtract: vi.fn(),
  updateExtract: vi.fn(),
  generateLearningItemsFromExtract: vi.fn(),
  ingestImageFile: vi.fn(),
  getImageAssetById: vi.fn(),
  ingestRemoteImage: vi.fn(),
}));

vi.mock("../../../api/extracts", () => ({
  createExtract: mocks.createExtract,
  updateExtract: mocks.updateExtract,
}));
vi.mock("../../../api/learning-items", () => ({
  generateLearningItemsFromExtract: mocks.generateLearningItemsFromExtract,
}));
vi.mock("../../../api/image-registry", () => ({
  ingestImageFile: mocks.ingestImageFile,
  getImageAssetById: mocks.getImageAssetById,
  ingestRemoteImage: mocks.ingestRemoteImage,
}));
vi.mock("../../../utils/screenshotCapture", () => ({
  captureAppWindowRegion: vi.fn(),
  saveScreenshotToRegistry: vi.fn(),
}));
vi.mock("../../../lib/tauri", () => ({
  isTauri: () => false,
  isNativeMobile: () => false,
}));
vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
vi.mock("../../common/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));
// Test-driveable registry stub: its "select" button pushes an id through the
// same callbacks the real library uses.
vi.mock("../../image-registry/ImageRegistryLibrary", () => ({
  ImageRegistryLibrary: ({
    onSelectedIdsChange,
    onAssetsChange,
  }: {
    onSelectedIdsChange?: (ids: string[]) => void;
    onAssetsChange?: (assets: unknown[]) => void;
  }) => (
    <div data-testid="registry-stub">
      <button
        data-testid="registry-select-full"
        onClick={() => {
          onAssetsChange?.([
            {
              id: "asset-1",
              file_name: "thumb.png",
              data_url: "data:image/png;base64,THUMB256",
              created_at: "2026-08-18T00:00:00Z",
            },
          ]);
          onSelectedIdsChange?.(["asset-1"]);
        }}
      >
        select
      </button>
    </div>
  ),
}));
vi.mock("../ClozeCreatorPopup", () => ({ ClozeCreatorPopup: () => <div /> }));
vi.mock("../QACreatorPopup", () => ({ QACreatorPopup: () => <div /> }));

import { CreateExtractDialog } from "../CreateExtractDialog";
import { EditExtractDialog } from "../EditExtractDialog";
import type { Extract } from "../../../api/extracts";

const THUMB_ASSET = {
  id: "asset-1",
  file_name: "thumb.png",
  data_url: "data:image/png;base64,THUMB256",
  created_at: "2026-08-18T00:00:00Z",
};

const FULL_ASSET = {
  id: "asset-1",
  file_name: "full.png",
  data_url: "data:image/png;base64,FULLRES",
  created_at: "2026-08-18T00:00:00Z",
};

const sampleExtract = {
  id: "extract-1",
  document_id: "doc-1",
  content: "plain quick-path extract",
  notes: "",
  tags: [],
  date_created: "2026-08-17T00:00:00Z",
  date_modified: "2026-08-17T00:00:00Z",
  max_disclosure_level: 0,
  review_count: 0,
} as unknown as Extract;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createExtract.mockImplementation(async (input: { content: string }) => ({
    ...sampleExtract,
    id: "created-extract",
    content: input.content,
  }));
  mocks.updateExtract.mockImplementation(async (input: { html_content?: string }) => ({
    ...sampleExtract,
    html_content: input.html_content,
  }));
  mocks.generateLearningItemsFromExtract.mockResolvedValue([]);
  mocks.getImageAssetById.mockResolvedValue(FULL_ASSET);
  mocks.ingestImageFile.mockImplementation(async (file: File) => ({
    ...THUMB_ASSET,
    file_name: file.name,
  }));
});

afterEach(() => {
  localStorage.clear();
});

describe("shared extract editor parity (bugs 08 + 12)", () => {
  it("offers the Image Registry in BOTH the create and edit funnels", () => {
    const { unmount } = render(
      <CreateExtractDialog documentId="doc-1" isOpen onClose={() => {}} />
    );
    expect(screen.getByText("Attach from Image Registry")).toBeInTheDocument();
    unmount();

    render(
      <EditExtractDialog extract={sampleExtract} isOpen onClose={() => {}} />
    );
    // The edit funnel previously had no registry at all — the reported
    // capability divergence.
    expect(screen.getByText("Attach from Image Registry")).toBeInTheDocument();
  });

  it("applies bold to the live textarea selection via mousedown-safe toolbar", () => {
    render(
      <CreateExtractDialog
        documentId="doc-1"
        selectedText="quick brown fox"
        isOpen
        onClose={() => {}}
      />
    );
    const textarea = screen.getByPlaceholderText(
      /Enter the extract content/
    ) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(6, 11); // "brown"
    // mousedown must not block the click from operating on the selection.
    fireEvent.mouseDown(screen.getByTitle(/Bold/));
    fireEvent.click(screen.getByTitle(/Bold/));
    expect(textarea.value).toBe("quick **brown** fox");
  });

  it("Cmd+B bound in the textarea applies bold", () => {
    render(
      <CreateExtractDialog
        documentId="doc-1"
        selectedText="hello world"
        isOpen
        onClose={() => {}}
      />
    );
    const textarea = screen.getByPlaceholderText(/Enter the extract content/) as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 5); // "hello"
    fireEvent.keyDown(textarea, { key: "b", metaKey: true });
    expect(textarea.value).toBe("**hello** world");
  });

  it("update writes html_content with the full-resolution asset (not the thumbnail)", async () => {
    render(
      <EditExtractDialog extract={sampleExtract} isOpen onClose={() => {}} />
    );

    // Open the registry and select an asset.
    fireEvent.click(screen.getByText("Attach from Image Registry"));
    fireEvent.click(await screen.findByTestId("registry-select-full"));

    fireEvent.click(screen.getByText("extracts.updateExtract"));

    await waitFor(() => expect(mocks.updateExtract).toHaveBeenCalledTimes(1));
    const input = mocks.updateExtract.mock.calls[0][0];
    expect(input.html_content).toContain("data:image/png;base64,FULLRES");
    expect(input.html_content).not.toContain("THUMB256");
    // The full-res rendition was fetched by id.
    expect(mocks.getImageAssetById).toHaveBeenCalledWith("asset-1");
  });

  it("text-only updates still persist rendered markdown as html_content", async () => {
    render(
      <EditExtractDialog extract={sampleExtract} isOpen onClose={() => {}} />
    );
    const textarea = screen.getByPlaceholderText(/Enter the extract content/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "plain text only" } });
    fireEvent.click(screen.getByText("extracts.updateExtract"));

    await waitFor(() => expect(mocks.updateExtract).toHaveBeenCalledTimes(1));
    const input = mocks.updateExtract.mock.calls[0][0];
    expect(input.html_content).toBeTruthy();
    expect(input.content).toBe("plain text only");
  });

  it("Update & Regenerate Cards still runs after the merge", async () => {
    render(
      <EditExtractDialog extract={sampleExtract} isOpen onClose={() => {}} />
    );
    fireEvent.click(screen.getByText("extracts.updateAndRegenerate"));
    await waitFor(() =>
      expect(mocks.generateLearningItemsFromExtract).toHaveBeenCalledWith("extract-1")
    );
    expect(mocks.updateExtract).toHaveBeenCalledTimes(1);
  });
});

describe("extract image ingest (bug 09)", () => {
  function imageFile(name = "pasted.png") {
    return new File(["binary-image-bytes"], name, { type: "image/png" });
  }

  it("a paste while the textarea is focused ingests the image, not nothing", () => {
    render(
      <CreateExtractDialog documentId="doc-1" isOpen onClose={() => {}} />
    );
    const textarea = screen.getByPlaceholderText(/Enter the extract content/);
    textarea.focus();

    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        files: [imageFile()],
        types: ["Files"],
        getData: () => "",
      },
    });
    fireEvent(textarea, pasteEvent);

    expect(mocks.ingestImageFile).toHaveBeenCalledTimes(1);
    // The registry section opens so the user sees the ingested image.
    expect(screen.getByText("Hide")).toBeInTheDocument();
  });

  it("a text paste still reaches the textarea", () => {
    render(
      <CreateExtractDialog documentId="doc-1" isOpen onClose={() => {}} />
    );
    const textarea = screen.getByPlaceholderText(/Enter the extract content/);
    textarea.focus();

    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: { files: [], types: ["text/plain"], getData: () => "typed text" },
    });
    fireEvent(textarea, pasteEvent);

    expect(mocks.ingestImageFile).not.toHaveBeenCalled();
  });

  it("dropping an image file ingests it; a non-image drop is ignored quietly", async () => {
    const { container } = render(
      <CreateExtractDialog documentId="doc-1" isOpen onClose={() => {}} />
    );
    const overlay = container.firstElementChild as HTMLElement;

    const dropImage = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropImage, "dataTransfer", {
      value: { files: [imageFile("dropped.jpg")], types: ["Files"] },
    });
    fireEvent(overlay, dropImage);
    await waitFor(() => expect(mocks.ingestImageFile).toHaveBeenCalledTimes(1));

    mocks.ingestImageFile.mockClear();
    const dropText = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dropText, "dataTransfer", {
      value: {
        files: [new File(["notes"], "notes.txt", { type: "text/plain" })],
        types: ["Files"],
      },
    });
    fireEvent(overlay, dropText);
    expect(mocks.ingestImageFile).not.toHaveBeenCalled();
    // The dialog is still open and intact — no error surface.
    expect(screen.getByText("extracts.createExtract")).toBeInTheDocument();
  });
});
