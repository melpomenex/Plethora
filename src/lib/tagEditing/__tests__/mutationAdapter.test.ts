import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  updateDocument: vi.fn(),
  updateExtract: vi.fn(),
  updateLearningItemTags: vi.fn(),
  invokeCommand: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock("../../../api/documents", () => ({
  getDocument: mocks.getDocument,
  updateDocument: mocks.updateDocument,
}));
vi.mock("../../../api/extracts", () => ({
  updateExtract: mocks.updateExtract,
}));
vi.mock("../../../api/learning-items", () => ({
  updateLearningItemTags: mocks.updateLearningItemTags,
}));
vi.mock("../../../lib/tauri", () => ({
  invokeCommand: mocks.invokeCommand,
  isTauri: mocks.isTauri,
}));

import { persistItemTags } from "../mutationAdapter";

describe("persistItemTags (type dispatch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists document tags as a complete full-document spread", async () => {
    mocks.getDocument.mockResolvedValue({ id: "doc-1", title: "Doc", tags: ["a"] });
    mocks.updateDocument.mockResolvedValue({});

    const result = await persistItemTags({ type: "document", id: "doc-1", tags: ["a"] }, ["a", "b"]);

    expect(mocks.getDocument).toHaveBeenCalledWith("doc-1");
    expect(mocks.updateDocument).toHaveBeenCalledWith("doc-1", {
      id: "doc-1",
      title: "Doc",
      tags: ["a", "b"],
    });
    expect(result).toEqual(["a", "b"]);
  });

  it("throws when the document no longer exists", async () => {
    mocks.getDocument.mockResolvedValue(null);
    await expect(
      persistItemTags({ type: "document", id: "missing", tags: [] }, ["a"])
    ).rejects.toThrow("Document not found");
    expect(mocks.updateDocument).not.toHaveBeenCalled();
  });

  it("persists extract tags via the minimal extract update API", async () => {
    mocks.updateExtract.mockResolvedValue({});
    await persistItemTags({ type: "extract", id: "ex-1", tags: ["x"] }, ["x", "y"]);
    expect(mocks.updateExtract).toHaveBeenCalledWith({ id: "ex-1", tags: ["x", "y"] });
  });

  it("persists learning-item tags via the dedicated Tauri command", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.updateLearningItemTags.mockResolvedValue({});
    await persistItemTags({ type: "learning-item", id: "li-1", tags: [] }, ["card"]);
    expect(mocks.updateLearningItemTags).toHaveBeenCalledWith("li-1", ["card"]);
    expect(mocks.invokeCommand).not.toHaveBeenCalled();
  });

  it("routes learning-item tag saves through the generic update in web mode", async () => {
    mocks.isTauri.mockReturnValue(false);
    mocks.invokeCommand.mockResolvedValue({});
    await persistItemTags({ type: "learning-item", id: "li-2", tags: [] }, ["web"]);
    expect(mocks.invokeCommand).toHaveBeenCalledWith("update_learning_item", {
      id: "li-2",
      tags: ["web"],
    });
    expect(mocks.updateLearningItemTags).not.toHaveBeenCalled();
  });
});
