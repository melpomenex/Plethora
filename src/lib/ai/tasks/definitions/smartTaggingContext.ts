/**
 * Context builder for Smart Tagging Task.
 *
 * Assembles a compact, representative document summary bounded to <= 3,000 tokens
 * so long documents (500-page PDFs/EPUBs) never overflow context budgets or incur
 * unnecessary inference costs.
 */

import { extractSalientTerms } from "../../../smartTagging/salience";

export interface SmartTaggingContextInput {
  title: string;
  author?: string;
  category?: string;
  fileType?: string;
  headings?: string[];
  content?: string;
  candidateExistingTags?: string[];
  maxTokens?: number;
}

export interface AssembledSmartTaggingContext {
  title: string;
  author?: string;
  headings: string[];
  introExcerpt: string;
  conclusionExcerpt: string;
  topKeywords: string[];
  candidateExistingTags: string[];
}

export function buildSmartTaggingContext(
  input: SmartTaggingContextInput
): AssembledSmartTaggingContext {
  const content = input.content || "";
  const headings = (input.headings || []).slice(0, 20);

  // 1. Introduction excerpt (first 1,500 characters)
  let introExcerpt = "";
  if (content.length > 0) {
    introExcerpt = content.slice(0, 1500).trim();
  }

  // 2. Conclusion excerpt (last 1,000 characters) if content is long
  let conclusionExcerpt = "";
  if (content.length > 2500) {
    conclusionExcerpt = content.slice(-1000).trim();
  }

  // 3. Top statistical keywords from Tier 1 pass
  const salient = extractSalientTerms(
    {
      title: input.title,
      headings,
      body: content.slice(0, 8000),
    },
    20
  );
  const topKeywords = salient.map((s) => s.term);

  // 4. Candidate existing tags (bounded to 30)
  const candidateExistingTags = (input.candidateExistingTags || []).slice(0, 30);

  return {
    title: input.title,
    author: input.author,
    headings,
    introExcerpt,
    conclusionExcerpt,
    topKeywords,
    candidateExistingTags,
  };
}
