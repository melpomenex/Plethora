/**
 * Bounded whole-document intent recognition (`fix-document-mode-grounding`).
 *
 * A "whole-document" request asks about the entire source — summarize,
 * overview, "what is this about". Document scope must serve those from the
 * largest affordable evidence instead of a single retrieval query, so adapters
 * use this matcher to decide whether to load the canonical full text.
 *
 * Deliberately bounded: a fixed pattern list, no stemming, no model calls.
 * Focused targets ("this section", "this paragraph", "this passage", "this
 * video") are NOT whole-document intents; those keep their existing focused
 * paths. Unicode-aware boundaries are used instead of `\b` because `\w`/`\b`
 * are ASCII-only and would reject accented keywords like "überblick".
 */
const L = String.raw`(?<![\p{L}\p{N}_])`;
const R = String.raw`(?![\p{L}\p{N}_])`;

/** Partial targets: an occurrence between the intent verb and the noun means
 * the request is about a part of the source, not the whole document. */
const FOCUSED_TARGETS = [
  "section", "paragraph", "passage", "chapter", "page", "selection", "excerpt", "highlight", "video", "thread",
  "abschnitt", "absatz", "seite", "kapitel", "auswahl", "markierung",
  "secci[oó]n", "p[aá]rrafo", "pasaje", "p[aá]gina", "cap[ií]tulo", "selecci[oó]n",
  "paragraphe", "chapitre", "s[eé]lection",
].join("|");
const FOCUS_GUARD = String.raw`(?:(?!${L}(?:${FOCUSED_TARGETS})${R})[\s\S]){0,40}`;

const WHOLE_DOCUMENT_PATTERNS: RegExp[] = [
  // English
  new RegExp(`${L}(?:summar(?:y|ize|ise)|overview|synopsis|tl;?dr)${R}${FOCUS_GUARD}${L}(?:document|paper|article|book|text|pdf|file|source|reading)${R}`, "iu"),
  new RegExp(`${L}what(?:'s| is)\\s+(?:this|the)\\s+(?:document|paper|article|book|file|reading)\\s+about${R}`, "iu"),
  new RegExp(`${L}what\\s+(?:is|are)\\s+(?:this|the)\\s+(?:document|paper|article|book|file)\\s+(?:saying|about)${R}`, "iu"),
  // German
  new RegExp(`${L}(?:zusammenfassung|fasse|fassen|überblick)${R}${FOCUS_GUARD}${L}(?:dokument|artikel|papier|text|datei|buch)${R}`, "iu"),
  new RegExp(`${L}(?:worum|wovon)\\s+geht\\s+es\\s+(?:in|bei)\\s+(?:diesem|dem)\\s+(?:dokument|artikel|text|buch)${R}`, "iu"),
  // Spanish
  new RegExp(`${L}(?:resumen|resume|resúmeme|síntesis)${R}${FOCUS_GUARD}${L}(?:documento|art[ií]culo|texto|libro|archivo|lectura)${R}`, "iu"),
  new RegExp(`${L}de\\s+qu[eé]\\s+trata\\s+(?:este|el)\\s+(?:documento|art[ií]culo|texto|libro)${R}`, "iu"),
  // French
  new RegExp(`${L}(?:r[eé]sum[eé]|synth[eè]se)${R}${FOCUS_GUARD}${L}(?:document|article|texte|livre|fichier|lecture)${R}`, "iu"),
  new RegExp(`${L}de\\s+quoi\\s+parle\\s+(?:ce|cet)\\s+(?:document|article|texte|livre)${R}`, "iu"),
  // Japanese (document-level nouns only; 節/段落 stay partial)
  /(?:要約|まとめ|概要)[\s\S]{0,20}(?:文書|ドキュメント|記事|本|ファイル)/,
  /(?:この|その)(?:文書|ドキュメント|記事|本|ファイル)(?:を|の)?[\s\S]{0,6}(?:要約|まとめ|概要)/,
  /(?:この|その)(?:文書|ドキュメント|記事|本)(?:は|って)?(?:何|どんな)/,
  // Chinese (document-level nouns only; 章/段 stay partial)
  /(?:总结|總結|摘要|概述|概要|大意)[\s\S]{0,20}(?:文档|文檔|文章|书|書|文件)/,
  /(?:这|那|该)(?:篇|份|本)?(?:文档|文檔|文章|书|書|文件)(?:讲的|講的|说的|說的)?是什么/,
];

export function isWholeDocumentRequest(question: string): boolean {
  const text = question.trim();
  if (!text) return false;
  return WHOLE_DOCUMENT_PATTERNS.some((pattern) => pattern.test(text));
}
