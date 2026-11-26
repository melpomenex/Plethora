/**
 * Learner-evidence → study-plan gap recommendations (change:
 * integrate-language-learning-with-study-plans, task 2.2).
 *
 * Pure, deterministic derivation of activity recommendations from learner
 * evidence: lexicon coverage (profile vocabulary vs. node objectives),
 * practice recency (accepted attempts in the last 14 days), and flashcard
 * volume (language-linked learning items). The derivation returns structured
 * recommendations with i18n keys and a severity score; the UI layer fetches
 * the evidence and renders the result. No network/store touches here.
 */

export type GapRecommendationType = "coverage" | "practice" | "flashcard";

export interface GapLexiconRow {
  canonicalForm: string;
  normalizedForm: string;
  state: string;
  passiveEvidenceCount: number;
  activeEvidenceCount: number;
}

export interface GapPracticeEvidence {
  /** Accepted practice attempts in the last 14 days. */
  acceptedAttempts14d: number;
  /** Accepted attempts per mode (mode → count). */
  acceptedByMode: Readonly<Record<string, number>>;
}

export interface GapFlashcardEvidence {
  /** Learning items linked to the language profile. */
  itemCount: number;
}

export interface GapEvidenceNodeInput {
  nodeId: string;
  title: string;
  objectives: readonly string[];
  included: boolean;
  activity: string;
  sourceRefCount: number;
  materialSupport: string;
}

export interface GapRecommendation {
  id: string;
  nodeId: string;
  type: GapRecommendationType;
  /** 0..1; higher = bigger gap. */
  severity: number;
  titleKey: string;
  detailKey: string;
  /** Optional numeric detail rendered with the localized string. */
  count?: number;
}

/** Coverage ratio below this suggests expanding vocabulary around the goal. */
export const COVERAGE_THRESHOLD = 0.5;
/** Accepted practice attempts in 14 days below this suggest a practice refresh. */
export const PRACTICE_MIN_ACCEPTED_14D = 3;
/** Language-linked flashcard volume below this suggests mining. */
export const FLASHCARD_MIN_ITEMS = 25;
/** Recommendation list cap. */
export const GAP_RECOMMENDATION_CAP = 5;

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "for", "and", "or", "with", "on",
  "at", "by", "from", "as", "is", "are", "was", "were", "be", "this",
  "that", "these", "those", "it", "its", "your", "you", "we", "they",
  "he", "she", "el", "la", "los", "las", "de", "del", "en", "y", "o",
  "a", "un", "una", "le", "les", "des", "du", "et", "ou", "de", "d",
  "の", "を", "に", "は", "が", "と", "で", "の", "的", "了", "在", "是",
]);

export function textTokens(text: string): string[] {
  const matches = text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(matches.filter((token) => !STOPWORDS.has(token)))];
}

export function lexiconTokenCoverage(lexicon: readonly GapLexiconRow[], text: string): number {
  const tokens = textTokens(text);
  if (tokens.length === 0) return 1;
  const forms = new Set<string>();
  for (const row of lexicon) {
    if (row.canonicalForm) forms.add(row.canonicalForm.toLocaleLowerCase());
    if (row.normalizedForm) forms.add(row.normalizedForm.toLocaleLowerCase());
  }
  const hit = tokens.filter((token) => forms.has(token)).length;
  return hit / tokens.length;
}

function recommendationId(nodeId: string, type: GapRecommendationType): string {
  return `${nodeId}:${type}`;
}

export function inferGapRecommendations(input: {
  nodes: readonly GapEvidenceNodeInput[];
  lexicon: readonly GapLexiconRow[];
  practice: GapPracticeEvidence;
  flashcard: GapFlashcardEvidence;
}): GapRecommendation[] {
  const recommendations: GapRecommendation[] = [];

  for (const node of input.nodes) {
    if (!node.included) continue;
    const nodeText = [node.title, ...node.objectives].join(" ");

    // 1. Vocabulary coverage gap around this node's terms.
    const coverage = lexiconTokenCoverage(input.lexicon, nodeText);
    const hasMaterial = node.sourceRefCount > 0 || node.materialSupport === "grounded";
    if (coverage < COVERAGE_THRESHOLD && hasMaterial) {
      recommendations.push({
        id: recommendationId(node.nodeId, "coverage"),
        nodeId: node.nodeId,
        type: "coverage",
        severity: Math.round((1 - coverage) * 100) / 100,
        titleKey: "studyPlans.gaps.coverage.title",
        detailKey: "studyPlans.gaps.coverage.detail",
      });
    }

    // 2. Practice recency gap (only while the node is still being worked).
    if (node.activity !== "completed" && node.activity !== "skipped") {
      const accepted = input.practice.acceptedAttempts14d;
      if (accepted < PRACTICE_MIN_ACCEPTED_14D) {
        recommendations.push({
          id: recommendationId(node.nodeId, "practice"),
          nodeId: node.nodeId,
          type: "practice",
          severity: accepted === 0 ? 0.9 : 0.6,
          titleKey: "studyPlans.gaps.practice.title",
          detailKey: "studyPlans.gaps.practice.detail",
          count: accepted,
        });
      }
    }

    // 3. Flashcard mining gap.
    if (input.flashcard.itemCount < FLASHCARD_MIN_ITEMS) {
      recommendations.push({
        id: recommendationId(node.nodeId, "flashcard"),
        nodeId: node.nodeId,
        type: "flashcard",
        severity: input.flashcard.itemCount < 10 ? 0.7 : 0.4,
        titleKey: "studyPlans.gaps.flashcard.title",
        detailKey: "studyPlans.gaps.flashcard.detail",
        count: input.flashcard.itemCount,
      });
    }
  }

  return recommendations
    .sort((left, right) => right.severity - left.severity)
    .slice(0, GAP_RECOMMENDATION_CAP);
}
