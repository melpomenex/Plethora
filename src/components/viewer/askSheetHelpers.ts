/**
 * Helpers for the mobile AskSheet reader integration
 * (OpenSpec `mobile-ask-sheet-library-qa`, task 4.2).
 */

/**
 * Visible-section text for the no-selection "Ask about this page" entry:
 * walks the scroll container's text nodes and keeps those intersecting the
 * viewport, in document order. Capped so the context chip stays manageable.
 * Reads rendered text, so it works across PDF/EPUB/Markdown/HTML surfaces.
 */
export function getVisibleSectionText(
  container: HTMLElement | null = typeof document !== "undefined"
    ? (document.querySelector("[data-document-scroll-container]") as HTMLElement | null)
    : null,
  maxChars = 3000,
): string {
  if (!container) return "";
  const viewport = container.getBoundingClientRect();
  const chunks: string[] = [];
  let length = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    const text = node.textContent?.replace(/\s+/g, " ").trim();
    if (text) {
      const rect = node.parentElement?.getBoundingClientRect();
      if (rect && rect.bottom > viewport.top && rect.top < viewport.bottom && rect.width > 0) {
        chunks.push(text);
        length += text.length + 1;
        if (length >= maxChars) break;
      }
    }
    node = walker.nextNode() as Text | null;
  }
  return chunks.join(" ").slice(0, maxChars);
}
