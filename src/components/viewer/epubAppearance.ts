/** Source styling snapshots are per content Document and disappear with its lifetime. */
const originals = new WeakMap<
  Document,
  { sheets: Element[]; inline: Map<HTMLElement, string | null> }
>();
export function preserveEpubPublisherStyles(doc: Document): void {
  if (originals.has(doc)) return;
  originals.set(doc, {
    sheets: Array.from(
      doc.querySelectorAll(
        'link[rel="stylesheet"],style:not(#epub-override-styles):not([id^="epubjs-inserted-css-"])'
      )
    ).map((n) => n.cloneNode(true) as Element),
    inline: new Map(
      Array.from(doc.querySelectorAll<HTMLElement>("html,body,[style]")).map((n) => [
        n,
        n.getAttribute("style"),
      ])
    ),
  });
}
export function restoreEpubPublisherStyles(doc: Document): void {
  doc.getElementById("epub-override-styles")?.remove();
  const original = originals.get(doc);
  if (!original || doc.documentElement.dataset.epubPublisherRestored === "true") return;
  original.inline.forEach((value, node) =>
    value === null ? node.removeAttribute("style") : node.setAttribute("style", value)
  );
  doc
    .querySelectorAll('link[rel="stylesheet"],style:not([id^="epubjs-inserted-css-"])')
    .forEach((n) => n.remove());
  original.sheets.forEach((n) => doc.head.appendChild(n.cloneNode(true)));
  doc.documentElement.dataset.epubPublisherRestored = "true";
}
export function epubUsesPublisherAppearance(
  contents: any,
  book: any,
  preference: string = "app",
  cover = false
): boolean {
  if (preference === "publisher" || cover) return true;
  const section = contents?.section;
  const properties = section?.properties ?? [];
  if (properties.includes("rendition:layout-pre-paginated")) return true;
  if (properties.includes("rendition:layout-reflowable")) return false;
  const layout = section?.rendition?.layout ?? book?.packaging?.metadata?.layout;
  // EPUB's absent rendition:layout defaults to reflowable; malformed explicit values do not.
  return typeof layout === "string" && layout.trim() !== "" && layout !== "reflowable";
}
export function setEpubDefaultStyleEnabled(doc: Document, enabled: boolean): void {
  doc.querySelectorAll<HTMLStyleElement>("style#epubjs-inserted-css-default").forEach((n) => {
    if (n.sheet) n.sheet.disabled = !enabled;
  });
}
