import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useShareTarget } from "../useShareTarget";
import { useDocumentStore } from "../../stores/documentStore";
import * as shareTargetLib from "../../lib/shareTarget";

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../components/common/Toast", () => ({
  useToast: () => ({
    info: vi.fn().mockReturnValue("toast-id"),
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
    warning: vi.fn(),
  }),
}));

// useShareTarget imports createDocument directly from the api module.
vi.mock("../../api/documents", () => ({
  createDocument: vi.fn().mockResolvedValue({ id: "doc-note", title: "note" }),
}));

import { createDocument } from "../../api/documents";

describe("useShareTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDocumentStore.setState({
      importFromUrl: vi.fn(),
      openTwitterThread: vi.fn(),
      importFromFiles: vi.fn(),
      loadDocuments: vi.fn(),
    } as any);
  });

  it("registers share listener and routes twitter URL to openTwitterThread", async () => {
    let capturedHandler: ((batch: any) => void) | null = null;
    vi.spyOn(shareTargetLib, "registerShareListener").mockImplementation((handler: any) => {
      capturedHandler = handler;
      return () => {};
    });
    vi.spyOn(shareTargetLib, "fetchPendingShares").mockResolvedValue([]);

    const openTwitterThreadMock = vi.fn().mockResolvedValue({
      id: "doc-123",
      title: "X Thread by @karpathy",
    });

    useDocumentStore.setState({
      openTwitterThread: openTwitterThreadMock,
      loadDocuments: vi.fn(),
    } as any);

    renderHook(() => useShareTarget());

    expect(capturedHandler).toBeDefined();

    await capturedHandler!({
      timestamp: Date.now(),
      items: [{ type: "url", url: "https://x.com/karpathy/status/1880000000000000000" }],
    });

    expect(openTwitterThreadMock).toHaveBeenCalledWith("https://x.com/karpathy/status/1880000000000000000");
  });

  it("routes warm-start file/text batches to importFromFiles/createDocument (regression: previously dropped)", async () => {
    let capturedHandler: ((batch: any) => Promise<any>) | null = null;
    vi.spyOn(shareTargetLib, "registerShareListener").mockImplementation((handler: any) => {
      capturedHandler = handler;
      return () => {};
    });
    vi.spyOn(shareTargetLib, "fetchPendingShares").mockResolvedValue([]);

    const importFromFilesMock = vi.fn().mockResolvedValue([
      { id: "doc-file", title: "paper.pdf" },
    ]);
    useDocumentStore.setState({
      importFromFiles: importFromFilesMock,
    } as any);

    renderHook(() => useShareTarget());

    await capturedHandler!({
      timestamp: Date.now(),
      items: [
        {
          type: "file",
          filePath: "/data/user/0/com.plethora.app/files/imports/paper.pdf",
          fileName: "paper.pdf",
        },
        { type: "text", text: "a shared note" },
      ],
    });

    expect(importFromFilesMock).toHaveBeenCalledWith([
      "/data/user/0/com.plethora.app/files/imports/paper.pdf",
    ]);
    expect(vi.mocked(createDocument)).toHaveBeenCalled();
  });

  it("drains cold-start pending shares from fetchPendingShares at startup", async () => {
    vi.spyOn(shareTargetLib, "registerShareListener").mockImplementation(() => () => {});
    const pendingBatch = {
      id: "staged-1",
      timestamp: Date.now(),
      items: [{ type: "url" as const, url: "https://example.com/cold-start" }],
    };
    const fetchSpy = vi
      .spyOn(shareTargetLib, "fetchPendingShares")
      .mockResolvedValue([pendingBatch]);

    const importFromUrlMock = vi.fn().mockResolvedValue({ id: "doc-cold", title: "cold" });
    useDocumentStore.setState({ importFromUrl: importFromUrlMock } as any);

    renderHook(() => useShareTarget());

    // fetchPendingShares is async; flush its delivery.
    await vi.waitFor(() => {
      expect(importFromUrlMock).toHaveBeenCalledWith("https://example.com/cold-start");
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
