import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCatalogCache, getCatalog, refreshCatalog } from "../catalog";

const payload = {
  data: [{
    id: "vendor/test-tts",
    name: "Test TTS",
    description: "Recorded fixture",
    supported_voices: ["voice-a"],
    supported_parameters: ["speed"],
    context_length: 1024,
    pricing: { prompt: "0.000002" },
  }],
};

describe("OpenRouter TTS catalog", () => {
  beforeEach(() => {
    clearCatalogCache();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("reuses a cached read without requesting again", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => payload } as Response);
    await getCatalog();
    await getCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes regardless of the TTL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => payload } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ ...payload.data[0], id: "vendor/new" }] }) } as Response);
    await getCatalog();
    const refreshed = await refreshCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshed.models[0].id).toBe("vendor/new");
  });

  it("keeps the previous catalog when refresh fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => payload } as Response)
      .mockRejectedValueOnce(new Error("offline"));
    await getCatalog();
    const result = await refreshCatalog();
    expect(result.models[0].id).toBe("vendor/test-tts");
    expect(result.offline).toBe(true);
  });

  it("falls back to the bundled snapshot without network", async () => {
    const result = await getCatalog({ allowNetwork: false });
    expect(result.source).toBe("snapshot");
    expect(result.models.length).toBeGreaterThan(0);
  });
});
