import type { ConceptMasterySummary } from "../../../types/learningEvidence";
import type { StudySourceAnchor } from "../../../types/studyMode";
import { hashScopeSegment } from "./scopeKey";

export type CorePracticeQuestionKind =
  | "multiple_choice"
  | "free_recall"
  | "fill_blank"
  | "ordering"
  | "scenario_error";

export type ExtensiblePracticeQuestionKind =
  | CorePracticeQuestionKind
  | "compare_contrast"
  | "problem_solving"
  | "teach_back";

export interface PracticeQuestionItem {
  id: string;
  backendQuestionId?: string | null;
  scopeKey: string;
  conceptIds: string[];
  questionKind: ExtensiblePracticeQuestionKind;
  prompt: string;
  difficulty: number;
  questionFingerprint: string;
  hint?: string | null;
  options?: string[] | null;
  correctIndex?: number | null;
  expectedBlanks?: string[] | null;
  orderingItems?: string[] | null;
  correctOrder?: string[] | null;
  scenarioText?: string | null;
  errorExplanation?: string | null;
  requiredKeyFacts?: string[] | null;
  explanation: string;
  distractorMisconceptions?: Record<string, string> | null;
  anchors: StudySourceAnchor[];
}

export interface PracticeAnswerPayload {
  selectedIndex?: number | null;
  writtenText?: string | null;
  blankAnswers?: string[] | null;
  orderedItems?: string[] | null;
  usedHint?: boolean;
}

export interface PracticeEvaluationResult {
  questionId: string;
  conceptIds: string[];
  outcome: "understood" | "partial" | "needs_review";
  score: number;
  feedback: string;
  misconceptionDetected: string | null;
  graderOrigin: "deterministic" | "ai";
  difficulty: number;
  usedHint: boolean;
  evaluatedAt: string;
}

export interface PracticeQuestionTypeDescriptor {
  kind: CorePracticeQuestionKind;
  label: string;
  shortLabel: string;
  promptGuidance: string;
}

export const PRACTICE_QUESTION_TYPES: PracticeQuestionTypeDescriptor[] = [
  {
    kind: "multiple_choice",
    label: "Multiple Choice",
    shortLabel: "MCQ",
    promptGuidance: "Diagnostic 4-option multiple choice with misconception-targeted distractors.",
  },
  {
    kind: "free_recall",
    label: "Free Recall",
    shortLabel: "Explain",
    promptGuidance: "Ask the learner to explain the concept in their own words without cues.",
  },
  {
    kind: "fill_blank",
    label: "Fill in the Blank",
    shortLabel: "Cloze",
    promptGuidance: "Sentence with 1-2 key conceptual blanks denoted by ___.",
  },
  {
    kind: "ordering",
    label: "Ordering / Sequencing",
    shortLabel: "Order",
    promptGuidance: "3-5 causal or chronological steps to arrange in the correct sequence.",
  },
  {
    kind: "scenario_error",
    label: "Scenario / Error ID",
    shortLabel: "Debug",
    promptGuidance: "Short scenario containing a subtle conceptual flaw for the learner to identify.",
  },
];

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "do", "does", "for", "from",
  "how", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "what",
  "when", "where", "which", "who", "why", "with", "would", "following", "best",
]);

export function tokenizeForSemantics(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((tok) => tok.trim())
    .filter((tok) => tok.length >= 3 && !STOP_WORDS.has(tok));
}

/**
 * Deterministic semantic fingerprint based on scope, concept, question kind,
 * and normalized content tokens (replaces timestamp Date.now() fingerprints).
 */
export function computeSemanticQuestionFingerprint(input: {
  scopeKey: string;
  conceptIds: string[];
  questionKind: string;
  prompt: string;
}): string {
  const uniqueTokens = Array.from(new Set(tokenizeForSemantics(input.prompt))).sort();
  const conceptPart = [...input.conceptIds]
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(",");
  const canonical = `${input.scopeKey}|${conceptPart}|${input.questionKind}|${uniqueTokens.join(" ")}`;
  return `sem:${hashScopeSegment(canonical)}`;
}

/**
 * Checks whether a candidate prompt is semantically a duplicate of any prior
 * prompt in the session using Jaccard similarity on normalized content tokens.
 */
export function isSemanticallyDuplicateQuestion(
  candidatePrompt: string,
  priorPrompts: string[],
  threshold = 0.72
): boolean {
  const candidateTokens = new Set(tokenizeForSemantics(candidatePrompt));
  if (candidateTokens.size === 0) return false;

  for (const prior of priorPrompts) {
    const priorTokens = new Set(tokenizeForSemantics(prior));
    if (priorTokens.size === 0) continue;
    let intersection = 0;
    for (const tok of candidateTokens) {
      if (priorTokens.has(tok)) intersection += 1;
    }
    const union = candidateTokens.size + priorTokens.size - intersection;
    const jaccard = union > 0 ? intersection / union : 0;
    if (jaccard >= threshold) {
      return true;
    }
  }
  return false;
}

/**
 * Computes target difficulty (1..5) dynamically from ConceptMasterySummary / FSRS
 * evidence and recent session performance rather than hardcoding difficulty 2.
 */
export function selectAdaptiveDifficulty(input: {
  masterySummary?: ConceptMasterySummary | null;
  recentOutcomes: Array<{
    outcome: "understood" | "partial" | "needs_review";
    usedHint?: boolean;
    difficulty?: number;
  }>;
  preferenceDifficulty?: string | null;
}): number {
  let base = 2;

  switch (input.masterySummary?.level) {
    case "needs-attention":
      base = 1;
      break;
    case "insufficient-evidence":
      base = 2;
      break;
    case "developing":
      base = 3;
      break;
    case "demonstrated-consistently":
      base = 4;
      break;
    default:
      base = 2;
  }

  if (input.preferenceDifficulty === "foundational") {
    base = Math.min(base, 2);
  } else if (input.preferenceDifficulty === "challenging") {
    base = Math.max(base, 3);
  }

  const recent = input.recentOutcomes.slice(-3);
  if (recent.length > 0) {
    const latest = recent[recent.length - 1];
    if (latest.outcome === "needs_review") {
      base = Math.max(1, (latest.difficulty ?? base) - 1);
    } else if (
      recent.length >= 2 &&
      recent.slice(-2).every((r) => r.outcome === "understood" && !r.usedHint)
    ) {
      base = Math.min(5, (latest.difficulty ?? base) + 1);
    } else if (latest.outcome === "understood" && !latest.usedHint) {
      base = Math.min(5, Math.max(base, latest.difficulty ?? base));
    }
  }

  return Math.max(1, Math.min(5, Math.round(base)));
}

function normalizeAnswer(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deterministic local evaluator for all 5 practice question types so feedback
 * and misconception explanations work reliably offline and in non-Tauri environments.
 */
export function evaluatePracticeAnswerLocally(
  question: PracticeQuestionItem,
  answer: PracticeAnswerPayload
): PracticeEvaluationResult {
  const evaluatedAt = new Date().toISOString();
  const usedHint = Boolean(answer.usedHint);

  if (question.questionKind === "multiple_choice") {
    const selected = answer.selectedIndex ?? -1;
    const correct = question.correctIndex ?? 0;
    const isCorrect = selected === correct;
    const distractorWhy =
      !isCorrect && question.distractorMisconceptions
        ? question.distractorMisconceptions[String(selected)] ?? null
        : null;
    return {
      questionId: question.id,
      conceptIds: question.conceptIds,
      outcome: isCorrect ? "understood" : "needs_review",
      score: isCorrect ? (usedHint ? 0.85 : 1.0) : 0.0,
      feedback: isCorrect
        ? question.explanation
        : distractorWhy
        ? `Why this was off: ${distractorWhy} ${question.explanation}`
        : `Not quite. ${question.explanation}`,
      misconceptionDetected: isCorrect
        ? null
        : distractorWhy ?? "Selected distractor conflicts with the source passage.",
      graderOrigin: "deterministic",
      difficulty: question.difficulty,
      usedHint,
      evaluatedAt,
    };
  }

  if (question.questionKind === "fill_blank") {
    const expected = (question.expectedBlanks ?? []).map(normalizeAnswer).filter(Boolean);
    const provided = (answer.blankAnswers ?? []).map(normalizeAnswer);
    if (expected.length === 0) {
      const text = normalizeAnswer(answer.writtenText ?? "");
      const ok = text.length > 0;
      return {
        questionId: question.id,
        conceptIds: question.conceptIds,
        outcome: ok ? "partial" : "needs_review",
        score: ok ? 0.6 : 0,
        feedback: question.explanation,
        misconceptionDetected: ok ? null : "Blank left unanswered.",
        graderOrigin: "deterministic",
        difficulty: question.difficulty,
        usedHint,
        evaluatedAt,
      };
    }
    let matched = 0;
    for (let i = 0; i < expected.length; i += 1) {
      const exp = expected[i];
      const got = provided[i] ?? "";
      if (got && (got === exp || got.includes(exp) || exp.includes(got))) {
        matched += 1;
      }
    }
    const ratio = matched / expected.length;
    const outcome = ratio >= 0.99 ? "understood" : ratio >= 0.5 ? "partial" : "needs_review";
    return {
      questionId: question.id,
      conceptIds: question.conceptIds,
      outcome,
      score: ratio,
      feedback:
        outcome === "understood"
          ? `Correct! ${question.explanation}`
          : `Expected: ${(question.expectedBlanks ?? []).join(", ")}. ${question.explanation}`,
      misconceptionDetected:
        outcome === "understood"
          ? null
          : "Missing or inaccurate key term for the blank.",
      graderOrigin: "deterministic",
      difficulty: question.difficulty,
      usedHint,
      evaluatedAt,
    };
  }

  if (question.questionKind === "ordering") {
    const expectedOrder = question.correctOrder ?? question.orderingItems ?? [];
    const providedOrder = answer.orderedItems ?? [];
    if (expectedOrder.length === 0) {
      return {
        questionId: question.id,
        conceptIds: question.conceptIds,
        outcome: "partial",
        score: 0.5,
        feedback: question.explanation,
        misconceptionDetected: null,
        graderOrigin: "deterministic",
        difficulty: question.difficulty,
        usedHint,
        evaluatedAt,
      };
    }
    let exactMatches = 0;
    for (let i = 0; i < expectedOrder.length; i += 1) {
      if (normalizeAnswer(providedOrder[i] ?? "") === normalizeAnswer(expectedOrder[i])) {
        exactMatches += 1;
      }
    }
    const ratio = exactMatches / expectedOrder.length;
    const outcome = ratio >= 0.99 ? "understood" : ratio >= 0.5 ? "partial" : "needs_review";
    return {
      questionId: question.id,
      conceptIds: question.conceptIds,
      outcome,
      score: ratio,
      feedback:
        outcome === "understood"
          ? `Exact sequence! ${question.explanation}`
          : `Some steps are out of order (${exactMatches}/${expectedOrder.length} in place). ${question.explanation}`,
      misconceptionDetected:
        outcome === "understood" ? null : "Causal or chronological step order was inverted.",
      graderOrigin: "deterministic",
      difficulty: question.difficulty,
      usedHint,
      evaluatedAt,
    };
  }

  // free_recall and scenario_error (and extensible open-ended formats)
  const response = normalizeAnswer(answer.writtenText ?? "");
  const keyFacts = (question.requiredKeyFacts ?? []).filter((f) => f.trim().length > 0);
  if (keyFacts.length === 0) {
    const tokens = tokenizeForSemantics(response);
    const outcome = tokens.length >= 6 ? "partial" : "needs_review";
    return {
      questionId: question.id,
      conceptIds: question.conceptIds,
      outcome,
      score: outcome === "partial" ? 0.6 : 0.2,
      feedback: `${question.explanation}`,
      misconceptionDetected:
        outcome === "needs_review" ? "Response too brief to demonstrate concept recall." : null,
      graderOrigin: "deterministic",
      difficulty: question.difficulty,
      usedHint,
      evaluatedAt,
    };
  }

  let matchedFacts = 0;
  const missingFacts: string[] = [];
  for (const fact of keyFacts) {
    const factTokens = tokenizeForSemantics(fact);
    const hitCount = factTokens.filter((t) => response.includes(t)).length;
    if (factTokens.length > 0 && hitCount >= Math.max(1, Math.ceil(factTokens.length * 0.5))) {
      matchedFacts += 1;
    } else {
      missingFacts.push(fact);
    }
  }
  const ratio = matchedFacts / keyFacts.length;
  const outcome = ratio >= 0.75 ? "understood" : ratio >= 0.4 ? "partial" : "needs_review";
  return {
    questionId: question.id,
    conceptIds: question.conceptIds,
    outcome,
    score: ratio,
    feedback:
      outcome === "understood"
        ? `Strong explanation covering key points. ${question.explanation}`
        : `Missing key point(s): ${missingFacts.join("; ")}. ${question.explanation}`,
    misconceptionDetected:
      outcome === "understood"
        ? null
        : question.questionKind === "scenario_error"
        ? `Did not pinpoint the core flaw (${missingFacts[0] ?? "check source"}).`
        : `Incomplete conceptual coverage (${missingFacts[0] ?? "check source"}).`,
    graderOrigin: "deterministic",
    difficulty: question.difficulty,
    usedHint,
    evaluatedAt,
  };
}
