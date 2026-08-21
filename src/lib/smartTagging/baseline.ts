/**
 * Tier 1 Baseline Smart Tagging Engine (TypeScript / Web / PWA / Fallback)
 */

import type { SmartTagDetail } from "../../types/document";
import { rankCandidateTags } from "./candidateRetrieval";
import { matchDomainSignatures } from "./domainSignatures";
import { evaluateAndFilterTags, type PolicyConfig } from "./policy";
import { extractSalientTerms, type DocumentContentParts } from "./salience";

export interface ClassifyDocumentBaselineOptions {
  title: string;
  headings?: string[];
  body: string;
  existingLibraryTags?: Array<{ name: string; itemCount?: number }>;
  manualTags?: string[];
  dismissedTags?: string[];
  config?: PolicyConfig;
}

/**
 * Classify a document using the Tier 1 statistical baseline engine.
 *
 * Runs completely locally without an LLM.
 */
export function classifyDocumentBaseline(
  options: ClassifyDocumentBaselineOptions
): SmartTagDetail[] {
  const {
    title,
    headings = [],
    body,
    existingLibraryTags = [],
    manualTags = [],
    dismissedTags = [],
    config = {},
  } = options;

  // 1. Extract salient terms with positional weights (Title 5x, Headings 3x, Body 1x)
  const parts: DocumentContentParts = {
    title,
    headings,
    body,
  };
  const salientTerms = extractSalientTerms(parts, 30);

  // 2. Composite multi-term domain signature matching
  const domainMatches = matchDomainSignatures(title, headings, salientTerms);

  // 3. Candidate existing tag retrieval
  const candidateTags = rankCandidateTags(
    existingLibraryTags,
    title,
    headings,
    salientTerms,
    30
  );

  const existingNames = existingLibraryTags.map((t) => t.name);

  // 4. Policy evaluation, duplicate prevention, and confidence filtering
  return evaluateAndFilterTags(
    title,
    domainMatches,
    candidateTags,
    salientTerms,
    existingNames,
    manualTags,
    dismissedTags,
    config
  );
}
