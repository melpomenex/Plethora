import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  findParagraphElement,
  isInteractiveElement,
  selectParagraphElement,
  attachTopDocumentAdapter,
  attachContentDocumentBridge,
  type SelectionAdapterHandlers,
} from "../adapters";

describe("selection interaction adapters - paragraph resolution & double-tap", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    window.getSelection()?.removeAllRanges();
    vi.useRealTimers();
  });

  it("findParagraphElement resolves p, blockquote, li, headers in reader content", () => {
    const root = document.createElement("div");
    root.setAttribute("data-document-content", "true");

    const p = document.createElement("p");
    const span = document.createElement("span");
    span.textContent = "Inner paragraph text";
    p.appendChild(span);
    root.appendChild(p);

    const bq = document.createElement("blockquote");
    bq.textContent = "Quote text";
    root.appendChild(bq);

    const outside = document.createElement("p");
    outside.textContent = "Outside reader content";

    document.body.appendChild(root);
    document.body.appendChild(outside);

    expect(findParagraphElement(span)).toBe(p);
    expect(findParagraphElement(p)).toBe(p);
    expect(findParagraphElement(bq)).toBe(bq);
    // Outside reader content scoper
    expect(findParagraphElement(outside)).toBeNull();
  });

  it("findParagraphElement excludes interactive elements like links and buttons", () => {
    const root = document.createElement("div");
    root.setAttribute("data-document-content", "true");

    const p = document.createElement("p");
    const link = document.createElement("a");
    link.href = "https://example.com";
    link.textContent = "Link text";
    const btn = document.createElement("button");
    btn.textContent = "Click me";

    p.appendChild(link);
    p.appendChild(btn);
    root.appendChild(p);
    document.body.appendChild(root);

    expect(isInteractiveElement(link)).toBe(true);
    expect(isInteractiveElement(btn)).toBe(true);
    expect(findParagraphElement(link)).toBeNull();
    expect(findParagraphElement(btn)).toBeNull();
  });

  it("selectParagraphElement creates a DOM Range covering the paragraph", () => {
    const p = document.createElement("p");
    p.textContent = "Full paragraph text to select";
    document.body.appendChild(p);

    const success = selectParagraphElement(p, document);
    expect(success).toBe(true);

    const sel = window.getSelection();
    expect(sel).not.toBeNull();
    expect(sel?.toString().trim()).toBe("Full paragraph text to select");
  });

  it("attachTopDocumentAdapter triggers onDoubleTap on touch double-tap on a paragraph", () => {
    const root = document.createElement("div");
    root.setAttribute("data-document-content", "true");
    const p = document.createElement("p");
    p.textContent = "Tap tap on paragraph";
    root.appendChild(p);
    document.body.appendChild(root);

    const handlers: SelectionAdapterHandlers = {
      onSelectionChanged: vi.fn(),
      onContentTouchStart: vi.fn(),
      onContentTouchEnd: vi.fn(),
      onPointerRelease: vi.fn(),
      onContentScroll: vi.fn(),
      onDoubleTap: vi.fn(),
      onDoubleClick: vi.fn(),
    };

    const detach = attachTopDocumentAdapter(handlers);

    const makeTouch = (clientX = 50, clientY = 50) => ({
      clientX,
      clientY,
      identifier: 1,
      target: p,
    });

    const fireTouchStart = (x: number, y: number) => {
      const event = new Event("touchstart", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", {
        value: [makeTouch(x, y)],
      });
      p.dispatchEvent(event);
    };

    // First tap
    fireTouchStart(50, 50);
    vi.advanceTimersByTime(150);

    // Second tap
    fireTouchStart(55, 52);

    expect(handlers.onDoubleTap).toHaveBeenCalledWith(p);
    expect(handlers.onSelectionChanged).toHaveBeenCalled();
    expect(window.getSelection()?.toString().trim()).toBe("Tap tap on paragraph");

    detach();
  });

  it("attachContentDocumentBridge triggers onDoubleTap for iframe-hosted documents", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const iframeDoc = iframe.contentDocument!;
    const p = iframeDoc.createElement("p");
    p.textContent = "EPUB chapter paragraph text";
    iframeDoc.body.appendChild(p);

    const handlers: SelectionAdapterHandlers = {
      onSelectionChanged: vi.fn(),
      onContentTouchStart: vi.fn(),
      onContentTouchEnd: vi.fn(),
      onPointerRelease: vi.fn(),
      onContentScroll: vi.fn(),
      onDoubleTap: vi.fn(),
      onDoubleClick: vi.fn(),
    };

    const detach = attachContentDocumentBridge({ doc: iframeDoc, win: iframe.contentWindow }, handlers);

    const makeTouch = (clientX = 40, clientY = 40) => ({
      clientX,
      clientY,
      identifier: 1,
      target: p,
    });

    const fireTouchStart = (x: number, y: number) => {
      const event = new Event("touchstart", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "touches", {
        value: [makeTouch(x, y)],
      });
      p.dispatchEvent(event);
    };

    // First tap
    fireTouchStart(40, 40);
    vi.advanceTimersByTime(120);

    // Second tap
    fireTouchStart(42, 41);

    expect(handlers.onDoubleTap).toHaveBeenCalledWith(p);
    expect(handlers.onSelectionChanged).toHaveBeenCalled();
    expect(iframe.contentWindow?.getSelection()?.toString().trim()).toBe("EPUB chapter paragraph text");

    detach();
  });
});
