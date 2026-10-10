import { hrefMatchesChapter } from "../../utils/epubWordHighlight";
import { ReaderNavigationOwner } from "../../lib/readerNavigation";

/** Keep the fragment in every resolution path; a spine index is not an anchor. */
export async function resolveEpubTocTarget(book: any, href: string): Promise<string> {
  const hash = href.indexOf("#");
  const path = (hash < 0 ? href : href.slice(0, hash)).replace(/^\.?\//, "");
  const fragment = hash < 0 ? "" : href.slice(hash + 1);
  const spine = await book.loaded.spine;
  const items = spine.spineItems ?? spine.items ?? [];
  const section = spine.get(path || href) ?? items.find((item: any) => {
    const itemPath = String(item.href ?? "").replace(/^\.?\//, "");
    return itemPath === path || (path && itemPath.endsWith(`/${path}`));
  });
  if (!section) return href;
  if (!fragment) return section.href;
  await section.load(book.load.bind(book));
  let id = fragment;
  try { id = decodeURIComponent(fragment); } catch { /* literal malformed id */ }
  const target = section.document?.getElementById(id)
    ?? section.document?.getElementsByName(id)?.[0];
  if (!target) throw new Error(`EPUB heading not found: #${fragment}`);
  // A CFI points to the actual DOM node even when an href resolves to a blob URL.
  return section.cfiFromElement(target);
}

/**
 * epub.js display() resolves its previous deferred early. Queue the actual
 * display work instead, and reject obsolete queued work before it touches DOM.
 * Guard manager scroll writes as well: an in-flight section load can finish
 * after a touch or newer TOC request. Native continuous-manager scrolling outside
 * a display remains available (including trimming compensation).
 */
export function guardEpubDisplay(rendition: any, owner: ReaderNavigationOwner): () => void {
  if (!rendition.q?.enqueue || !rendition._display || !rendition.manager) return () => {};
  const originalDisplay = rendition.display;
  const manager = rendition.manager;
  let renderingTicket: number | null = null;
  const restores: Array<() => void> = [];
  for (const method of ["scrollTo", "scrollBy"]) {
    const original = manager[method];
    if (typeof original !== "function") continue;
    manager[method] = function (...args: any[]) {
      if (renderingTicket !== null && !owner.owns(renderingTicket)) return;
      return original.apply(this, args);
    };
    restores.push(() => { manager[method] = original; });
  }
  rendition.display = (target: string) => {
    const ticket = owner.ticket;
    return rendition.q.enqueue(async () => {
      if (!owner.owns(ticket)) return;
      renderingTicket = ticket;
      try { return await rendition._display(target); }
      finally { renderingTicket = null; }
    });
  };
  // Genuine paginated gestures also own their queued work. A later TOC
  // request must invalidate a page turn that is still loading its section.
  for (const method of ["next", "prev"]) {
    if (typeof manager[method] !== "function") continue;
    const original = rendition[method];
    rendition[method] = () => {
      const ticket = owner.beginToc();
      return rendition.q.enqueue(async () => {
        if (!owner.owns(ticket)) return;
        renderingTicket = ticket;
        try {
          await manager[method]();
          if (owner.settle(ticket)) rendition.reportLocation?.();
        } finally { renderingTicket = null; }
      });
    };
    restores.push(() => { rendition[method] = original; });
  }
  return () => {
    owner.userScroll();
    rendition.display = originalDisplay;
    restores.forEach((restore) => restore());
  };
}

/** Window/host resizes preserve a live anchor, never rendition.location's cache. */
export function guardEpubResize(rendition: any, owner: ReaderNavigationOwner, isReady: () => boolean) {
  const manager = rendition.manager;
  const original = manager?.resize;
  let pending: [number | undefined, number | undefined] | null = null;
  if (!original) return { flush: (_cfi: string) => false, cleanup: () => {} };
  manager.resize = function (width?: number, height?: number, cfi?: string) {
    if (owner.state === "toc-navigation") { pending = [width, height]; return; }
    let live = cfi;
    if (!live && manager.container) {
      try { live = rendition.currentLocation?.()?.start?.cfi; } catch { /* unattached */ }
    }
    if (isReady() && !live) return;
    return original.call(this, width, height, live);
  };
  return {
    flush: (cfi: string) => {
      if (!pending) return false;
      const [width, height] = pending;
      pending = null;
      original.call(manager, width, height, cfi);
      return true;
    },
    cleanup: () => { pending = null; manager.resize = original; },
  };
}

/** Verify the DOM heading in the mounted iframe, allowing visible top padding. */
export function alignEpubFragment(rendition: any, href: string, padding = 16): boolean {
  const hash = href.indexOf("#");
  if (hash < 0) return true;
  let id = href.slice(hash + 1);
  try { id = decodeURIComponent(id); } catch { /* use literal */ }
  const manager = rendition.manager;
  // Paginated rendition.display(CFI) handles column geometry itself.
  if (manager?.isPaginated) return true;
  for (const contents of rendition.getContents?.() ?? []) {
    const path = href.slice(0, hash);
    const contentHref = contents.document?.body?.dataset.epubHref || contents.url;
    if (path && contentHref && !hrefMatchesChapter(contentHref, path)) continue;
    const heading = contents.document?.getElementById(id) ?? contents.document?.getElementsByName(id)?.[0];
    const frame = contents.window?.frameElement;
    const container = manager?.container;
    if (!heading || !frame || !container) continue;
    const delta = frame.getBoundingClientRect().top + heading.getBoundingClientRect().top
      - container.getBoundingClientRect().top - padding;
    const top = Math.max(0, Math.min(container.scrollTop + delta, container.scrollHeight - container.clientHeight));
    manager.scrollTo(container.scrollLeft, top, true);
    return Math.abs(container.scrollTop - top) <= 2;
  }
  return false;
}

/** Images above the selected heading must finish layout before arrival is declared. */
export async function waitForEpubAnchorLayout(rendition: any, href: string, signal: AbortSignal): Promise<void> {
  const hash = href.indexOf("#");
  const path = hash < 0 ? href : href.slice(0, hash);
  let id = hash < 0 ? "" : href.slice(hash + 1);
  try { id = decodeURIComponent(id); } catch { /* literal id */ }
  for (const contents of rendition.getContents?.() ?? []) {
    if (signal.aborted) return;
    const doc = contents.document as Document | undefined;
    if (!doc) continue;
    const contentHref = doc.body?.dataset.epubHref || contents.url;
    if (path && contentHref && !hrefMatchesChapter(contentHref, path)) continue;
    const heading = id ? doc.getElementById(id) ?? doc.getElementsByName(id)[0] : null;
    if (id && !heading) continue;
    await doc.fonts?.ready;
    if (signal.aborted) return;
    const headingTop = heading?.getBoundingClientRect().top ?? 0;
    const images = Array.from(doc.images).filter((img) => !img.complete && img.getBoundingClientRect().top <= headingTop);
    await Promise.all(images.map((img) => new Promise<void>((resolve) => {
      const finish = () => {
        img.removeEventListener("load", finish);
        img.removeEventListener("error", finish);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      img.addEventListener("load", finish, { once: true });
      img.addEventListener("error", finish, { once: true });
      signal.addEventListener("abort", finish, { once: true });
      if (img.complete || signal.aborted) finish();
    })));
  }
}
