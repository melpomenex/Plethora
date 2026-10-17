/**
 * Response rendering data model (design D6, task 3.3).
 *
 * Turns an answer plus its canonical citations into the exact structure the
 * shared renderer needs: claim-linked inline indicators, expandable quotes,
 * origin labels and copy/export text. Pure data — the React renderer consumes
 * this and adds no evidence semantics of its own.
 *
 * No numeric similarity is ever exposed as truth confidence here.
 */

import type { Citation } from "./conversations/types";

export interface InlineIndicator {
  number: number;
  /** Rendering as a link/button requires a verified citation. */
  actionable: boolean;
  citation?: Citation;
  label: string;
  /** Accessible name for keyboard/touch activation. */
  accessibleName: string;
}

export interface AnswerSegment {
  kind: "text" | "marker";
  text: string;
  indicator?: InlineIndicator;
}

export interface CitationDetail {
  citation: Citation;
  /** Title + source-appropriate locator, e.g. "Paper · page 12". */
  originLabel: string;
  /** Expandable quote; the exact validated supporting passage. */
  quote?: string;
  /** Why the citation is not actionable, when it is not. */
  limitation?: string;
}

export interface RenderedAnswer {
  segments: AnswerSegment[];
  details: CitationDetail[];
  /** Copy text: answer with numbered sources; no confidence numbers. */
  copyText: string;
  /** True when at least one verified citation exists. */
  hasVerifiedEvidence: boolean;
  /** An honest warning when markers had no surviving citation. */
  danglingWarning?: string;
}

function locatorLabel(citation: Citation): string {
  const locator = citation.locator;
  if (!locator) return "";
  if (locator.page !== undefined) return `page ${locator.page}`;
  if (locator.timeSeconds !== undefined) {
    const total = Math.floor(locator.timeSeconds);
    return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60)
      .toString()
      .padStart(2, "0")}`;
  }
  if (locator.sectionId) return locator.sectionId;
  if (locator.cfi) return "section";
  if (locator.anchor) return locator.anchor;
  return "";
}

export function originLabelFor(citation: Citation): string {
  const title = citation.title ?? citation.documentId ?? "source";
  const locator = locatorLabel(citation);
  const kind =
    citation.origin === "selection"
      ? "selected passage"
      : citation.origin === "web"
        ? "web"
        : "library";
  return [title, locator, `(${kind})`].filter(Boolean).join(" · ");
}

/**
 * Build the renderable answer. `[N]` markers whose citation is missing or not
 * verified render as inert text and are reported in `danglingWarning`; they
 * never become links and never renumber the surviving citations.
 */
export function renderAnswer(answerText: string, citations: readonly Citation[]): RenderedAnswer {
  const byNumber = new Map(citations.map((citation) => [citation.displayNumber, citation]));
  const segments: AnswerSegment[] = [];
  const details: CitationDetail[] = [];
  let danglingCount = 0;
  let hasVerified = false;

  const markerPattern = /\[(\d{1,2})\]/g;
  let lastIndex = 0;
  for (const match of answerText.matchAll(markerPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ kind: "text", text: answerText.slice(lastIndex, index) });
    }
    const number = Number(match[1]);
    const citation = byNumber.get(number);
    const actionable = Boolean(citation && citation.validation === "verified");
    if (!actionable) danglingCount += 1;
    if (actionable) hasVerified = true;
    const indicator: InlineIndicator = {
      number,
      actionable,
      citation,
      label: `[${number}]`,
      accessibleName: actionable
        ? `Source ${number}: ${originLabelFor(citation!)}`
        : `Reference ${number} has no verified source`,
    };
    segments.push({ kind: "marker", text: match[0], indicator });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < answerText.length) {
    segments.push({ kind: "text", text: answerText.slice(lastIndex) });
  }

  for (const citation of citations) {
    details.push({
      citation,
      originLabel: originLabelFor(citation),
      quote: citation.quote,
      limitation:
        citation.validation === "verified"
          ? undefined
          : citation.validation === "legacy"
            ? "Saved before structured citations; shown as-is and not verified."
            : citation.validation === "unresolved"
              ? "The exact passage could not be located."
              : "This reference is invalid and is not shown as a source.",
    });
  }

  const sourceLines = details
    .filter((detail) => detail.citation.validation !== "invalid")
    .map(
      (detail) =>
        `${detail.citation.displayNumber}. ${originLabelFor(detail.citation)}${
          detail.quote ? ` — "${detail.quote}"` : ""
        }`,
    );
  const copyText = sourceLines.length
    ? `${answerText}\n\nSources:\n${sourceLines.join("\n")}`
    : answerText;

  return {
    segments,
    details,
    copyText,
    hasVerifiedEvidence: hasVerified,
    danglingWarning:
      danglingCount > 0
        ? `${danglingCount} reference${danglingCount === 1 ? "" : "s"} in this answer have no verified source.`
        : undefined,
  };
}

/**
 * Keyboard/touch activation contract: an indicator is activatable exactly when
 * it is actionable; the handler receives the citation for source navigation.
 */
export function indicatorActivation(
  indicator: InlineIndicator,
): { activatable: boolean; citation?: Citation; reason?: string } {
  if (!indicator.actionable || !indicator.citation) {
    return { activatable: false, reason: "no verified source" };
  }
  return { activatable: true, citation: indicator.citation };
}
