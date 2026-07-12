import { describe, expect, it, vi } from "vitest";
import { PdfReflowOcrController } from "../pdfReflowOcr";

describe("incremental PDF OCR controller", () => {
  it("cancels stale page work without publishing a result", async () => {
    let release!: () => void;
    const page = {
      getViewport: vi.fn(() => ({ width: 600, height: 800 })),
      render: vi.fn(() => ({ promise: new Promise<void>((resolve) => { release = resolve; }) })),
    } as any;
    const canvas = document.createElement("canvas");
    vi.spyOn(document, "createElement").mockReturnValueOnce(canvas);
    vi.spyOn(canvas, "getContext").mockReturnValue({} as any);
    vi.spyOn(canvas, "toDataURL").mockReturnValue("data:image/png;base64,AA==");
    const controller = new PdfReflowOcrController();
    const updates = vi.fn();
    const pending = controller.recognize(page, 3, "eng", updates);
    await Promise.resolve();
    controller.cancel();
    release();
    expect(await pending).toBeNull();
    expect(updates).toHaveBeenCalledWith(expect.objectContaining({ state: "queued", pageNumber: 3 }));
  });

  it("defers work while backgrounded and enforces one-page concurrency", async () => {
    const hiddenSpy = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const page = { getViewport: vi.fn(), render: vi.fn() } as any;
    const controller = new PdfReflowOcrController();
    const updates = vi.fn();
    expect(await controller.recognize(page, 1, "eng", updates)).toBeNull();
    expect(page.render).not.toHaveBeenCalled();
    expect(updates).toHaveBeenCalledWith(expect.objectContaining({ state: "cancelled" }));
    hiddenSpy.mockRestore();

    let release!: () => void;
    const activePage = {
      getViewport: vi.fn(() => ({ width: 600, height: 800 })),
      render: vi.fn(() => ({ promise: new Promise<void>((resolve) => { release = resolve; }) })),
    } as any;
    const canvas = document.createElement("canvas");
    vi.spyOn(document, "createElement").mockReturnValueOnce(canvas);
    vi.spyOn(canvas, "getContext").mockReturnValue({} as any);
    vi.spyOn(canvas, "toDataURL").mockReturnValue("data:image/png;base64,AA==");
    const first = controller.recognize(activePage, 1, "eng", vi.fn());
    await Promise.resolve();
    await expect(controller.recognize(activePage, 2, "eng", vi.fn())).rejects.toThrow("already being recognized");
    controller.cancel();
    release();
    expect(await first).toBeNull();
  });
});
