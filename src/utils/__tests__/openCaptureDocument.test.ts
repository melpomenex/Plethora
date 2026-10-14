import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getDocument: vi.fn(), addTab: vi.fn(), updateTab: vi.fn(), focus: vi.fn(), documents: [] as unknown[], workspace: [] as unknown[] }));
vi.mock("../../api/documents", () => ({ getDocument: mocks.getDocument }));
vi.mock("../../stores/documentStore", () => ({ useDocumentStore: { getState: () => ({ documents: mocks.documents }) } }));
vi.mock("../../stores/tabsStore", () => ({ useTabsStore: { getState: () => ({ getWorkspaceTabs: () => mocks.workspace, updateTab: mocks.updateTab, setActiveTab: mocks.focus }) } }));
vi.mock("../../components/tabs/TabRegistry", () => ({ DocumentViewer: () => null }));
import { openDocumentAtLocation } from "../openDocumentAtLocation";

beforeEach(() => { vi.clearAllMocks(); mocks.documents = []; mocks.workspace = []; });
describe("saved capture navigation", () => {
  it("fetches an uncached cross-collection document directly by ID", async () => {
    mocks.getDocument.mockResolvedValue({ id: "outside", title: "Saved page", fileType: "html" });
    expect(await openDocumentAtLocation("outside", {}, mocks.addTab)).toBe(true);
    expect(mocks.getDocument).toHaveBeenCalledWith("outside");
    expect(mocks.addTab).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ documentId: "outside" }) }));
    expect(mocks.documents).toEqual([]);
  });
  it("reuses an existing reader even when its source was not in the collection cache", async () => {
    mocks.getDocument.mockResolvedValue({ id: "outside", title: "Saved page", fileType: "html" });
    mocks.workspace = [{ paneId: "pane", tab: { id: "reader", type: "document-viewer", data: { documentId: "outside" } } }];
    await openDocumentAtLocation("outside", {}, mocks.addTab);
    expect(mocks.focus).toHaveBeenCalledWith("pane", "reader");
    expect(mocks.addTab).not.toHaveBeenCalled();
  });
  it("does not create an empty reader for a removed or unavailable document", async () => {
    mocks.getDocument.mockResolvedValue(null);
    expect(await openDocumentAtLocation("deleted", {}, mocks.addTab)).toBe(false);
    mocks.getDocument.mockRejectedValue(new Error("offline"));
    expect(await openDocumentAtLocation("deleted", {}, mocks.addTab)).toBe(false);
    expect(mocks.addTab).not.toHaveBeenCalled();
  });
  it("checks persistence for a stale preview even when its document is cached", async () => {
    mocks.documents = [{ id: "deleted", title: "Old cached save", fileType: "html" }];
    mocks.getDocument.mockResolvedValue(null);
    expect(await openDocumentAtLocation("deleted", { ensureExists: true }, mocks.addTab)).toBe(false);
    expect(mocks.addTab).not.toHaveBeenCalled();
  });
});
