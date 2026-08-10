/**
 * Full-book EPUB quote search helpers.
 *
 * The bundled epubjs has no `Book.search` (only per-section exact
 * `Section.search`), so a Document Q&A citation jump needs its own tolerant
 * full-book search. The helpers here match a citation quote against a loaded
 * epubjs section's DOM, tolerating the differences between indexed chunk text
 * (whitespace-collapsed, straight punctuation) and the real book content
 * (flexible whitespace, typographic quotes/dashes).
 */

function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a phrase regex that matches the quote against book text: whitespace
 * runs match any run of whitespace, and straight apostrophes/quotes/dashes
 * also match their typographic (curly) equivalents.
 */
export function tolerantPhraseRegex(query: string): RegExp {
  // escapeRegex does not touch apostrophes/quotes/dashes, so swap the literal
  // characters for markers first, then for character classes that accept any
  // typographic variant — we do not know which quote style the book uses, so
  // any quote character matches any other. (Markers prevent a later replace
  // from re-processing a class inserted by an earlier one.)
  const anyQuote = "['’‘\"“”]";
  let escaped = escapeRegex(query.trim()).replace(/\s+/g, "\\s+");
  escaped = escaped
    .replace(/'/g, "\uE000")
    .replace(/"/g, "\uE001")
    .replace(/-/g, "[\\-–—]");
  escaped = escaped.replace(/\uE000/g, anyQuote).replace(/\uE001/g, anyQuote);
  return new RegExp(escaped, "gi");
}

/**
 * Collect CFIs for every match of `regex` within a (loaded) epubjs section,
 * using the section's own DOM so each CFI maps back to a real location.
 */
export function collectSectionCfiMatches(section: any, regex: RegExp): string[] {
  const cfis: string[] = [];
  const doc = section?.document as globalThis.Document | undefined;
  const body = doc?.body;
  if (!body) return cfis;
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const value = node.nodeValue ?? "";
    if (!value.trim()) continue;
    let match: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((match = regex.exec(value)) !== null) {
      try {
        const range = doc.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const cfi = section.cfiFromRange?.(range);
        range.detach?.();
        if (cfi && !cfis.includes(String(cfi))) cfis.push(String(cfi));
      } catch {
        // ignore individual range failures
      }
      if (match[0].length === 0) {
        regex.lastIndex += 1;
      }
    }
  }
  return cfis;
}
