import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useShareTarget } from "../useShareTarget";
import { useDocumentStore } from "../../stores/documentStore";
import * as shareTargetLib from "../../lib/shareTarget";

const nativePlatform = vi.hoisted(() => ({ value: "ios" }));
vi.mock("../../lib/tauri", async importOriginal => {
  const actual = await importOriginal<typeof import("../../lib/tauri")>();
  return {
    ...actual,
    isNativeMobile: () => true,
    nativePlatform: () => nativePlatform.value,
    listen: () => Promise.resolve(() => {}),
  };
});

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

// useShareTarget imports createDocument/updateDocument directly from the api module.
vi.mock("../../api/documents", () => ({
  createDocument: vi.fn().mockResolvedValue({ id: "doc-note", title: "note", metadata: {} }),
  updateDocument: vi.fn().mockImplementation((_id, doc) => Promise.resolve(doc)),
  updateDocumentContent: vi.fn().mockImplementation((id, content) => Promise.resolve({ id, title: "note", content, metadata: {} })),
  mergeDocumentMetadata: vi.fn().mockImplementation((id, updates) => Promise.resolve({ id, title: id, metadata: updates })),
}));

import { createDocument, mergeDocumentMetadata, updateDocument } from "../../api/documents";

describe("useShareTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativePlatform.value = "ios";
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

  it("persists iOS share attribution before acknowledging a staged batch", async () => {
    let releaseAttribution!: (doc: any) => void;
    const attribution = new Promise(resolve => { releaseAttribution = resolve; });
    vi.mocked(mergeDocumentMetadata).mockReturnValueOnce(attribution as any);
    vi.spyOn(shareTargetLib, "registerShareListener").mockImplementation(() => () => {});
    vi.spyOn(shareTargetLib, "fetchPendingShares").mockResolvedValue([{
      id: "staged-ios", timestamp: 1724200000000,
      items: [{ type: "url", url: "https://example.com/staged-ios" }],
    }]);
    const complete = vi.spyOn(shareTargetLib, "completePendingShares").mockResolvedValue(undefined);
    const importFromUrlMock = vi.fn().mockResolvedValue({ id: "ios-doc", title: "Saved", metadata: {} });
    useDocumentStore.setState({ importFromUrl: importFromUrlMock } as any);

    renderHook(() => useShareTarget());
    await vi.waitFor(() => expect(mergeDocumentMetadata).toHaveBeenCalledWith("ios-doc", expect.objectContaining({
      shareProvenance: expect.objectContaining({ source: "share_extension", batchId: "staged-ios" }),
    })));
    expect(complete).not.toHaveBeenCalled();
    releaseAttribution({ id: "ios-doc", title: "Saved", metadata: {} });
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith(["staged-ios"]));
  });

  it("attributes a warm Android share with the Android native origin", async () => {
    nativePlatform.value = "android";
    let capturedHandler: ((batch: any) => Promise<any>) | null = null;
    vi.spyOn(shareTargetLib, "registerShareListener").mockImplementation((handler: any) => { capturedHandler = handler; return () => {}; });
    vi.spyOn(shareTargetLib, "fetchPendingShares").mockResolvedValue([]);
    useDocumentStore.setState({ importFromUrl: vi.fn().mockResolvedValue({ id: "android-doc", title: "Android", metadata: {} }) } as any);

    renderHook(() => useShareTarget());
    await capturedHandler!({ timestamp: 1724200000001, items: [{ type: "url", url: "https://example.com/android" }] });

    expect(mergeDocumentMetadata).toHaveBeenCalledWith("android-doc", expect.objectContaining({
      shareProvenance: expect.objectContaining({ source: "android_share", sourceUrl: "https://example.com/android" }),
    }));
  });

  it("processes concurrent shares with different URLs sequentially via FIFO queue without dropping any", async () => {
    let capturedHandler: ((batch: any) => Promise<any>) | null = null;
    vi.spyOn(shareTargetLib, "registerShareListener").mockImplementation((handler: any) => {
      capturedHandler = handler;
      return () => {};
    });
    vi.spyOn(shareTargetLib, "fetchPendingShares").mockResolvedValue([]);

    const executionOrder: string[] = [];
    const openTwitterThreadMock = vi.fn().mockImplementation(async (url: string) => {
      executionOrder.push(`start-${url}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      executionOrder.push(`end-${url}`);
      return { id: `doc-${url}`, title: "Thread" };
    });

    useDocumentStore.setState({
      openTwitterThread: openTwitterThreadMock,
      loadDocuments: vi.fn(),
    } as any);

    renderHook(() => useShareTarget());

    const promise1 = capturedHandler!({
      timestamp: Date.now(),
      items: [{ type: "url", url: "https://x.com/user/status/111" }],
    });
    const promise2 = capturedHandler!({
      timestamp: Date.now(),
      items: [{ type: "url", url: "https://x.com/user/status/222" }],
    });

    await Promise.all([promise1, promise2]);

    expect(openTwitterThreadMock).toHaveBeenCalledTimes(2);
    expect(openTwitterThreadMock).toHaveBeenCalledWith("https://x.com/user/status/111");
    expect(openTwitterThreadMock).toHaveBeenCalledWith("https://x.com/user/status/222");
    expect(executionOrder).toEqual([
      "start-https://x.com/user/status/111",
      "end-https://x.com/user/status/111",
      "start-https://x.com/user/status/222",
      "end-https://x.com/user/status/222",
    ]);
  });

  it("coalesces duplicate rapid shares for the same status URL into one import", async () => {
    let capturedHandler: ((batch: any) => Promise<any>) | null = null;
    vi.spyOn(shareTargetLib, "registerShareListener").mockImplementation((handler: any) => {
      capturedHandler = handler;
      return () => {};
    });
    vi.spyOn(shareTargetLib, "fetchPendingShares").mockResolvedValue([]);

    let resolveFirstThread: (val: any) => void = () => {};
    const openTwitterThreadMock = vi.fn().mockImplementation(() => {
      return new Promise((resolve) => {
        resolveFirstThread = resolve;
      });
    });

    useDocumentStore.setState({
      openTwitterThread: openTwitterThreadMock,
      loadDocuments: vi.fn(),
    } as any);

    renderHook(() => useShareTarget());

    const promise1 = capturedHandler!({
      timestamp: Date.now(),
      items: [{ type: "url", url: "https://x.com/user/status/12345?s=20" }],
    });
    const promise2 = capturedHandler!({
      timestamp: Date.now(),
      items: [{ type: "url", url: "https://twitter.com/user/status/12345" }],
    });

    await vi.waitFor(() => {
      expect(openTwitterThreadMock).toHaveBeenCalledTimes(1);
    });
    resolveFirstThread({ id: "doc-12345", title: "Thread 12345" });
    const [res1, res2] = await Promise.all([promise1, promise2]);

    expect(openTwitterThreadMock).toHaveBeenCalledTimes(1);
    expect(res1.imported).toBe(1);
    expect(res2.imported).toBe(1);
  });
});
