import { describe, expect, it, vi } from "vitest";
import { ReaderNavigationOwner } from "../../../lib/readerNavigation";
import { resolveEpubTocTarget, guardEpubDisplay, guardEpubResize, alignEpubFragment, waitForEpubAnchorLayout } from "../epubNavigation";

describe("EPUB anchor resolution", () => {
  function fixture() {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<h1 id="intro">Intro</h1><h2 id="part two">Part two</h2>';
    const section = { href: "OPS/chapter.xhtml", document: doc, load: vi.fn().mockResolvedValue(doc), cfiFromElement: vi.fn((el: Element) => `cfi:${el.id}`) };
    const spine = { get: vi.fn(), spineItems: [section] };
    return { doc, section, book: { loaded: { spine: Promise.resolve(spine) }, load: vi.fn() } };
  }
  it("resolves an encoded fragment to its exact node, independent of chapter URL", async () => {
    const { book, section } = fixture();
    expect(await resolveEpubTocTarget(book, "chapter.xhtml#part%20two")).toBe("cfi:part two");
    expect(section.cfiFromElement).toHaveBeenCalledWith(section.document.getElementById("part two"));
    expect(await resolveEpubTocTarget(book, "chapter.xhtml#intro")).toBe("cfi:intro");
  });
  it("does not silently fall back to the chapter when its heading is missing", async () => {
    const { book } = fixture();
    await expect(resolveEpubTocTarget(book, "chapter.xhtml#missing")).rejects.toThrow("heading not found");
  });
  it("preserves fragments if spine resolution fails", async () => {
    const { book } = fixture();
    expect(await resolveEpubTocTarget(book, "different.xhtml#anchor")).toBe("different.xhtml#anchor");
  });
  it("aligns the iframe heading in the outer continuous scroll container", () => {
    const { doc } = fixture();
    const container = document.createElement("div");
    const frame = document.createElement("iframe");
    Object.defineProperties(container, { scrollHeight: { value: 3000 }, clientHeight: { value: 500 } });
    container.scrollTop = 200;
    container.getBoundingClientRect = () => ({ top: 10 } as DOMRect);
    frame.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
    doc.getElementById("intro")!.getBoundingClientRect = () => ({ top: 300 } as DOMRect);
    const scrollTo = vi.fn((_x, y) => { container.scrollTop = y; });
    expect(alignEpubFragment({ manager: { container, scrollTo }, getContents: () => [{ document: doc, window: { frameElement: frame } }] }, "chapter.xhtml#intro")).toBe(true);
    expect(container.scrollTop).toBe(574);
  });
  it("waits for images above the heading and cancels on a newer input identity", async () => {
    const { doc } = fixture();
    const image = doc.createElement("img");
    doc.body.prepend(image);
    Object.defineProperty(image, "complete", { value: false });
    const owner = new ReaderNavigationOwner();
    owner.beginToc();
    let complete = false;
    const wait = waitForEpubAnchorLayout({ getContents: () => [{ document: doc }] }, "chapter.xhtml#intro", owner.signal).then(() => { complete = true; });
    await Promise.resolve();
    expect(complete).toBe(false);
    owner.userScroll();
    await wait;
    expect(complete).toBe(true);
  });

  it("settles image readiness on load, without a fixed timeout", async () => {
    const { doc } = fixture();
    const image = doc.createElement("img"); doc.body.prepend(image);
    Object.defineProperty(image, "complete", { value: false });
    const controller = new AbortController();
    const wait = waitForEpubAnchorLayout({ getContents: () => [{ document: doc }] }, "chapter.xhtml#intro", controller.signal);
    await Promise.resolve();
    image.dispatchEvent(new Event("load"));
    await wait;
  });

});

describe("EPUB queued and in-flight work", () => {
  function runtime(owner: ReaderNavigationOwner) {
    let chain = Promise.resolve();
    const manager = { scrollTo: vi.fn(), scrollBy: vi.fn() };
    const rendition = {
      manager, display: vi.fn(),
      q: { enqueue: (fn: () => Promise<void>) => { chain = chain.then(fn); return chain; } },
      _display: vi.fn(async (_target: string) => { manager.scrollTo(); }),
    };
    const writes = { ...manager };
    guardEpubDisplay(rendition, owner);
    return { ...rendition, writes };
  }
  it("drops old queued displays before loading their chapters", async () => {
    const owner = new ReaderNavigationOwner();
    const rendition = runtime(owner);
    owner.beginToc();
    const first = rendition.display("old");
    owner.beginToc();
    const second = rendition.display("latest");
    await Promise.all([first, second]);
    expect(rendition._display).toHaveBeenCalledExactlyOnceWith("latest");
  });
  it("suppresses scroll writes from a delayed display after manual input", async () => {
    const owner = new ReaderNavigationOwner();
    const rendition = runtime(owner);
    let finish!: () => void;
    const wait = new Promise<void>((resolve) => { finish = resolve; });
    rendition._display.mockImplementationOnce(async () => { await wait; rendition.manager.scrollTo(); rendition.manager.scrollBy(); });
    owner.beginToc();
    const displayed = rendition.display("old");
    await Promise.resolve();
    owner.userScroll();
    finish();
    await displayed;
    expect(rendition.writes.scrollTo).not.toHaveBeenCalled();
    expect(rendition.writes.scrollBy).not.toHaveBeenCalled();
  });
});

describe("EPUB resize ownership", () => {
  it("uses live CFI and defers geometry changes during a TOC request", () => {
    const owner = new ReaderNavigationOwner();
    owner.settle(owner.ticket);
    const resize = vi.fn();
    const rendition = { manager: { container: {}, resize }, currentLocation: () => ({ start: { cfi: "live" } }), location: { start: { cfi: "stale" } } };
    const guard = guardEpubResize(rendition, owner, () => true);
    rendition.manager.resize(500, 600);
    expect(resize).toHaveBeenLastCalledWith(500, 600, "live");
    owner.beginToc();
    rendition.manager.resize(700, 800);
    expect(resize).toHaveBeenCalledTimes(1);
    expect(guard.flush("heading-cfi")).toBe(true);
    expect(resize).toHaveBeenLastCalledWith(700, 800, "heading-cfi");
    expect(guard.flush("heading-cfi")).toBe(false);
    guard.cleanup();
    expect(rendition.manager.resize).toBe(resize);
  });
  it("can attach before initial layout without reading an unmounted manager", () => {
    const owner = new ReaderNavigationOwner();
    const resize = vi.fn();
    const currentLocation = vi.fn(() => { throw new Error("not attached"); });
    const rendition = { manager: { resize }, currentLocation };
    guardEpubResize(rendition, owner, () => false);
    rendition.manager.resize(500, 600);
    expect(currentLocation).not.toHaveBeenCalled();
    expect(resize).toHaveBeenCalledWith(500, 600, undefined);
  });
  it("a newer TOC supersedes a queued paginated gesture", async () => {
    const owner = new ReaderNavigationOwner();
    let chain = Promise.resolve();
    const manager = { next: vi.fn(async () => {}), prev: vi.fn(async () => {}), scrollTo: vi.fn() };
    const rendition = { manager, next: vi.fn(), prev: vi.fn(), display: vi.fn(), reportLocation: vi.fn(), _display: vi.fn(async () => {}), q: { enqueue: (fn: () => Promise<void>) => { chain = chain.then(fn); return chain; } } };
    guardEpubDisplay(rendition, owner);
    const next = rendition.next();
    owner.beginToc();
    const display = rendition.display("latest");
    await Promise.all([next, display]);
    expect(manager.next).not.toHaveBeenCalled();
    expect(rendition._display).toHaveBeenCalledExactlyOnceWith("latest");
    await rendition.prev();
    expect(manager.prev).toHaveBeenCalledTimes(1);
  });
});
