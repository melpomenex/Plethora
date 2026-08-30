/**
 * Deterministic text normalization for fuzzy ebook ↔ transcript matching.
 * Uses the same folding contract as DOM highlight indexing (`foldForMatch`).
 */

import { foldForMatch } from "../../utils/readerSpeechIndex";

export function normalizeUnicode(text: string): string {
  return text.normalize("NFC");
}

/** Alias for the shared reader/aligner matching contract. */
export function foldForAlignment(text: string): string {
  return foldForMatch(text);
}

/** Strip HTML to plain text while preserving word boundaries. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<\/div>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export interface TextToken {
  text: string;
  norm: string;
  charStart: number;
  charEnd: number;
}

const TOKEN_RE = /[\p{L}\p{N}]+(?:[''][\p{L}\p{N}]+)*'?/gu;

/** Tokenize plain text with char offsets into the original string. */
export function tokenizePlainText(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  const re = new RegExp(TOKEN_RE.source, "gu");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    tokens.push({
      text: raw,
      norm: foldForAlignment(raw),
      charStart: match.index,
      charEnd: match.index + raw.length,
    });
  }
  return tokens;
}

export function fingerprintText(text: string): string {
  let h = 5381;
  const folded = foldForAlignment(text);
  for (let i = 0; i < folded.length; i++) {
    h = ((h << 5) + h) ^ folded.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}
