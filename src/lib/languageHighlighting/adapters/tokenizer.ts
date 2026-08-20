export interface LexicalTextToken {
  text: string;
  start: number;
  end: number;
}

// Source offsets remain UTF-16 offsets so they can be used directly with DOM Range APIs.
const LEXICAL_TOKEN_PATTERN = /[\p{L}\p{M}\p{N}]+(?:[’'][\p{L}\p{M}\p{N}]+)*(?:[-‐‑–][\p{L}\p{M}\p{N}]+)*/gu;

export function tokenizeLanguageText(text: string): LexicalTextToken[] {
  const tokens: LexicalTextToken[] = [];
  for (const match of text.matchAll(LEXICAL_TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    tokens.push({ text: match[0], start, end: start + match[0].length });
  }
  return tokens;
}

export function anchorConfidence(score: number): "exact" | "high" | "medium" | "low" | "unsupported" {
  if (!Number.isFinite(score) || score <= 0) return "unsupported";
  if (score >= 0.99) return "exact";
  if (score >= 0.9) return "high";
  if (score >= 0.75) return "medium";
  return "low";
}
