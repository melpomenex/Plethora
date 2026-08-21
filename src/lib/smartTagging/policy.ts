/**
 * Policy and confidence gating (TypeScript baseline)
 */

import type { SmartTagDetail } from "../../types/document";
import type { CandidateTag } from "./candidateRetrieval";
import type { DomainMatch } from "./domainSignatures";
import { canonicalizeTag, normalizeForComparison } from "./normalization";
import type { ScoredTerm } from "./salience";

export const DEFAULT_CONFIDENCE_THRESHOLD = 0.70;
export const DEFAULT_MAX_TAGS = 6;
export const MIN_TAG_CAP = 3;
export const MAX_TAG_CAP = 8;

export interface PolicyConfig {
  minConfidence?: number;
  maxTags?: number;
  preferExisting?: boolean;
}

export function evaluateAndFilterTags(
  title: string,
  domainMatches: DomainMatch[],
  candidateExisting: CandidateTag[],
  salientTerms: ScoredTerm[],
  existingLibraryTags: string[],
  manualTags: string[] = [],
  dismissedTags: string[] = [],
  config: PolicyConfig = {}
): SmartTagDetail[] {
  const minConfidence = config.minConfidence ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const maxTags = Math.min(MAX_TAG_CAP, Math.max(MIN_TAG_CAP, config.maxTags ?? DEFAULT_MAX_TAGS));
  const now = new Date().toISOString();

  const dismissedNorms = new Set(dismissedTags.map(normalizeForComparison));
  const manualNorms = new Set(manualTags.map(normalizeForComparison));
  const proposedDetails: SmartTagDetail[] = [];
  const seenCanonical = new Set<string>();

  // 1. Domain Matches
  for (const dm of domainMatches) {
    if (dm.confidence >= minConfidence) {
      const canonical = canonicalizeTag(dm.domainName, existingLibraryTags);
      const norm = normalizeForComparison(canonical);

      if (!dismissedNorms.has(norm) && !manualNorms.has(norm) && !seenCanonical.has(norm)) {
        seenCanonical.add(norm);
        proposedDetails.push({
          tag: canonical,
          provenance: "smart-local",
          confidence: dm.confidence,
          reason: dm.reason,
          assignedAt: now,
        });
      }
    }
  }

  // 2. Candidate Existing Tags
  for (const ct of candidateExisting) {
    const confidence = ct.score >= 2.0
      ? Math.min(0.98, Math.max(0.70, 0.70 + (ct.score - 2.0) * 0.04))
      : Math.min(0.69, Math.max(0.0, ct.score / 3.0));

    if (confidence >= minConfidence) {
      const canonical = ct.tag;
      const norm = normalizeForComparison(canonical);

      if (!dismissedNorms.has(norm) && !manualNorms.has(norm) && !seenCanonical.has(norm)) {
        seenCanonical.add(norm);
        let reason = `Taxonomy alignment with existing library tag '${ct.tag}'`;
        if (ct.matchType === "title-exact") {
          reason = `Exact match with document title and existing library tag '${ct.tag}'`;
        } else if (ct.matchType === "title-contains") {
          reason = `Strong lexical match in document title for existing tag '${ct.tag}'`;
        } else if (ct.matchType === "heading-contains") {
          reason = `Matches section headings for existing library tag '${ct.tag}'`;
        } else if (ct.matchType === "salient-term") {
          reason = `High TF-IDF term density aligned with existing tag '${ct.tag}'`;
        }

        proposedDetails.push({
          tag: canonical,
          provenance: "smart-local",
          confidence,
          reason,
          assignedAt: now,
        });
      }
    }
  }

  // 3. High-Salience Keyphrases
  for (const st of salientTerms) {
    if (proposedDetails.length >= maxTags) break;

    if (st.isPhrase && st.score >= 3.0 && st.frequency >= 2) {
      const canonical = canonicalizeTag(st.term, existingLibraryTags);
      const norm = normalizeForComparison(canonical);

      if (!dismissedNorms.has(norm) && !manualNorms.has(norm) && !seenCanonical.has(norm)) {
        const confidence = Math.min(0.92, Math.max(0.70, 0.70 + (st.score - 3.0) * 0.04));
        if (confidence >= minConfidence) {
          seenCanonical.add(norm);
          proposedDetails.push({
            tag: canonical,
            provenance: "smart-local",
            confidence,
            reason: `Prominent multi-word keyphrase (frequency ${st.frequency}, TF-IDF score ${st.score.toFixed(1)})`,
            assignedAt: now,
          });
        }
      }
    }
  }

  proposedDetails.sort((a, b) => b.confidence - a.confidence);
  return proposedDetails.slice(0, maxTags);
}
