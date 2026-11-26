import type {
  PedagogicalCriterionScore,
  PedagogicalEvaluationReport,
  PedagogicalRating,
  StudyModeKnowledgeAuthority,
  StudyModeVerificationResult,
} from "../../../types/studyMode";

export interface DeterministicVerificationInput {
  artifactType: string;
  knowledgeAuthority: StudyModeKnowledgeAuthority;
  authorizedSourceIds: string[];
  expectedRevision?: string;
  artifactRevision?: string;
  sourceTexts: string[];
  payload: Record<string, unknown>;
}

const UNSAFE_MARKUP_RE = /(<script|javascript:|onerror=|onload=|onclick=)/i;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function hasUnsafeMarkup(value: unknown): boolean {
  if (typeof value === "string") {
    return UNSAFE_MARKUP_RE.test(value);
  }
  if (Array.isArray(value)) {
    return value.some(hasUnsafeMarkup);
  }
  if (value && typeof value === "object") {
    return Object.values(value).some(hasUnsafeMarkup);
  }
  return false;
}

interface ExtractedCitation {
  sourceId?: string;
  quote?: string;
}

function collectCitationsFromContainer(
  container: Record<string, unknown>,
  out: ExtractedCitation[]
): void {
  for (const key of ["citations", "sourceRefs"] as const) {
    const raw = container[key];
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const sourceId =
        typeof obj.sourceId === "string"
          ? obj.sourceId
          : typeof obj.documentId === "string"
          ? obj.documentId
          : undefined;
      const quote =
        typeof obj.quote === "string"
          ? obj.quote
          : typeof obj.excerpt === "string"
          ? obj.excerpt
          : undefined;
      out.push({ sourceId, quote });
    }
  }
}

function extractCitations(payload: Record<string, unknown>): ExtractedCitation[] {
  const out: ExtractedCitation[] = [];
  collectCitationsFromContainer(payload, out);
  for (const arrayKey of ["nodes", "events", "slides"] as const) {
    const items = payload[arrayKey];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (item && typeof item === "object") {
        collectCitationsFromContainer(item as Record<string, unknown>, out);
      }
    }
  }
  return out;
}

export function verifyStudyModeArtifactDeterministic(
  input: DeterministicVerificationInput
): StudyModeVerificationResult {
  const issues: string[] = [];

  if (hasUnsafeMarkup(input.payload)) {
    issues.push("unsafe_markup_detected");
  }

  if (
    input.expectedRevision &&
    input.artifactRevision &&
    input.expectedRevision !== input.artifactRevision
  ) {
    issues.push("source_revision_mismatch");
  }

  const citations = extractCitations(input.payload);
  const normalizedSources = input.sourceTexts.map(normalizeWhitespace);

  if (
    input.knowledgeAuthority === "source-only" &&
    citations.length === 0 &&
    ["explanation", "worked_example", "summary", "mind_map", "timeline", "slides"].includes(
      input.artifactType
    )
  ) {
    issues.push("missing_required_citations_in_source_only_mode");
  }

  for (const citation of citations) {
    if (
      citation.sourceId &&
      input.authorizedSourceIds.length > 0 &&
      !input.authorizedSourceIds.includes(citation.sourceId)
    ) {
      issues.push(`unauthorized_source_id:${citation.sourceId}`);
    }
    if (citation.quote) {
      const nq = normalizeWhitespace(citation.quote);
      if (
        nq.length >= 12 &&
        normalizedSources.length > 0 &&
        !normalizedSources.some((src) => src.includes(nq))
      ) {
        issues.push("citation_quote_not_found_in_source");
      }
    }
  }

  if (input.artifactType === "formative_question") {
    const kind = input.payload.questionKind;
    if (kind === "multiple_choice") {
      const options = input.payload.options;
      const answerKey = input.payload.answerKey as Record<string, unknown> | undefined;
      const idx = typeof answerKey?.correctIndex === "number" ? answerKey.correctIndex : -1;
      if (!Array.isArray(options) || options.length < 2 || idx < 0 || idx >= options.length) {
        issues.push("invalid_multiple_choice_answer_structure");
      } else {
        const normalizedOpts = options.map((o) =>
          typeof o === "string" ? normalizeWhitespace(o) : ""
        );
        if (new Set(normalizedOpts).size !== normalizedOpts.length || normalizedOpts.some((o) => !o)) {
          issues.push("duplicate_or_empty_multiple_choice_options");
        }
      }
    }
  }

  const sourceFidelityRating: PedagogicalRating = issues.some(
    (i) =>
      i.includes("citation") ||
      i.includes("source") ||
      i.includes("revision") ||
      i.includes("unauthorized")
  )
    ? "fail"
    : citations.length === 0
    ? "partial"
    : "pass";

  const accuracyRating: PedagogicalRating = issues.some(
    (i) => i.includes("unsafe") || i.includes("multiple_choice")
  )
    ? "fail"
    : "pass";

  const criteria: PedagogicalCriterionScore[] = [
    {
      criterion: "accuracy",
      rating: accuracyRating,
      rationale:
        accuracyRating === "pass"
          ? "Deterministic structural and safety checks passed."
          : "Structural or safety gate failed.",
      evidence: issues,
    },
    {
      criterion: "source_fidelity",
      rating: sourceFidelityRating,
      rationale:
        sourceFidelityRating === "fail"
          ? "Citation or revision verification failed."
          : "Citations resolved against authorized source scope.",
      evidence: issues,
    },
  ];

  const report: PedagogicalEvaluationReport = {
    hardGatePassed: issues.length === 0,
    hardGateFailures: [...issues],
    criteria,
    evaluatorOrigin: "deterministic",
  };

  return {
    valid: issues.length === 0,
    issues,
    report,
  };
}

export function mergePedagogicalReports(
  deterministic: PedagogicalEvaluationReport,
  semantic?: PedagogicalCriterionScore[]
): PedagogicalEvaluationReport {
  const criteria = [...deterministic.criteria];
  const hardFailures = [...deterministic.hardGateFailures];

  if (semantic) {
    for (const score of semantic) {
      const idx = criteria.findIndex((c) => c.criterion === score.criterion);
      if (idx >= 0) {
        // Hard gates: never allow semantic pass to override deterministic fail
        if (criteria[idx].rating === "fail") continue;
        criteria[idx] = score;
      } else {
        criteria.push(score);
      }
      if (
        (score.criterion === "accuracy" || score.criterion === "source_fidelity") &&
        score.rating === "fail"
      ) {
        hardFailures.push(`${score.criterion}_semantic_fail:${score.rationale}`);
      }
    }
  }

  return {
    hardGatePassed: hardFailures.length === 0,
    hardGateFailures: Array.from(new Set(hardFailures)),
    criteria,
    evaluatorOrigin: semantic ? "deterministic+ai" : deterministic.evaluatorOrigin,
  };
}
