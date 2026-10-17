/**
 * Progressive disclosure selection in the extract editor.
 *
 * Level 0 must reach the backend as an explicit `0`; sending `undefined` was
 * silently ignored by `update_extract`, so users could never turn disclosure
 * off again.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CreateExtractDialog } from "../CreateExtractDialog";
import type { Extract } from "../../../api/extracts";

const mocks = vi.hoisted(() => ({
  createExtract: vi.fn(),
  updateExtract: vi.fn(),
}));

vi.mock("../../../api/extracts", () => ({
  createExtract: mocks.createExtract,
  updateExtract: mocks.updateExtract,
}));
vi.mock("../../../api/learning-items", () => ({
  generateLearningItemsFromExtract: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../api/image-registry", () => ({
  ingestRemoteImage: vi.fn(),
  ingestImageFile: vi.fn(),
  getImageAssetById: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../../utils/screenshotCapture", () => ({
  captureAppWindowRegion: vi.fn(),
  saveScreenshotToRegistry: vi.fn(),
}));
vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  isNativeMobile: () => false,
}));
vi.mock("../../../stores/documentStore", () => ({
  useDocumentStore: () => ({ documents: [] }),
}));
vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("../ClozeCreatorPopup", () => ({ ClozeCreatorPopup: () => null }));
vi.mock("../QACreatorPopup", () => ({ QACreatorPopup: () => null }));
vi.mock("../../image-registry/ImageRegistryLibrary", () => ({
  ImageRegistryLibrary: () => null,
}));

const baseExtract = {
  id: "extract-1",
  document_id: "doc-1",
  content: "Selected passage",
  progressive_disclosure_level: 0,
  max_disclosure_level: 3,
  date_created: "2026-07-30T00:00:00Z",
  date_modified: "2026-07-30T00:00:00Z",
  tags: [],
  review_count: 0,
  reps: 0,
} as unknown as Extract;

function levelButton(level: number) {
  return screen.getByTitle(`extracts.level ${level}`);
}

describe("CreateExtractDialog progressive disclosure", () => {
  beforeEach(() => {
    mocks.createExtract.mockReset();
    mocks.updateExtract.mockReset();
    mocks.createExtract.mockResolvedValue(baseExtract);
    mocks.updateExtract.mockResolvedValue(baseExtract);
  });

  it("creates with an explicit zero when the selector is untouched", async () => {
    render(
      <CreateExtractDialog
        documentId="doc-1"
        selectedText="Selected passage"
        isOpen
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("extracts.createExtract"));

    await waitFor(() => {
      expect(mocks.createExtract).toHaveBeenCalledWith(
        expect.objectContaining({ max_disclosure_level: 0 })
      );
    });
  });

  it("sends the selected level on create", async () => {
    render(
      <CreateExtractDialog
        documentId="doc-1"
        selectedText="Selected passage"
        isOpen
        onClose={vi.fn()}
      />
    );

    fireEvent.click(levelButton(3));
    fireEvent.click(screen.getByText("extracts.createExtract"));

    await waitFor(() => {
      expect(mocks.createExtract).toHaveBeenCalledWith(
        expect.objectContaining({ max_disclosure_level: 3 })
      );
    });
  });

  it("persists zero when an existing extract's disclosure is turned off", async () => {
    render(
      <CreateExtractDialog
        documentId="doc-1"
        extract={baseExtract}
        isOpen
        onClose={vi.fn()}
      />
    );

    fireEvent.click(levelButton(0));
    fireEvent.click(screen.getByText("extracts.updateExtract"));

    await waitFor(() => {
      expect(mocks.updateExtract).toHaveBeenCalledWith(
        expect.objectContaining({ id: "extract-1", max_disclosure_level: 0 })
      );
    });
  });
});
