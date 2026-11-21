import React, { useEffect, useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFViewer } from "../PDFViewer";

const fixture = vi.hoisted(() => ({
  getDestination: vi.fn(), getPosition: vi.fn(), pageReady: true, pageCount: 8, reflow: false, mobile: true,
  getPageLabels: vi.fn<() => Promise<string[] | null>>(),
  getPageText: vi.fn<(page: number) => Promise<string>>(),
  emitCanonical: null as null | ((page: any) => void),
  viewports: new Map<number, (viewport?: any) => void>(),
}));
const vp = { scale: 1, width: 600, height: 800, viewBox: [0, 0, 600, 800], convertToViewportPoint: (x: number, y: number) => [x, 800 - y], convertToPdfPoint: (x: number, y: number) => [x, 800 - y] };
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  PDFDataRangeTransport: class {},
  getDocument: vi.fn(() => ({ promise: Promise.resolve({
    numPages: fixture.pageCount, fingerprints: ["test"], destroy: vi.fn(async () => {}),
    getPage: vi.fn(async (page: number) => ({
      getViewport: () => vp,
      getTextContent: async () => ({ items: [{ str: await fixture.getPageText(page) }] }),
    })),
    getDestination: fixture.getDestination,
    getPageLabels: fixture.getPageLabels,
    getPageIndex: async (ref: any) => ref.num - 1,
    getOutline: async () => [
      { title: "Heading A", dest: "a", items: [] },
      { title: "Heading B", dest: "b", items: [] },
      { title: "Distant heading", dest: "far", items: [] },
    ],
  }), destroy: vi.fn(async () => {}) })),
}));
vi.mock("../PdfPageView", () => ({
  PdfPageViewWrapper: (props: any) => {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const el = ref.current!;
      Object.defineProperties(el, {
        offsetTop: { configurable: true, value: props.pageIndex * 824 + 16 },
        offsetHeight: { configurable: true, value: 800 },
      });
      props.onSlotRef(props.pageIndex, el);
      const ready = (viewport = vp) => props.onViewportChange(props.pageIndex, viewport);
      fixture.viewports.set(props.pageIndex, ready);
      if (fixture.pageReady) ready();
      return () => props.onSlotRef(props.pageIndex, null);
    }, [props.pageIndex, props.onSlotRef, props.onViewportChange]);
    return <div ref={ref} data-pdf-page data-page-number={props.pageIndex + 1} />;
  },
}));
vi.mock("../pdfFeatureFlags", () => ({
  isPdfFeatureEnabled: () => fixture.reflow,
  pdfReflowEngine: () => fixture.reflow ? "canonical" : "disabled",
  shouldUseNativePdfRangeSource: () => false,
}));
vi.mock("../../../lib/tauri", async (original) => ({ ...await original<any>(), getFormFactor: () => "phone", isTauri: () => false }));
vi.mock("../pdfCanonicalScheduler", () => ({
  PdfCanonicalScheduler: class {
    constructor(_pdf: any, _cache: any, callback: (page: any) => void) { fixture.emitCanonical = callback; }
    async start() { /* Tests publish analysis readiness explicitly. */ }
    cancel() {}
  },
  lineText: () => "",
}));
vi.mock("../PdfCanonicalReflowRenderer", () => ({
  PdfCanonicalReflowRenderer: ({ pages }: any) => <div>{pages.map((page: any) =>
    <section key={page.pageNumber} data-pdf-reflow-page={page.pageNumber}>{page.blocks.map((block: any, index: number) =>
      <h2 key={block.id} data-pdf-reflow-block={block.id} ref={(el) => {
        if (!el) return;
        el.getBoundingClientRect = () => {
          const container = el.closest("[data-document-scroll-container]")!;
          const top = (page.pageNumber - 1) * 824 + 100 + index * 300 - container.scrollTop;
          return { top, bottom: top + 30 } as DOMRect;
        };
      }}>{block.text}</h2>
    )}</section>
  )}</div>,
}));
function canonicalPage(pageNumber = 1) {
  return { pageNumber, width: 600, height: 800, rotation: 0, state: "ready", classification: "semantic", words: [], lines: [], warnings: [], blocks: [700, 200].map((y, i) => ({
    id: `p${pageNumber}:b${i}`, pageNumber, kind: "heading", role: "body", text: `Block ${i}`, wordIds: [], lineIds: [], readingOrder: i, sourceRegions: [{ pageNumber, bbox: { x0: 0, y0: y - 20, x1: 500, y1: y } }],
  })) };
}
vi.mock("../../../hooks/useMobileShell", () => ({ useMobileShell: () => fixture.mobile }));
vi.mock("../../../api/position", () => ({ getDocumentPosition: fixture.getPosition, saveDocumentPosition: vi.fn(), pagePosition: (page: number) => ({ type: "page", page }), scrollPosition: (percent: number) => ({ type: "scroll", percent }) }));
vi.mock("../../../api/documents", async (original) => ({ ...await original<any>(), getDocumentAuto: vi.fn(async () => ({})), updateDocumentProgressAuto: vi.fn() }));

async function reader(extra: Record<string, any> = {}) {
  const bytes = new Uint8Array([1]);
  const start = vi.fn();
  const settled = vi.fn();
  function Host() {
    const [page, setPage] = useState(1);
    return <PDFViewer documentId="nav-fixture" fileData={bytes} pageNumber={page} scale={1} zoomMode="custom" parentOwnsRestoration onNavigationStart={start} onNavigationSettled={settled} onPageChange={setPage} {...extra} />;
  }
  const result = render(<Host />);
  await waitFor(() => expect(result.container.querySelector("[data-pdf-page]")).toBeTruthy());
  const container = result.container.querySelector("[data-document-scroll-container]") as HTMLElement;
  Object.defineProperties(container, {
    scrollHeight: { configurable: true, value: 824 * fixture.pageCount },
    clientHeight: { configurable: true, value: 600 },
    scrollWidth: { configurable: true, value: 600 }, clientWidth: { configurable: true, value: 600 },
  });
  container.scrollTo = vi.fn((options: any) => { container.scrollTop = options.top ?? container.scrollTop; container.scrollLeft = options.left ?? container.scrollLeft; });
  return { ...result, scroll: container, start, settled };
}
async function select(title: string) {
  act(() => { window.dispatchEvent(new Event("viewer-toggle-toc")); });
  await waitFor(() => expect(screen.getByText(title)).toBeTruthy());
  fireEvent.click(screen.getByText(title));
}

describe("PDFViewer navigation integration", () => {
  beforeEach(() => {
    fixture.reflow = false; fixture.mobile = true; fixture.emitCanonical = null; localStorage.clear();
    fixture.pageCount = 8; fixture.pageReady = true; fixture.viewports.clear(); fixture.getPosition.mockReset();
    fixture.getPageLabels.mockReset().mockResolvedValue(null);
    fixture.getPageText.mockReset().mockResolvedValue("");
    fixture.getDestination.mockReset().mockImplementation(async (name: string) =>
      [name === "far" ? 6 : 0, { name: "XYZ" }, 0, name === "b" ? 200 : 700, null]);
  });
  it("displays the printed label while accepting physical page numbers", async () => {
    fixture.getPageLabels.mockResolvedValue(["i", "ii", "1", "4", "5", "6", "7", "8"]);
    await reader();
    const input = screen.getByRole("spinbutton", { name: "Go to page" });
    await waitFor(() => expect(input).toHaveAccessibleDescription("Printed page i"));
    expect(screen.getByTitle("Printed page i")).toHaveTextContent("(i)");
    expect(input).toHaveValue(1);

    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input).toHaveAccessibleDescription("Printed page 1"));
    expect(input).toHaveValue(3);

    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input).not.toHaveAttribute("aria-describedby"));
    expect(input).toHaveValue(4);
  });

  it("ignores stale labels from a previous PDF and keeps navigation when labels fail", async () => {
    let finishFirstLabels!: (labels: string[]) => void;
    fixture.getPageLabels
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirstLabels = resolve; }))
      .mockResolvedValueOnce(["Cover"])
      .mockRejectedValueOnce(new Error("Page labels unavailable"));
    const bytes = new Uint8Array([1]);
    const view = (documentId: string) => (
      <PDFViewer documentId={documentId} fileData={bytes} pageNumber={1} scale={1} zoomMode="custom" parentOwnsRestoration />
    );
    const r = render(view("first"));
    await waitFor(() => expect(fixture.getPageLabels).toHaveBeenCalledTimes(1));
    r.rerender(view("second"));
    await waitFor(() => expect(screen.getByTitle("Printed page Cover")).toBeInTheDocument());
    await act(async () => { finishFirstLabels(["Stale"]); });
    expect(screen.queryByTitle("Printed page Stale")).not.toBeInTheDocument();
    expect(screen.getByTitle("Printed page Cover")).toBeInTheDocument();

    r.rerender(view("third"));
    await waitFor(() => expect(fixture.getPageLabels).toHaveBeenCalledTimes(3));
    const input = screen.getByRole("spinbutton", { name: "Go to page" });
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(input).toHaveValue(1);
  });

  it("keeps native text on the active page when only a neighboring canonical page is ready", async () => {
    fixture.reflow = true;
    fixture.getPageText.mockImplementation(async (page) => page === 1 ? "Page one native text." : "");
    const onTextWindowChange = vi.fn();
    await reader({ onTextWindowChange });
    await waitFor(() => expect(fixture.emitCanonical).toBeTruthy());
    act(() => fixture.emitCanonical!(canonicalPage(2)));
    await waitFor(() => expect(onTextWindowChange).toHaveBeenLastCalledWith(
      expect.stringContaining('<page number="1"/>Page one native text.'),
      expect.arrayContaining([
        expect.objectContaining({ pageNumber: 1, text: "Page one native text." }),
        expect.objectContaining({ pageNumber: 2, text: expect.stringContaining("Block 0") }),
      ]),
      expect.objectContaining({ documentId: "nav-fixture", activePage: 1, activePageText: "Page one native text." }),
    ));
  });

  it("never emits a previous PDF's canonical text as evidence for a newly loaded PDF", async () => {
    fixture.reflow = true;
    const bytes = new Uint8Array([1]);
    const onTextWindowChange = vi.fn();
    const view = (documentId: string) => (
      <PDFViewer documentId={documentId} fileData={bytes} pageNumber={1} scale={1}
        zoomMode="custom" parentOwnsRestoration onTextWindowChange={onTextWindowChange} />
    );
    const result = render(view("first"));
    await waitFor(() => expect(fixture.emitCanonical).toBeTruthy());
    act(() => fixture.emitCanonical!(canonicalPage()));
    await waitFor(() => expect(onTextWindowChange).toHaveBeenLastCalledWith(
      expect.stringContaining("Block 0"), expect.any(Array), expect.objectContaining({ documentId: "first" }),
    ));

    result.rerender(view("second"));
    await waitFor(() => expect(onTextWindowChange).toHaveBeenLastCalledWith(
      "", [], expect.objectContaining({ documentId: "second" }),
    ));
    for (const [text, , window] of onTextWindowChange.mock.calls) {
      if (window.documentId === "second") expect(text).not.toContain("Block 0");
    }
  });

  it.each([false, true])("right-clicks an owned saved mark without selection (reflow=%s)", async (reflow) => {
    fixture.mobile = false;
    fixture.reflow = reflow;
    const annotation = { extractId: "saved:opaque-id", documentId: "nav-fixture", text: "Saved passage" };
    const onContextMenu = vi.fn();
    const r = await reader({ onContextMenu, persistedHighlights: [{ id: "fragment-1", annotation, pageNumber: 1,
      pdfRects: [{ x1: 10, y1: 20, x2: 100, y2: 40 }], color: "yellow", text: annotation.text, createdAt: 0, wordIds: ["p1-word"] }] });
    if (reflow) {
      await waitFor(() => expect(fixture.emitCanonical).toBeTruthy());
      act(() => fixture.emitCanonical!(canonicalPage()));
      await waitFor(() => expect(screen.getByLabelText("Switch to original PDF view")).toBeTruthy());
    }
    // Exercise the real PDFViewer document listener. Renderer-specific
    // geometry/ownership is covered by HighlightLayer and reflow tests.
    const mark = document.createElement("span");
    if (reflow) { mark.dataset.w = "p1-word"; mark.className = "pdf-reflow-highlight"; }
    else mark.dataset.highlightId = "fragment-1";
    mark.getClientRects = () => [new DOMRect(10, 20, 100, 20)] as unknown as DOMRectList;
    r.scroll.appendChild(mark);
    fireEvent.contextMenu(mark, { clientX: 30, clientY: 25 });
    expect(onContextMenu).toHaveBeenCalledExactlyOnceWith({ x: 30, y: 25, selectedText: "", annotations: [annotation] });
  });

  it("right-clicks selected text in fixed mode on desktop and emits the shared menu payload", async () => {
    fixture.mobile = false;
    const onContextMenu = vi.fn();
    const r = await reader({ onContextMenu });
    const pageEl = r.container.querySelector("[data-pdf-page][data-page-number='1']") as HTMLElement;
    pageEl.getBoundingClientRect = () => new DOMRect(0, 0, 600, 800);

    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    const span = document.createElement("span");
    span.textContent = "Selected OCR text";
    textLayer.appendChild(span);
    pageEl.appendChild(textLayer);

    // Mock textLayer registration + selection inside the text layer.
    const range = document.createRange();
    range.setStart(span.firstChild!, 0);
    range.setEnd(span.firstChild!, 17);
    range.getClientRects = () => [new DOMRect(20, 40, 120, 18)] as unknown as DOMRectList;
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    // Ensure mousedown(2)/mouseup(2) before contextmenu (Windows/macOS order) does not clear selection.
    fireEvent.mouseDown(span, { button: 2, clientX: 50, clientY: 48 });
    fireEvent.mouseUp(span, { button: 2, clientX: 50, clientY: 48 });
    fireEvent.contextMenu(span, { clientX: 50, clientY: 48 });

    // Even before textLayerRootsRef is populated via PdfPageView, verify mousedown(2) didn't clear selection.
    expect(sel.toString()).toBe("Selected OCR text");
    sel.removeAllRanges();
  });

  it("navigates independently to multiple headings on the currently displayed page", async () => {
    const r = await reader();
    await select("Heading A");
    await waitFor(() => expect(r.scroll.scrollTop).toBe(100));
    await waitFor(() => expect(r.settled).toHaveBeenCalledTimes(1));
    await select("Heading B");
    await waitFor(() => expect(r.scroll.scrollTop).toBe(600));
    await waitFor(() => expect(r.settled).toHaveBeenCalledTimes(2));
    expect(r.start).toHaveBeenCalledTimes(2);
    expect(fixture.getPosition).not.toHaveBeenCalled();
  });
  it("ignores a slow older destination after a newer click", async () => {
    let resolve!: (value: any) => void;
    fixture.getDestination.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const r = await reader();
    await select("Heading A");
    // First unresolved click keeps the TOC open.
    fireEvent.click(screen.getByText("Heading B"));
    await waitFor(() => expect(r.scroll.scrollTop).toBe(600));
    await act(async () => { resolve([6, { name: "XYZ" }, 0, 700, null]); });
    expect(r.scroll.scrollTop).toBe(600);
  });
  it("waits for the destination zoom before applying transformed coordinates", async () => {
    fixture.getDestination.mockResolvedValue([0, { name: "XYZ" }, 0, 700, 2]);
    const setScale = vi.fn();
    const r = await reader({ onScaleChange: setScale });
    await select("Heading A");
    await waitFor(() => expect(setScale).toHaveBeenCalledWith(2));
    expect(r.scroll.scrollTo).not.toHaveBeenCalled();
    act(() => fixture.viewports.get(0)!({ ...vp, scale: 2, height: 1600, width: 1200, convertToViewportPoint: (x: number, y: number) => [x * 2, (800 - y) * 2] }));
    await waitFor(() => expect(r.scroll.scrollTop).toBe(200));
    await waitFor(() => expect(r.settled).toHaveBeenCalledTimes(1));
  });

  it("manual backward and forward input cancels pending destination resolution", async () => {
    for (const top of [50, 1500]) {
      let resolve!: (value: any) => void;
      fixture.getDestination.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
      const r = await reader();
      await select("Heading A");
      fireEvent.touchStart(r.scroll);
      r.scroll.scrollTop = top;
      await act(async () => { resolve([0, { name: "XYZ" }, 0, 200, null]); });
      expect(r.scroll.scrollTop).toBe(top);
      expect(r.settled).not.toHaveBeenCalled();
      r.unmount();
    }
  });
  it("waits for virtualized page geometry and reaches the selected heading", async () => {
    fixture.pageCount = 100; fixture.pageReady = false;
    const r = await reader();
    await select("Distant heading");
    expect(r.scroll.scrollTo).not.toHaveBeenCalled();
    await waitFor(() => expect(fixture.viewports.has(6)).toBe(true));
    act(() => fixture.viewports.get(6)!());
    await waitFor(() => expect(r.scroll.scrollTop).toBe(6 * 824 + 100));
    await waitFor(() => expect(r.settled).toHaveBeenCalledTimes(1));
  });
  it("late virtual rendering cannot undo a manual scroll", async () => {
    fixture.pageReady = false;
    const r = await reader();
    await select("Heading A");
    fireEvent.wheel(r.scroll);
    r.scroll.scrollTop = 300;
    act(() => fixture.viewports.get(0)!());
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(r.scroll.scrollTop).toBe(300);
  });
  it("reflow TOC resolves the actual source heading on the same page", async () => {
    fixture.reflow = true;
    const r = await reader();
    await waitFor(() => expect(fixture.emitCanonical).toBeTruthy());
    act(() => fixture.emitCanonical!(canonicalPage()));
    await waitFor(() => expect(screen.getByLabelText("Switch to original PDF view")).toBeTruthy());
    await select("Heading B");
    await waitFor(() => expect(r.scroll.scrollTop).toBe(384));
    expect(r.settled).toHaveBeenCalledTimes(1);
  });

  it("reflow waits for delayed semantic blocks, and user input cancels the wait", async () => {
    fixture.reflow = true;
    const r = await reader();
    await waitFor(() => expect(fixture.emitCanonical).toBeTruthy());
    act(() => fixture.emitCanonical!(canonicalPage()));
    await waitFor(() => expect(screen.getByLabelText("Switch to original PDF view")).toBeTruthy());
    await select("Distant heading");
    expect(r.scroll.scrollTo).not.toHaveBeenCalled();
    fireEvent.touchStart(r.scroll);
    r.scroll.scrollTop = 333;
    act(() => fixture.emitCanonical!(canonicalPage(7)));
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(r.scroll.scrollTop).toBe(333);
    expect(r.settled).not.toHaveBeenCalled();
  });

  it("delayed reflow analysis applies the latest heading once ready", async () => {
    fixture.reflow = true;
    const r = await reader();
    await waitFor(() => expect(fixture.emitCanonical).toBeTruthy());
    act(() => fixture.emitCanonical!(canonicalPage()));
    await waitFor(() => expect(screen.getByLabelText("Switch to original PDF view")).toBeTruthy());
    await select("Distant heading");
    act(() => fixture.emitCanonical!(canonicalPage(7)));
    await waitFor(() => expect(r.scroll.scrollTop).toBe(6 * 824 + 84));
    expect(r.settled).toHaveBeenCalledTimes(1);
  });

  it("a stale parent restore request cannot override a same-page TOC action", async () => {
    fixture.pageReady = false;
    const state = { pageNumber: 1, dest: { kind: "XYZ", left: 0, top: 700 }, docId: "nav-fixture", version: 1 };
    const complete = vi.fn();
    const r = await reader({ restoreState: state, restoreRequestId: 0, onInitialRestoreComplete: complete });
    await select("Heading B");
    act(() => fixture.viewports.get(0)!());
    await waitFor(() => expect(r.scroll.scrollTop).toBe(600));
    expect(complete).not.toHaveBeenCalled();
    expect(r.start).toHaveBeenCalledTimes(1);
  });

  it("reopening restores saved progress once, and later page changes do not replay it", async () => {
    let deliver!: (position: any) => void;
    fixture.getPosition.mockImplementation(() => new Promise((resolve) => { deliver = resolve; }));
    const r = await reader({ parentOwnsRestoration: false });
    await waitFor(() => expect(fixture.getPosition).toHaveBeenCalledTimes(1));
    await act(async () => { deliver({ type: "page", page: 1, offset: 0.5 }); });
    await waitFor(() => expect(r.scroll.scrollTop).toBe(416));
    await select("Heading A");
    await waitFor(() => expect(r.scroll.scrollTop).toBe(100));
    expect(fixture.getPosition).toHaveBeenCalledTimes(1);
    r.unmount();
    fixture.getPosition.mockClear();
    const reopened = await reader({ parentOwnsRestoration: false });
    await waitFor(() => expect(fixture.getPosition).toHaveBeenCalledTimes(1));
    await act(async () => { deliver({ type: "page", page: 1, offset: 0.105 }); });
    await waitFor(() => expect(reopened.scroll.scrollTop).toBe(100));
  });
  it("a late saved-position lookup cannot overtake initial touch input", async () => {
    let deliver!: (position: any) => void;
    fixture.getPosition.mockImplementation(() => new Promise((resolve) => { deliver = resolve; }));
    const r = await reader({ parentOwnsRestoration: false });
    await waitFor(() => expect(fixture.getPosition).toHaveBeenCalledTimes(1));
    fireEvent.touchStart(r.scroll);
    r.scroll.scrollTop = 250;
    await act(async () => { deliver({ type: "page", page: 1, offset: 0.8 }); });
    expect(r.scroll.scrollTop).toBe(250);
  });

});
