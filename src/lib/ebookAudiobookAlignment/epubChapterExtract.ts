import { htmlToPlainText } from "./normalize";

/**
 * Build ebook chapter inputs from EPUB speech sections emitted by EPUBViewer.
 */
export function speechSectionsToChapters(
  sections: Array<{ spineIndex: number; href: string; text: string }>,
  toc: Array<{ href: string; label: string }>,
): Array<{ href: string; label: string; plainText: string }> {
  const labelByHref = new Map(toc.map((t) => [normalizeHref(t.href), t.label]));
  return sections.map((s) => ({
    href: s.href,
    label: labelByHref.get(normalizeHref(s.href)) ?? `Section ${s.spineIndex + 1}`,
    plainText: htmlToPlainText(s.text),
  }));
}

function normalizeHref(href: string): string {
  return href.replace(/^\.?\//, "").split("#")[0];
}

export function simpleContentHash(id: string, filePath?: string): string {
  let h = 5381;
  const src = `${id}:${filePath ?? ""}`;
  for (let i = 0; i < src.length; i++) {
    h = ((h << 5) + h) ^ src.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}
