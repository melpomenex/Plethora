/**
 * Mozilla Readability engine adapter (design D2).
 *
 * Wraps the lazily-loaded `@mozilla/readability` into a normalized
 * ExtractionCandidate. Readability mutates the document it parses, so the
 * caller must hand it an independent deep clone of the source.
 */

import { loadReadability } from '../engineLoader';
import { computeStats, normalizeWhitespace, parseFragment } from '../domUtils';
import type { ExtractionCandidate } from '../types';

export async function runReadability(
  doc: Document
): Promise<ExtractionCandidate | null> {
  let ReadabilityCtor: typeof import('@mozilla/readability').Readability;
  try {
    const mod = await loadReadability();
    ReadabilityCtor = mod.Readability;
  } catch {
    return null;
  }

  let result: {
    content?: string | null;
    title?: string | null;
    textContent?: string | null;
    byline?: string | null;
    publishedTime?: string | null;
  } | null;
  try {
    result = new ReadabilityCtor(doc).parse();
  } catch {
    return null;
  }

  const contentHtml = result?.content?.trim();
  if (!result || !contentHtml) return null;

  const container = parseFragment(contentHtml);
  const ownText = result.textContent?.trim();
  const textContent = normalizeWhitespace(ownText && ownText.length > 0 ? ownText : container.textContent ?? '');

  return {
    engine: 'readability',
    contentHtml,
    title: result.title?.trim() || undefined,
    byline: result.byline?.trim() || undefined,
    publishedTime: result.publishedTime?.trim() || undefined,
    textContent,
    stats: computeStats(container),
  };
}
