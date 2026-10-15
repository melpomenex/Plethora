import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  invoke: vi.fn(), patchCount: vi.fn(), removeQueue: vi.fn(),
  rows: [] as Array<{ id: string }>, revision: 0,
}));
vi.mock("../../lib/tauri", () => ({ invokeCommand: fixture.invoke }));
vi.mock("../../stores/documentStore", () => ({ useDocumentStore: { getState: () => ({ patchExtractCount: fixture.patchCount }) } }));
vi.mock("../../stores/extractStore", () => ({ useExtractStore: {
  setState: (update: (state: unknown) => { extracts: typeof fixture.rows; revision: number }) => {
    const next = update({ extracts: fixture.rows, revision: fixture.revision });
    fixture.rows = next.extracts; fixture.revision = next.revision;
  },
} }));
vi.mock("../../stores/queueStore", () => ({ useQueueStore: { getState: () => ({
  items: [{ id: "queue-a", extractId: "a", itemType: "extract" }, { id: "a", itemType: "document" }, { id: "b", itemType: "extract" }],
  removeItemsLocally: fixture.removeQueue,
}) } }));
import { deleteExtract, getExtract } from "../extracts";

let record: Record<string, unknown> | null;
beforeEach(() => {
  vi.clearAllMocks();
  fixture.rows = [{ id: "a" }, { id: "b" }]; fixture.revision = 0;
  record = { id: "a", document_id: "doc", content: "saved text", tags: [] };
  fixture.invoke.mockImplementation(async (command: string) => {
    if (command === "get_extract") return record;
    if (command === "delete_extract") record = null;
  });
});

describe("confirmed annotation removal", () => {
  it("persists once, updates marks/lists/queue/count, and remains absent on reopening", async () => {
    const onDeleted = vi.fn(); window.addEventListener("plethora:extract-deleted", onDeleted);
    await deleteExtract("a", "doc");
    expect(await getExtract("a")).toBeNull();
    expect(fixture.rows).toEqual([{ id: "b" }]);
    expect(fixture.patchCount).toHaveBeenCalledExactlyOnceWith("doc", -1);
    expect(fixture.removeQueue).toHaveBeenCalledWith(["queue-a"]);
    expect((onDeleted.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: "a", documentId: "doc" });
    expect(fixture.invoke.mock.calls.some(([name]) => name === "delete_learning_item")).toBe(false);
    window.removeEventListener("plethora:extract-deleted", onDeleted);
  });

  it("normalizes browser ownership and anchors before validating/removing a saved annotation", async () => {
    const selectionContext = { type: "text", documentId: "doc", surface: "html", startOffset: 0, endOffset: 10 };
    record = { id: "a", documentId: "doc", content: "saved text", selectionContext, highlightColor: "yellow", tags: [] };
    expect(await getExtract("a")).toMatchObject({ document_id: "doc", selection_context: selectionContext, highlight_color: "yellow" });
    await deleteExtract("a", "doc");
    expect(await getExtract("a")).toBeNull();
    expect(fixture.patchCount).toHaveBeenCalledExactlyOnceWith("doc", -1);
  });

  it("keeps marks and count when persistent deletion fails and permits retry", async () => {
    fixture.invoke.mockImplementationOnce(async () => record).mockRejectedValueOnce(new Error("offline"));
    await expect(deleteExtract("a", "doc")).rejects.toThrow("offline");
    expect(fixture.rows).toHaveLength(2);
    expect(fixture.patchCount).not.toHaveBeenCalled();
    await deleteExtract("a", "doc");
    expect(fixture.rows).toEqual([{ id: "b" }]);
  });

  it("refuses a target belonging to a different document", async () => {
    await expect(deleteExtract("a", "other-doc")).rejects.toThrow("another document");
    expect(fixture.invoke).not.toHaveBeenCalledWith("delete_extract", expect.anything());
    expect(fixture.rows).toHaveLength(2);
  });

  it("does not delete when ownership lookup fails", async () => {
    fixture.invoke.mockRejectedValueOnce(new Error("lookup failed"));
    await expect(deleteExtract("a", "doc")).rejects.toThrow("lookup failed");
    expect(fixture.patchCount).not.toHaveBeenCalled();
  });

  it.each([null, { id: "a", document_id: "doc", _deleted: true }, { id: "a", documentId: "doc", Deleted: true }])("reconciles an already deleted target without another decrement (%j)", async (missing) => {
    record = missing;
    await deleteExtract("a", "doc");
    expect(fixture.rows).toEqual([{ id: "b" }]);
    expect(fixture.patchCount).not.toHaveBeenCalled();
    expect(fixture.invoke).not.toHaveBeenCalledWith("delete_extract", expect.anything());
  });

  it("coalesces simultaneous confirmations into one persisted operation", async () => {
    await Promise.all([deleteExtract("a", "doc"), deleteExtract("a", "doc")]);
    expect(fixture.invoke.mock.calls.filter(([name]) => name === "delete_extract")).toHaveLength(1);
    expect(fixture.patchCount).toHaveBeenCalledTimes(1);
  });

  it("keeps a successful deletion when a dependent queue reconciliation fails", async () => {
    fixture.removeQueue.mockImplementationOnce(() => { throw new Error("refresh failed"); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(deleteExtract("a", "doc")).resolves.toBeUndefined();
    expect(await getExtract("a")).toBeNull();
    expect(fixture.rows).toEqual([{ id: "b" }]);
    await deleteExtract("a", "doc");
    expect(fixture.patchCount).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
