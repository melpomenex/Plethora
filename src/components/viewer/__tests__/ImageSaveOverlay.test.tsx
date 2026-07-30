import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageSaveOverlay } from "../ImageSaveOverlay";

const mockApi = vi.hoisted(() => ({
  ingestImageBlob: vi.fn(),
  ingestRemoteImage: vi.fn(),
}));
const isTauriMock = vi.hoisted(() => vi.fn(() => false));
const captureAppWindowRegionMock = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../../api/image-registry", () => mockApi);
vi.mock("../../common/Toast", () => ({
  useToast: () => mockToast,
}));
vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../lib/tauri", () => ({
  isTauri: isTauriMock,
}));
vi.mock("../../../utils/screenshotCapture", () => ({
  captureAppWindowRegion: captureAppWindowRegionMock,
  base64ToBlob: vi.fn(() => new Blob(["captured"], { type: "image/png" })),
}));

function hoverImage(src = "data:image/png;base64,AA==") {
  act(() => {
    window.dispatchEvent(new CustomEvent("image-hover", {
      detail: {
        src,
        documentId: "document-1",
        referrerUrl: "https://www.kew.org/read-and-watch/honey-fungus",
        rect: { left: 100, top: 80, width: 320, height: 180 },
      },
    }));
  });
}

describe("ImageSaveOverlay", () => {
  beforeEach(() => {
    mockApi.ingestImageBlob.mockReset();
    mockApi.ingestRemoteImage.mockReset();
    isTauriMock.mockReturnValue(false);
    captureAppWindowRegionMock.mockReset();
    mockToast.success.mockReset();
    mockToast.error.mockReset();
  });

  it("uses native ingestion for remote images so article CORS cannot block occlusion", async () => {
    isTauriMock.mockReturnValue(true);
    mockApi.ingestRemoteImage.mockResolvedValue({ id: "asset-remote" });
    const handleCreateOcclusion = vi.fn();
    window.addEventListener(
      "incrementum:create-image-occlusion",
      handleCreateOcclusion as EventListener,
      { once: true },
    );
    render(<ImageSaveOverlay />);
    hoverImage(
      "https://www.kew.org/sites/default/files/Armillaria%20ostoya.jpg.webp?itok=test",
    );

    fireEvent.click(screen.getByTitle("Create image occlusion card"));

    await waitFor(() => {
      expect(mockApi.ingestRemoteImage).toHaveBeenCalledWith(
        "https://www.kew.org/sites/default/files/Armillaria%20ostoya.jpg.webp?itok=test",
        "Armillaria ostoya.jpg.webp",
        "https://www.kew.org/read-and-watch/honey-fungus",
      );
      expect(mockApi.ingestImageBlob).not.toHaveBeenCalled();
      expect(handleCreateOcclusion).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: {
            assetId: "asset-remote",
            documentId: "document-1",
          },
        }),
      );
    });
  });

  it("captures already-rendered pixels when the image host challenges native downloads", async () => {
    isTauriMock.mockReturnValue(true);
    mockApi.ingestRemoteImage.mockRejectedValue(
      new Error("Remote image returned HTTP 403 Forbidden"),
    );
    captureAppWindowRegionMock.mockResolvedValue("AA==");
    mockApi.ingestImageBlob.mockResolvedValue({ id: "asset-captured" });
    const handleCreateOcclusion = vi.fn();
    window.addEventListener(
      "incrementum:create-image-occlusion",
      handleCreateOcclusion as EventListener,
      { once: true },
    );
    render(<ImageSaveOverlay />);
    hoverImage("https://www.kew.org/sites/default/files/protected-image.webp");

    fireEvent.click(screen.getByTitle("Create image occlusion card"));

    await waitFor(() => {
      expect(captureAppWindowRegionMock).toHaveBeenCalledWith({
        left: 100,
        top: 80,
        width: 320,
        height: 180,
      });
      expect(mockApi.ingestImageBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.stringMatching(/^captured-image-\d+\.png$/),
      );
      expect(handleCreateOcclusion).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: {
            assetId: "asset-captured",
            documentId: "document-1",
          },
        }),
      );
    });
  });

  it("shows registry and image-occlusion actions for a hovered image", () => {
    render(<ImageSaveOverlay />);

    hoverImage();

    expect(screen.getByTitle("Save to Image Registry")).toBeInTheDocument();
    expect(screen.getByTitle("Create image occlusion card")).toBeInTheDocument();
  });

  it("saves the image and launches the occlusion editor with its registry asset", async () => {
    mockApi.ingestImageBlob.mockResolvedValue({ id: "asset-1" });
    const handleCreateOcclusion = vi.fn();
    window.addEventListener(
      "incrementum:create-image-occlusion",
      handleCreateOcclusion as EventListener,
      { once: true },
    );
    render(<ImageSaveOverlay />);
    hoverImage();

    fireEvent.click(screen.getByTitle("Create image occlusion card"));

    await waitFor(() => {
      expect(mockApi.ingestImageBlob).toHaveBeenCalledTimes(1);
      expect(handleCreateOcclusion).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: {
            assetId: "asset-1",
            documentId: "document-1",
          },
        }),
      );
    });
  });
});
