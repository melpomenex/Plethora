/**
 * Normalize simplified cloze deletions like {{word}} or {{::word}} to {{cN::word}}.
 * Also leaves standard {{cN::word}} syntax intact.
 */
export function normalizeClozeSyntax(text: string): string {
  if (!text) return text;
  let index = 1;
  return text.replace(/\{\{([^{}]+)\}\}/g, (match, inner) => {
    if (/^c\d+::/.test(inner)) {
      return match;
    }
    const cleanInner = inner.startsWith("::") ? inner.slice(2) : inner;
    const result = `{{c${index}::${cleanInner}}}`;
    index += 1;
    return result;
  });
}

/**
 * Parse {{cN::text}} and {{cN::text::hint}} cloze deletions from raw text.
 * Returns array of { start, end, content, hint?, number } for each deletion.
 * Used as a fallback when cloze_ranges are not pre-calculated (e.g. AI-generated cloze cards).
 */
export function parseClozeDeletions(text: string): Array<{
  start: number;
  end: number;
  content: string;
  hint?: string;
  number: number;
}> {
  const normalized = normalizeClozeSyntax(text);
  const results: Array<{ start: number; end: number; content: string; hint?: string; number: number }> = [];
  // Match {{c<number>::content}} or {{c<number>::content::hint}}
  const pattern = /\{\{c(\d+)::(.+?)(?:::(.+?))?\}\}/g;
  let match;
  while ((match = pattern.exec(normalized)) !== null) {
    results.push({
      start: match.index,
      end: match.index + match[0].length,
      content: match[2],
      hint: match[3],
      number: parseInt(match[1], 10),
    });
  }
  return results;
}

/**
 * Check if text contains raw {{cN::...}} cloze deletion syntax.
 */
export function hasRawClozeSyntax(text: string): boolean {
  return /\{\{c\d+::/.test(text) || /\{\{(?!c\d+::)[^{}]+\}\}/.test(text);
}

/**
 * Strip cloze markers and return plain text with just the content revealed.
 */
export function stripClozeMarkers(text: string): string {
  const normalized = normalizeClozeSyntax(text);
  return normalized.replace(/\{\{c\d+::(.+?)(?:::(.+?))?\}\}/g, "$1");
}
