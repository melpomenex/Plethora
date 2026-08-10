/**
 * Full-book EPUB quote search helpers.
 *
 * The bundled epubjs has no `Book.search` (only per-section exact
 * `Section.search`), so a Document Q&A citation jump needs its own tolerant
 * full-book search. The helpers here match a citation quote against a loaded
 * epubjs section's DOM, tolerating the differences between indexed chunk text
 * (whitespace-collapsed, straight punctuation) and the real book content
 * (typographic quotes/dashes, inline element boundaries that both split text
 * nodes and drop whitespace — e.g. `<a id="page_7"/>` page anchors inside
 * paragraphs).
 */

function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a phrase regex that matches the quote against book text: whitespace
 * runs are OPTIONAL (`\s*`) because inline element boundaries often remove the
 * whitespace that the indexed text had, and apostrophes/quotes/dashes match
 * any typographic variant — we do not know which style the book uses, so any
 * quote character matches any other. (Markers prevent a later replace from
 * re-processing a class inserted by an earlier one.)
 */
export function tolerantPhraseRegex(query: string): RegExp {
  const anyQuote = "['’‘\"“”]";
  let escaped = escapeRegex(query.trim())
    .replace(/\s+/g, "\\s*")
    .replace(/'/g, "\uE000")
    .replace(/"/g, "\uE001")
    .replace(/-/g, "[\\-–—]");
  escaped = escaped.replace(/\uE000/g, anyQuote).replace(/\uE001/g, anyQuote);
  return new RegExp(escaped, "gi");
}

interface TextSpan {
  node: Text;
  /** Start offset of this node's text within the section's flattened text. */
  start: number;
  /** End offset (exclusive). */
  end: number;
}

/**
 * Collect CFIs for every match of `regex` within a (loaded) epubjs section.
 *
 * Matches run against the section's flattened text so a phrase spanning
 * several text nodes (split by inline elements) still matches; each match is
 * then mapped back to a Range across the nodes it covers and turned into a CFI
 * via `section.cfiFromRange`.
 */
export function collectSectionCfiMatches(section: any, regex: RegExp): string[] {
  const cfis: string[] = [];
  const doc = section?.document as globalThis.Document | undefined;
  const body = doc?.body;
  if (!body || typeof section.cfiFromRange !== "function") return cfis;

  // Flatten the section text, remembering which node each character came from.
  const spans: TextSpan[] = [];
  let buffer = "";
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const value = node.nodeValue ?? "";
    if (!value) continue;
    spans.push({ node, start: buffer.length, end: buffer.length + value.length });
    buffer += value;
  }
  if (!buffer.trim()) return cfis;

  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(buffer)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex += 1;
      continue;
    }
    const matchStart = match.index;
    const matchEnd = match.index + match[0].length;
    try {
      // Locate the first and last text nodes covered by the match.
      let firstIndex = -1;
      for (let i = 0; i < spans.length; i++) {
        if (spans[i].end > matchStart) {
          firstIndex = i;
          break;
        }
      }
      if (firstIndex === -1) continue;
      let lastIndex = firstIndex;
      while (lastIndex + 1 < spans.length && spans[lastIndex + 1].start < matchEnd) {
        lastIndex += 1;
      }
      const firstSpan = spans[firstIndex];
      const lastSpan = spans[lastIndex];

      const range = doc.createRange();
      range.setStart(firstSpan.node, matchStart - firstSpan.start);
      range.setEnd(lastSpan.node, matchEnd - lastSpan.start);
      const cfi = section.cfiFromRange(range);
      range.detach?.();
      if (cfi && !cfis.includes(String(cfi))) cfis.push(String(cfi));
    } catch {
      // ignore individual range failures
    }
  }
  return cfis;
}
