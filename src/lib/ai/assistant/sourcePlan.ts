/**
 * Bounded source planning for position-aware intent (design D4, task 2.7).
 *
 * Turns a reader's *intent* (this page, this chapter, read so far, whole
 * source) into a bounded context request with source-appropriate locators.
 * The planner is pure: extraction/index lookups are injected, and the caller
 * supplies whatever caches it already holds (page text, section index,
 * summaries). Nothing here extracts on open or on keystrokes — planning is
 * only ever called at submit.
 */

export type SourceIntent =
  | "page"
  | "section"
  | "read-so-far"
  | "whole-source"
  | "selection"
  | "general";

export type SourceKind = "pdf" | "epub" | "article" | "markdown" | "text" | "unknown";

export interface SourcePosition {
  /** PDF page (1-based). */
  page?: number;
  /** EPUB section id / CFI. */
  sectionId?: string;
  /** Reading progress within the source (0–1) when known. */
  readFraction?: number;
}

export interface SectionSummary {
  id: string;
  title: string;
  /** Bounded summary text (already cached by the reader/index). */
  summary: string;
  order: number;
}

export interface SourcePlanInput {
  kind: SourceKind;
  /** The submitted question (used to classify the intent). */
  question?: string;
  /** Explicit intent override from the routing decision. */
  intent?: SourceIntent;
  position?: SourcePosition;
  /** Bounded page/section text cache keyed by locator. */
  pageText?: (page: number) => string | undefined;
  sectionText?: (sectionId: string) => string | undefined;
  /** Ordered section index (EPUB/article). */
  sections?: SectionSummary[];
  /** Cached whole-source text when it fits the budget. */
  wholeSourceText?: string;
  /** Prompt budget in tokens for the source portion. */
  budgetTokens: number;
  /** Token estimator (defaults to ~4 chars/token). */
  estimateTokens?: (text: string) => number;
  /** Capability flags of the resolved model. */
  capabilities?: {
    vision?: boolean;
    /** True when the model cannot represent math/figures faithfully. */
    textOnly?: boolean;
  };
  /** Explicit section ids the user asked to compare. */
  requestedSectionIds?: string[];
}

export interface SourcePlan {
  intent: SourceIntent;
  /** Bounded content to include ('' when nothing could be resolved). */
  content: string;
  /** Which locators the content covers. */
  covered: {
    pages?: number[];
    sectionIds?: string[];
    /** Read-so-far upper bound actually used. */
    readUpperBound?: string;
  };
  /** Honest limitations (LLM-visible + user-visible). */
  limitations: string[];
  truncated: boolean;
  /**
   * True when the plan is derived context only: summaries/cached text that
   * must NOT be presented as primary citation evidence.
   */
  derivedContext: boolean;
  /** Missing visual/mathematical capability disclosure, when applicable. */
  capabilityNotice?: string;
}

function defaultEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Classify the intent from the question plus available position. The
 * recognizer is deliberately small: the routing table has already decided
 * *which* source; this decides *how much* of it.
 */
export function classifySourceIntent(
  question: string,
  position: SourcePosition | undefined,
  kind: SourceKind,
): SourceIntent {
  const lower = question.toLowerCase();
  if (/\b(this|current) (page|chapter|section|paragraph|passage)\b/.test(lower)) {
    if (/\b(page)\b/.test(lower) && kind === "pdf") return "page";
    if (/\b(chapter|section|paragraph)\b/.test(lower) && (kind === "epub" || kind === "article" || kind === "markdown")) {
      return "section";
    }
    return position?.page !== undefined ? "page" : position?.sectionId ? "section" : "section";
  }
  if (/\b(so far|up to (here|now)|what i('| ha)ve read)\b/.test(lower)) return "read-so-far";
  if (/\b(whole|entire|full|summar(y|ize) (the|this) (document|book|paper|article))\b/.test(lower)) {
    return "whole-source";
  }
  if (/\b(selected|selection|highlighted)\b/.test(lower)) return "selection";
  // A positional question with no explicit scope is still position-aware.
  if (position?.page !== undefined && kind === "pdf") return "page";
  if (position?.sectionId && (kind === "epub" || kind === "article" || kind === "markdown")) return "section";
  return "general";
}

export function planSourceContext(input: SourcePlanInput): SourcePlan {
  const estimate = input.estimateTokens ?? defaultEstimate;
  const budget = Math.max(0, input.budgetTokens);
  const intent: SourceIntent =
    input.requestedSectionIds?.length
      ? "section"
      : input.intent ?? classifySourceIntent(input.question ?? "", input.position, input.kind);

  const limitations: string[] = [];
  const covered: SourcePlan["covered"] = {};
  let truncated = false;
  let derivedContext = false;
  let content = "";

  const fit = (text: string): string => {
    if (estimate(text) <= budget) return text;
    truncated = true;
    // Keep a bounded prefix; the caller shows the truncation notice.
    const maxChars = Math.max(0, budget * 4);
    return `${text.slice(0, maxChars)}\n\n[context truncated to the model budget]`;
  };

  /* Explicit multi-section comparison: both requested sections within budget. */
  if (input.requestedSectionIds?.length && input.sectionText) {
    const parts: string[] = [];
    for (const sectionId of input.requestedSectionIds) {
      const text = input.sectionText(sectionId);
      const meta = input.sections?.find((section) => section.id === sectionId);
      if (!text) {
        limitations.push(`section ${meta?.title ?? sectionId} is not available`);
        continue;
      }
      parts.push(`## ${meta?.title ?? sectionId}\n${text}`);
      covered.sectionIds = [...(covered.sectionIds ?? []), sectionId];
    }
    content = fit(parts.join("\n\n"));
    return {
      intent: "section",
      content,
      covered,
      limitations,
      truncated,
      derivedContext: false,
      capabilityNotice: capabilityNoticeFor(input),
    };
  }

  switch (intent) {
    case "page": {
      const page = input.position?.page;
      if (page === undefined) {
        limitations.push("the current page is unknown");
        return emptyPlan(intent, limitations, input);
      }
      const text = input.pageText?.(page);
      if (!text) {
        limitations.push(`page ${page} has no extractable text yet`);
        return {
          intent,
          content: "",
          covered: { pages: [] },
          limitations,
          truncated: false,
          derivedContext: false,
          capabilityNotice: capabilityNoticeFor(input),
        };
      }
      covered.pages = [page];
      return {
        intent,
        content: fit(text),
        covered,
        limitations,
        truncated,
        derivedContext: false,
        capabilityNotice: capabilityNoticeFor(input),
      };
    }

    case "section": {
      const sectionId = input.position?.sectionId;
      if (!sectionId) {
        limitations.push("the current section is unknown");
        return emptyPlan(intent, limitations, input);
      }
      const text = input.sectionText?.(sectionId);
      const meta = input.sections?.find((section) => section.id === sectionId);
      if (!text) {
        limitations.push(`section ${meta?.title ?? sectionId} is not available`);
        return emptyPlan(intent, limitations, input);
      }
      covered.sectionIds = [sectionId];
      return {
        intent,
        content: fit(text),
        covered,
        limitations,
        truncated,
        derivedContext: false,
        capabilityNotice: capabilityNoticeFor(input),
      };
    }

    case "read-so-far": {
      const fraction = input.position?.readFraction;
      if (fraction === undefined) {
        // Unknown reading position: do not guess. Fall back to the visible
        // page/section and say so (recursion with an explicit non-read-so-far
        // intent, so this cannot loop).
        const fallback = planSourceContext({
          ...input,
          intent: input.position?.page !== undefined ? "page" : input.position?.sectionId ? "section" : "general",
        });
        return {
          ...fallback,
          limitations: [
            "the reading position is unknown; using the visible page/section",
            ...fallback.limitations,
          ],
        };
      }
      const sections = input.sections ?? [];
      const upTo = Math.max(1, Math.ceil(sections.length * Math.min(1, Math.max(0, fraction))));
      const included = sections.slice(0, upTo);
      if (!included.length || !input.sectionText) {
        limitations.push("no cached section summaries are available for a read-so-far summary");
        return emptyPlan(intent, limitations, input);
      }
      const parts = included.map((section) => `## ${section.title}\n${section.summary}`);
      covered.sectionIds = included.map((section) => section.id);
      covered.readUpperBound = included[included.length - 1]?.title;
      derivedContext = true;
      limitations.push(
        "summaries are derived context, not primary citation evidence",
      );
      return {
        intent,
        content: fit(parts.join("\n\n")),
        covered,
        limitations,
        truncated,
        derivedContext,
        capabilityNotice: capabilityNoticeFor(input),
      };
    }

    case "whole-source": {
      if (input.wholeSourceText && estimate(input.wholeSourceText) <= budget) {
        return {
          intent,
          content: input.wholeSourceText,
          covered,
          limitations,
          truncated: false,
          derivedContext: false,
          capabilityNotice: capabilityNoticeFor(input),
        };
      }
      const sections = input.sections ?? [];
      if (!sections.length) {
        limitations.push("the source does not fit the model budget and no section summaries are cached");
        return emptyPlan(intent, limitations, input);
      }
      derivedContext = true;
      limitations.push("summaries are derived context, not primary citation evidence");
      truncated = true;
      return {
        intent,
        content: fit(
          sections.map((section) => `## ${section.title}\n${section.summary}`).join("\n\n"),
        ),
        covered: { sectionIds: sections.map((section) => section.id) },
        limitations,
        truncated,
        derivedContext,
        capabilityNotice: capabilityNoticeFor(input),
      };
    }

    case "selection":
      // Selection handling lives in the routing/attachment layer; there is no
      // extraction to plan here.
      return emptyPlan(intent, limitations, input);

    default:
      return emptyPlan("general", limitations, input);
  }
}

function emptyPlan(
  intent: SourceIntent,
  limitations: string[],
  input: SourcePlanInput,
): SourcePlan {
  return {
    intent,
    content: "",
    covered: {},
    limitations,
    truncated: false,
    derivedContext: false,
    capabilityNotice: capabilityNoticeFor(input),
  };
}

function capabilityNoticeFor(input: SourcePlanInput): string | undefined {
  if (input.capabilities?.textOnly) {
    return "This model cannot see page layout, equations or figures; mathematical or visual content is described from text only.";
  }
  return undefined;
}
