/**
 * Defuddle engine adapter (design D2).
 *
 * Wraps the lazily-loaded `defuddle` library into a normalized
 * ExtractionCandidate. Defuddle mutates the document it parses, so the caller
 * must hand it a document it owns exclusively (the pipeline passes an
 * independent deep clone). `useAsync: false` keeps the engine hermetic — its
 * async extractors would otherwise hit third-party APIs.
 */

import { loadDefuddle } from '../engineLoader';
import { computeStats, normalizeWhitespace, parseFragment } from '../domUtils';
import type { ExtractionCandidate } from '../types';

export async function runDefuddle(
  doc: Document,
  url: string
): Promise<ExtractionCandidate | null> {
  let DefuddleCtor: typeof import('defuddle').default;
  try {
    const mod = await loadDefuddle();
    DefuddleCtor = mod.default;
  } catch {
    // Engine library failed to load — that's "no candidate", not an abort.
    return null;
  }

  let result: import('defuddle').DefuddleResponse;
  try {
    const engine = new DefuddleCtor(doc, {
      url,
      useAsync: false,
      removeImages: false,
      // Publisher markup hygiene is our sanitizer's job; leave the content as
      // extracted so scoring sees what the engine actually produced.
      markdown: false,
    });
    result = engine.parse();
  } catch {
    return null;
  }

  const contentHtml = result.content?.trim();
  if (!contentHtml) return null;

  const container = parseFragment(contentHtml);
  const textContent = normalizeWhitespace(container.textContent ?? '');

  return {
    engine: 'defuddle',
    contentHtml,
    title: result.title?.trim() || undefined,
    byline: result.author?.trim() || undefined,
    publishedTime: result.published?.trim() || undefined,
    textContent,
    stats: computeStats(container),
  };
}
