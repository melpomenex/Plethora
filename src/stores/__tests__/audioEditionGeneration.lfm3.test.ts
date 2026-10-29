import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { useAudioEditionGenerationStore } from "../audioEditionGenerationStore";
import { generateLfm3Speech } from "../../api/lfm3Tts";
import { updateAudioEditionSectionStatus } from "../../api/audioEditions";
import { LFM3_MODEL_ID } from "../../utils/lfm3Tts";
const fixture = vi.hoisted(() => ({ status: "queued" }));

vi.mock("../../api/lfm3Tts", () => ({ generateLfm3Speech: vi.fn() }));
vi.mock("../../diagnostics/ownedObjectUrl", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../diagnostics/ownedObjectUrl")>(),
  createOwnedObjectUrl: vi.fn(() => "blob:lfm3-test"),
}));
vi.mock("../../api/audioEditions", () => ({
  getAudioEdition: vi.fn(async () => ({ id: "ed-lfm3", sourceDocumentId: "doc-lfm3", provider: "lfm3", model: LFM3_MODEL_ID, voice: "female", generationSettings: JSON.stringify({ language: "en-GB" }) })),
  getAudioEditionSections: vi.fn(async () => [{ id: "sec-lfm3", sectionIndex: 0, generationStatus: fixture.status, characterCount: 500 }]),
  updateAudioEditionSectionStatus: vi.fn(async (_id: string, status: string) => { fixture.status = status; }),
  updateAudioEditionStatus: vi.fn(async () => {}),
  saveAudioEditionAnchors: vi.fn(async () => {}),
}));
function wavDataUrl() {
  const bytes = new Uint8Array(48);
  const view = new DataView(bytes.buffer);
  for (const [offset, tag] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const)
    [...tag].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  view.setUint32(4, 40, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, 24000, true); view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, 4, true);
  return `data:audio/wav;base64,${Buffer.from(bytes).toString("base64")}`;
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.status = "queued";
  useAudioEditionGenerationStore.setState({ jobs: {}, activeJobs: [], isGlobalPaused: false });
});
describe("LFM3 Audio Edition dispatch", () => {
  it("splits text through the real provider and assembles WAV with locale and voice", async () => {
    vi.mocked(generateLfm3Speech).mockResolvedValue({ audioUrl: wavDataUrl(), durationSec: 1, backend: "CPU" });
    await useAudioEditionGenerationStore.getState().startJob("ed-lfm3", { "sec-lfm3": "A small sentence about the river. ".repeat(20) });
    await waitFor(() => expect(useAudioEditionGenerationStore.getState().jobs["ed-lfm3"].status, JSON.stringify(vi.mocked(updateAudioEditionSectionStatus).mock.calls)).toBe("completed"));
    expect(vi.mocked(generateLfm3Speech).mock.calls.length).toBeGreaterThan(1);
    for (const [request] of vi.mocked(generateLfm3Speech).mock.calls) {
      expect(request.text.length).toBeLessThanOrEqual(300);
      expect(request).toMatchObject({ modelId: LFM3_MODEL_ID, voice: "female", language: "en-gb" });
      expect(request.signal).toBeInstanceOf(AbortSignal);
    }
    expect(updateAudioEditionSectionStatus).toHaveBeenCalledWith("sec-lfm3", "ready", "blob:lfm3-test", expect.any(Number));
  });
  it("aborts pending local synthesis when paused and never marks partial output ready", async () => {
    vi.mocked(generateLfm3Speech).mockImplementation(({ signal }) => new Promise((_, reject) => {
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    await useAudioEditionGenerationStore.getState().startJob("ed-lfm3", { "sec-lfm3": "A short passage." });
    await waitFor(() => expect(generateLfm3Speech).toHaveBeenCalled());
    const signal = vi.mocked(generateLfm3Speech).mock.calls[0][0].signal!;
    useAudioEditionGenerationStore.getState().pauseJob("ed-lfm3");
    expect(signal.aborted).toBe(true);
    expect(useAudioEditionGenerationStore.getState().jobs["ed-lfm3"].status).toBe("paused");
    expect(vi.mocked(updateAudioEditionSectionStatus).mock.calls.some(([, status]) => status === "ready")).toBe(false);
  });
});
