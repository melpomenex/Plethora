import { describe, expect, it } from "vitest";
import { PdfPassageAdapter } from "../adapters/pdf";
import { EpubPassageAdapter } from "../adapters/epub";
import { DomBlockPassageAdapter, type DomVisibilitySource } from "../adapters/domBlocks";
import { PdfMappedBlockAdapter } from "../adapters/pdfMapped";
import type { PassageEncounterEvent, PassagePolicyIdentity } from "../types";

const policy: PassagePolicyIdentity = {
  classifierVersion: "classifier-a",
  servingRevision: "provider\u0000model",
};

function manualVisibility() {
  const handlers = new Map<Element, { enter: () => void; exit: () => void }>();
  const source: DomVisibilitySource = {
    observe(element, onEnter, onExit) {
      handlers.set(element, { enter: onEnter, exit: onExit });
    },
    unobserve(element) {
      handlers.delete(element);
    },
    disconnect() {
      handlers.clear();
    },
  };
  return {
    source,
    enterAll() {
      for (const handler of handlers.values()) handler.enter();
    },
    enter(element: Element) {
      handlers.get(element)?.enter();
    },
    exit(element: Element) {
      handlers.get(element)?.exit();
    },
  };
}

function collect(adapter: { subscribeEncountered: (cb: (event: PassageEncounterEvent) => void) => () => void }) {
  const events: PassageEncounterEvent[] = [];
  adapter.subscribeEncountered((event) => events.push(event));
  return events;
}

function stubRect(element: Element, rect: { left: number; top: number; width: number; height: number }) {
  (element as HTMLElement).getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  (element as HTMLElement).getClientRects = () =>
    [
      {
        ...rect,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        x: rect.left,
        y: rect.top,
        toJSON: () => ({}),
      },
    ] as unknown as DOMRectList;
}

/* ------------------------------------------------------------------------- */
/* Fixed PDF                                                                 */
/* ------------------------------------------------------------------------- */

function pdfFixture(pageNumber: number, lines: string[]) {
  const page = document.createElement("div");
  page.setAttribute("data-pdf-page", "true");
  page.setAttribute("data-page-number", String(pageNumber));
  stubRect(page, { left: 0, top: 0, width: 600, height: 800 });
  const layer = document.createElement("div");
  layer.className = "textLayer";
  stubRect(layer, { left: 0, top: 0, width: 600, height: 800 });
  lines.forEach((line, index) => {
    const span = document.createElement("span");
    span.textContent = line;
    span.style.top = `${20 + index * 18}px`;
    stubRect(span, { left: 40, top: 20 + index * 18, width: 500, height: 16 });
    layer.appendChild(span);
  });
  page.appendChild(layer);
  document.body.appendChild(page);
  return { page, layer };
}

describe("PdfPassageAdapter", () => {
  it("scores only mounted encountered pages and keeps page/offset anchors", () => {
    const one = pdfFixture(1, [
      "A fundamental claim explains why the measured effect follows from the mechanism.",
      "The argument depends on a controlled comparison and a stable definition of the term.",
      "",
      "A second paragraph introduces the process used to reproduce the observation.",
    ]);
    const two = pdfFixture(2, [
      "A fundamental claim explains why the measured effect follows from the mechanism.",
      "The argument depends on a controlled comparison and a stable definition of the term.",
    ]);
    const visibility = manualVisibility();
    const adapter = new PdfPassageAdapter({
      ownerToken: "pdf-owner",
      documentId: "doc-1",
      sourceRevision: "rev-1",
      textLayers: [one.layer, two.layer],
      visibilityFactory: () => visibility.source,
    });
    adapter.configure(policy);
    const events = collect(adapter);
    expect(events).toHaveLength(0);
    visibility.enterAll();
    expect(events.filter((event) => event.kind === "enter").length).toBeGreaterThanOrEqual(2);

    const firstId = events.find((event) => event.kind === "enter")!.passageId;
    const snapshot = adapter.snapshot(firstId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.locator.kind).toBe("pdf");
    if (snapshot!.locator.kind === "pdf") {
      expect(snapshot!.locator.pageNumber).toBe(1);
      expect(snapshot!.locator.quote.length).toBeGreaterThanOrEqual(60);
      expect(snapshot!.locator.rects.length).toBeGreaterThan(0);
    }

    // Duplicate text on another page is a distinct anchor with the same digest.
    const pageTwoEntry = events.find(
      (event) => event.kind === "enter" && adapter.snapshot(event.passageId)?.locator.kind === "pdf" &&
        (adapter.snapshot(event.passageId)!.locator as { pageNumber: number }).pageNumber === 2
    );
    expect(pageTwoEntry).toBeDefined();

    // Zoom/reflow reprojects without changing identity.
    const before = adapter.projectRects(firstId);
    const spans = one.layer.querySelectorAll("span");
    spans.forEach((span, index) => stubRect(span, { left: 20, top: 30 + index * 24, width: 480, height: 20 }));
    const after = adapter.projectRects(firstId);
    expect(after).not.toEqual(before);
    expect(adapter.snapshot(firstId)?.passageId).toBe(firstId);
  });

  it("does no work for a scanned page and hides geometry after unmount", () => {
    const scanned = pdfFixture(3, []);
    const visibility = manualVisibility();
    const adapter = new PdfPassageAdapter({
      ownerToken: "pdf-owner",
      documentId: "doc-1",
      sourceRevision: "rev-1",
      textLayers: [scanned.layer],
      visibilityFactory: () => visibility.source,
    });
    adapter.configure(policy);
    const events = collect(adapter);
    visibility.enterAll();
    expect(events).toHaveLength(0);

    const mounted = pdfFixture(4, [
      "This mounted passage has enough text to be a legitimate extract candidate for review.",
    ]);
    const visibility2 = manualVisibility();
    const adapter2 = new PdfPassageAdapter({
      ownerToken: "pdf-owner-2",
      documentId: "doc-1",
      sourceRevision: "rev-1",
      textLayers: [mounted.layer],
      visibilityFactory: () => visibility2.source,
    });
    adapter2.configure(policy);
    const events2 = collect(adapter2);
    visibility2.enterAll();
    const id = events2[0]?.passageId;
    expect(id).toBeDefined();
    mounted.page.remove();
    expect(adapter2.projectRects(id!)).toBeNull();
    expect(adapter2.snapshot(id!)).toBeNull();
  });
});

/* ------------------------------------------------------------------------- */
/* PDF reflow / OCR page mapping                                             */
/* ------------------------------------------------------------------------- */

describe("PdfMappedBlockAdapter", () => {
  it("maps rendered reflow blocks onto canonical page text offsets", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <section data-pdf-reflow-page="1">
        <p id="r1">A canonical argument explains the mechanism and the evidence behind the claim.</p>
      </section>
      <section data-pdf-reflow-page="2">
        <p id="r2">A canonical definition fixes the term used by the argument in the previous page.</p>
      </section>
    `;
    document.body.appendChild(root);
    const pageOne =
      "A canonical argument explains the mechanism and the evidence behind the claim.";
    const pageTwo =
      "A canonical definition fixes the term used by the argument in the previous page.";
    const visibility = manualVisibility();
    const adapter = new PdfMappedBlockAdapter({
      ownerToken: "pdf-mapped",
      documentId: "doc-pdf",
      sourceRevision: "rev-1",
      root,
      pageSelector: "[data-pdf-reflow-page]",
      pageNumber: (section) => Number(section.getAttribute("data-pdf-reflow-page")),
      pageText: (page) => (page === 1 ? pageOne : page === 2 ? pageTwo : null),
      visibilityFactory: () => visibility.source,
    });
    adapter.configure(policy);
    const events = collect(adapter);
    visibility.enterAll();
    expect(events.filter((event) => event.kind === "enter")).toHaveLength(2);
    const snapshots = events
      .filter((event) => event.kind === "enter")
      .map((event) => adapter.snapshot(event.passageId)!);
    expect(snapshots.map((snapshot) => snapshot.locator.kind)).toEqual(["pdf", "pdf"]);
    const pages = snapshots.map((snapshot) =>
      snapshot.locator.kind === "pdf" ? snapshot.locator.pageNumber : -1
    );
    expect(pages).toEqual([1, 2]);
    const first = snapshots[0];
    if (first.locator.kind === "pdf") {
      expect(pageOne.slice(first.locator.startOffset, first.locator.endOffset)).toBe(
        first.locator.quote
      );
    }
    const p = root.querySelector("#r1")!;
    stubRect(p, { left: 10, top: 20, width: 300, height: 24 });
    expect(adapter.projectRects(snapshots[0].passageId)?.[0]).toMatchObject({ x: 10, y: 20 });
    adapter.dispose();
  });

  it("offers no passage when canonical mapping is unavailable", () => {
    const root = document.createElement("div");
    root.innerHTML = `<section data-pdf-reflow-page="1"><p>${paragraphA}</p></section>`;
    document.body.appendChild(root);
    const visibility = manualVisibility();
    const adapter = new PdfMappedBlockAdapter({
      ownerToken: "pdf-mapped-2",
      documentId: "doc-pdf",
      sourceRevision: "rev-1",
      root,
      pageSelector: "[data-pdf-reflow-page]",
      pageNumber: () => 1,
      pageText: () => null,
      visibilityFactory: () => visibility.source,
    });
    adapter.configure(policy);
    const events = collect(adapter);
    visibility.enterAll();
    expect(events).toHaveLength(0);
    adapter.dispose();
  });
});

/* ------------------------------------------------------------------------- */
/* EPUB                                                                      */
/* ------------------------------------------------------------------------- */

function epubContentDocument(paragraphs: string[], cfiPrefix: string) {
  const doc = document.implementation.createHTMLDocument("spine");
  doc.body.dataset.epubSpineIndex = "4";
  doc.body.dataset.epubHref = "chapter-4.xhtml";
  paragraphs.forEach((text) => {
    const p = doc.createElement("p");
    p.textContent = text;
    doc.body.appendChild(p);
  });
  const visibility = manualVisibility();
  return { doc, visibility, cfiPrefix };
}

describe("EpubPassageAdapter", () => {
  const longOne =
    "A definition in the spine introduces the core term and explains its scope inside the chapter.";
  const longTwo =
    "The following argument depends on the definition and on a comparison with the earlier chapter.";

  it("uses spine + CFI range identity and unregisters a removed frame", () => {
    const { doc, visibility } = epubContentDocument([longOne, longTwo], "epubcfi(/6/8");
    const adapter = new EpubPassageAdapter({
      ownerToken: "epub-owner",
      documentId: "doc-epub",
      sourceRevision: "rev-1",
      entries: [
        {
          doc,
          spineIndex: 4,
          spineHref: "chapter-4.xhtml",
          buildSelectionContext: (range) => ({
            cfiRange: `epubcfi(/6/8!/4/${doc.body.childNodes.length}:${range.startOffset})`,
          }),
          offset: () => ({ x: 100, y: 50 }),
        },
      ],
      visibilityFactory: () => visibility.source,
    });
    adapter.configure(policy);
    const events = collect(adapter);
    visibility.enterAll();
    expect(events.length).toBeGreaterThan(0);
    const id = events[0].passageId;
    const snapshot = adapter.snapshot(id);
    expect(snapshot?.locator.kind).toBe("epub");
    if (snapshot?.locator.kind === "epub") {
      expect(snapshot.locator.spineIndex).toBe(4);
      expect(snapshot.locator.cfiRange).toMatch(/^epubcfi/);
    }
    const paragraph = doc.querySelector("p")!;
    stubRect(paragraph, { left: 10, top: 20, width: 320, height: 40 });
    expect(adapter.projectRects(id)?.[0]).toMatchObject({ x: 110, y: 70 });
    paragraph.remove();
    expect(adapter.projectRects(id)).toBeNull();
    adapter.dispose();
  });

  it("offers no passage when the rendition cannot produce a CFI", () => {
    const { doc, visibility } = epubContentDocument([longOne], "");
    const adapter = new EpubPassageAdapter({
      ownerToken: "epub-owner-2",
      documentId: "doc-epub",
      sourceRevision: "rev-1",
      entries: [{ doc, buildSelectionContext: () => null }],
      visibilityFactory: () => visibility.source,
    });
    adapter.configure(policy);
    const events = collect(adapter);
    visibility.enterAll();
    expect(events).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------- */
/* HTML / Markdown / RSS                                                     */
/* ------------------------------------------------------------------------- */

function renderedRoot(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

const paragraphA =
  "A key argument states the claim, explains the mechanism and identifies the evidence used.";
const paragraphB =
  "A key argument states the claim, explains the mechanism and identifies the evidence used.";

describe("DomBlockPassageAdapter", () => {
  it("excludes controls/nav/hidden text and keeps duplicate text at distinct anchors", () => {
    const root = renderedRoot(`
      <p id="a">${paragraphA}</p>
      <nav><p>Navigation text that must never be scored even though it is long enough.</p></nav>
      <button>Control label</button>
      <div style="display:none">
        <p>Hidden text that must never be scored even though it is long enough.</p>
      </div>
      <blockquote><p id="b">${paragraphB}</p></blockquote>
      <script>const hidden = "script text";</script>
    `);
    const visibility = manualVisibility();
    const adapter = new DomBlockPassageAdapter({
      ownerToken: "html-owner",
      documentId: "doc-html",
      sourceRevision: "rev-1",
      kind: "html",
      roots: [{ doc: root.ownerDocument, root }],
      sourceText: () => `${paragraphA} ${paragraphB}`,
      observerFactory: () => visibility.source,
    });
    adapter.configure(policy);
    const events = collect(adapter);
    visibility.enterAll();
    const ids = events.filter((event) => event.kind === "enter").map((event) => event.passageId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);

    const snapshots = ids.map((id) => adapter.snapshot(id)!);
    for (const snapshot of snapshots) {
      expect(snapshot.text.length).toBeGreaterThanOrEqual(60);
      expect(snapshot.text).not.toContain("Navigation");
      expect(snapshot.text).not.toContain("Hidden");
      expect(snapshot.text).not.toContain("script");
    }
    // Duplicate text at two anchors keeps the same content digest but a
    // different stable passage id/locator.
    expect(snapshots[0].contentHash).toBe(snapshots[1].contentHash);
    expect(snapshots[0].locator).not.toEqual(snapshots[1].locator);

    // Reflow changes only projected geometry.
    const p = root.querySelector("#a")!;
    stubRect(p, { left: 0, top: 10, width: 300, height: 20 });
    const before = adapter.projectRects(ids[0]);
    stubRect(p, { left: 0, top: 40, width: 280, height: 30 });
    const after = adapter.projectRects(ids[0]);
    expect(before).not.toEqual(after);
    expect(adapter.snapshot(ids[0])?.passageId).toBe(ids[0]);

    // Hidden/detached source hides geometry.
    p.remove();
    expect(adapter.projectRects(ids[0])).toBeNull();
    expect(adapter.snapshot(ids[0])).toBeNull();
  });

  it("uses RSS article identity without fabricating a library document id", () => {
    const root = renderedRoot(`<p>${paragraphA}</p>`);
    const visibility = manualVisibility();
    const adapter = new DomBlockPassageAdapter({
      ownerToken: "rss:feed-1:item-1:reader",
      sourceRevision: "rss-rev-1",
      kind: "rss",
      articleId: "item-1",
      articleRevision: "rss-rev-1",
      roots: [{ doc: root.ownerDocument, root }],
      sourceText: () => paragraphA,
      observerFactory: () => visibility.source,
    });
    adapter.configure(policy);
    const events = collect(adapter);
    visibility.enterAll();
    const snapshot = adapter.snapshot(events[0].passageId)!;
    expect(snapshot.documentId).toBeUndefined();
    expect(snapshot.locator.kind).toBe("rss");
    if (snapshot.locator.kind === "rss") {
      expect(snapshot.locator.documentId).toBeUndefined();
      expect(snapshot.locator.articleId).toBe("item-1");
      expect(snapshot.locator.articleRevision).toBe("rss-rev-1");
    }
  });

  it("splits long blocks deterministically with contiguous offsets", () => {
    const longText = Array.from(
      { length: 30 },
      (_, index) => `Step ${index} documents a reproducible stage of the process in detail.`
    ).join(" ");
    const root = renderedRoot(`<p>${longText}</p>`);
    const visibility = manualVisibility();
    const adapter = new DomBlockPassageAdapter({
      ownerToken: "md-owner",
      documentId: "doc-md",
      sourceRevision: "rev-1",
      kind: "markdown",
      roots: [{ doc: root.ownerDocument, root }],
      sourceText: () => longText,
      observerFactory: () => visibility.source,
    });
    adapter.configure(policy);
    const events = collect(adapter);
    visibility.enterAll();
    const ids = events.filter((event) => event.kind === "enter").map((event) => event.passageId);
    expect(ids.length).toBeGreaterThan(1);
    const snapshots = ids.map((id) => adapter.snapshot(id)!);
    for (const snapshot of snapshots) expect(snapshot.text.length).toBeLessThanOrEqual(1_200);
    // Adapter identity is deterministic for unchanged content.
    const visibilityAgain = manualVisibility();
    const again = new DomBlockPassageAdapter({
      ownerToken: "md-owner",
      documentId: "doc-md",
      sourceRevision: "rev-1",
      kind: "markdown",
      roots: [{ doc: root.ownerDocument, root }],
      sourceText: () => longText,
      observerFactory: () => visibilityAgain.source,
    });
    again.configure(policy);
    const againEvents = collect(again);
    visibilityAgain.enterAll();
    expect(
      againEvents.filter((event) => event.kind === "enter").map((event) => event.passageId)
    ).toEqual(ids);
    again.dispose();
    adapter.dispose();
  });
});
