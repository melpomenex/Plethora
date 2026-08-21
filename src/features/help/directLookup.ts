/**
 * Direct Canonical Documentation Lookup Resolver
 * Returns instant structured summaries, step-by-step how-to, why rationale, and interactive action buttons.
 */

import type { DirectLookupResult, ProductDocArticle } from "./helpTypes";
import { defaultHelpRetrieval } from "./helpRetrieval";

export function getDirectLookupResult(query: string): DirectLookupResult | null {
  return defaultHelpRetrieval.resolveDirectLookup(query);
}

export function getFullDocArticle(docId: string): ProductDocArticle | undefined {
  return defaultHelpRetrieval.getDocument(docId);
}
