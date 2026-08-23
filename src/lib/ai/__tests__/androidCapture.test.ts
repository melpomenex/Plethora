import { describe, expect, it, vi } from "vitest";
import { importScanToLibrary } from "../android/scanImport";
import { persistLectureRecording, saveLectureDocument } from "../android/lectureCapture";
import { FakeSpeechProvider } from "../__fixtures__/FakePlatformProviders";

vi.mock("../../../api/documents", () => ({
  createDocument: vi.fn(async (title: string) => ({ id: "doc-1", title })),
  updateDocumentContent: vi.fn(async (id: string) => ({ id })),
}));

vi.mock("../../../api/image-registry", () => ({
  ingestImageBlob: vi.fn(async () => ({ id: "asset-1" })),
}));

vi.mock("../onDeviceAI", () => ({
  getOnDeviceOcrLabels: vi.fn(async () => ({ labels: [], sourceWidth: 0, sourceHeight: 0 })),
}));

describe("importScanToLibrary", () => {
  it("ingests JPEG pages and creates a markdown document", async () => {
    const result = await importScanToLibrary({
      pages: [{ mimeType: "image/jpeg", data: "AAAA", width: 10, height: 10 }],
    });
    expect(result.documentId).toBe("doc-1");
    expect(result.assetIds).toEqual(["asset-1"]);
  });

  it("reuses an existing imageAssetId without a camera", async () => {
    const result = await importScanToLibrary({
      pages: [{ imageAssetId: "existing", width: 1, height: 1, ocrText: "hello" }],
    });
    expect(result.assetIds).toEqual(["existing"]);
    expect(result.ocrChars).toBeGreaterThan(0);
  });
});

describe("lecture capture", () => {
  it("persists audio before transcription", async () => {
    const uri = await persistLectureRecording(new Blob(["abc"], { type: "audio/webm" }));
    expect(uri.startsWith("plethora-lecture:")).toBe(true);
    const result = await saveLectureDocument({
      audioUri: uri,
      speech: new FakeSpeechProvider({
        segments: [{ id: "s1", text: "hello class" }],
      }),
    });
    expect(result.documentId).toBe("doc-1");
    expect(result.incomplete).toBe(false);
  });
});
