import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "../../types/document";
import { getDocument, setDocumentPrivacy } from "../documents";

const mocks = vi.hoisted(() => ({ native: true, invoke: vi.fn(), browser: vi.fn() }));
vi.mock("../../lib/tauri", () => ({
  isTauri: () => mocks.native, invokeCommand: mocks.invoke,
  openFilePicker: vi.fn(), openFolderPicker: vi.fn(),
}));
vi.mock("../../lib/browser-backend", () => ({ browserInvoke: mocks.browser }));

describe("document privacy native bridge", () => {
  beforeEach(() => { mocks.native = true; vi.clearAllMocks(); });
  it("returns durable source policy on reload", async () => {
    mocks.invoke.mockResolvedValue({ id: "lecture", isLocalOnly: true, isAiExcluded: true, privacyVersion: 2 } as Document);
    expect(await getDocument("lecture")).toMatchObject({ isLocalOnly: true, isAiExcluded: true, privacyVersion: 2 });
  });
  it.each([true, false])("uses an explicit version-checked command in native=%s", async (native) => {
    mocks.native = native;
    const transport = native ? mocks.invoke : mocks.browser;
    transport.mockResolvedValue({ id: "lecture", isLocalOnly: false, isAiExcluded: false, privacyVersion: 3 });
    const policy = { isLocalOnly: false, isAiExcluded: false, expectedVersion: 2 };
    const result = await setDocumentPrivacy("lecture", policy);
    expect(transport).toHaveBeenCalledWith("set_document_privacy", { id: "lecture", ...policy });
    expect(result.privacyVersion).toBe(3);
  });
  it("surfaces a stale-policy rejection without retrying or weakening flags", async () => {
    mocks.invoke.mockRejectedValue(new Error("Document privacy changed"));
    await expect(setDocumentPrivacy("lecture", { isLocalOnly: false, isAiExcluded: false, expectedVersion: 1 })).rejects.toThrow("privacy changed");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
});
