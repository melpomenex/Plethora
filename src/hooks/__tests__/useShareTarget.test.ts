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
  }),
}));

describe("useShareTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers share listener and routes twitter URL to openTwitterThread", async () => {
    let capturedHandler: ((batch: any) => void) | null = null;
    vi.spyOn(shareTargetLib, "registerShareListener").mockImplementation((handler: any) => {
      capturedHandler = handler;
      return () => {};
    });

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
});
