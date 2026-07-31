/**
 * Chip model for the AI Flashcard Studio's mobile context bar.
 *
 * On a phone the Studio's five configuration bands collapse into one scrollable
 * row of chips. Each chip summarizes the *current value* of a control so the
 * user can read the Studio's configuration at a glance, and opens that control
 * in a bottom sheet when tapped.
 *
 * The derivation lives here as a pure function so the rules that regress
 * silently — which chips hide, how labels truncate, how counts format — are
 * unit-testable without a DOM.
 */

import { normalizeContextSelection, type ContextSelection } from "./contextSelection";

/** Which control a chip opens. Doubles as the Studio's single open-sheet key. */
export type StudioSheet =
  | "document"
  | "deck"
  | "images"
  | "context"
  | "views"
  | "provider";

/** Icon identity, resolved to a component by the renderer. */
export type StudioChipIcon =
  | "document"
  | "deck"
  | "tag"
  | "images"
  | "context"
  | "provider";

export interface StudioChip {
  /** Stable key; also the sheet this chip opens, except for the read-only tag chip. */
  id: StudioSheet | "tags";
  icon: StudioChipIcon;
  /** Display text, truncated to the chip's budget. */
  label: string;
  /** Untruncated value, used as the chip's accessible name. */
  fullLabel: string;
  /** True when this control holds a non-default value (chip renders emphasized). */
  active: boolean;
  /** The sheet to open on tap; null for chips that are display-only. */
  opens: StudioSheet | null;
}

export interface StudioChipState {
  documentTitle: string | null;
  deckName: string | null;
  deckTags: string[];
  /** Total images available in the registry for the current document. */
  imageCount: number;
  /** How many of those the user has selected. */
  selectedImageCount: number;
  contextSelection: ContextSelection;
  /** Token estimate for the current context selection. */
  contextTokens: number;
  providerName: string | null;
}

/** Per-chip character budget. Chips share a row, so long values must yield. */
const LABEL_BUDGET = 18;

/**
 * Truncate to `budget` characters, appending an ellipsis. Trailing whitespace is
 * trimmed first so we never render "Some title …".
 */
export function truncateChipLabel(value: string, budget: number = LABEL_BUDGET): string {
  if (value.length <= budget) return value;
  return `${value.slice(0, budget).trimEnd()}…`;
}

/** Compact count for the token figure on the context chip. */
export function formatChipTokens(count: number): string {
  if (count < 1000) return `${count}`;
  return `${(count / 1000).toFixed(1)}k`;
}

/**
 * Build the chip row for the current Studio configuration.
 *
 * Chips that carry no information are omitted rather than rendered empty — an
 * unset deck-tag or image chip would cost a slot in a row that is already
 * competing for width.
 */
export function buildStudioChips(state: StudioChipState): StudioChip[] {
  const chips: StudioChip[] = [];
  const selection = normalizeContextSelection(state.contextSelection);

  // Document — always present, since it is the Studio's primary input. Renders
  // in an unset state prompting selection when no document is chosen.
  const documentTitle = state.documentTitle?.trim() || "";
  chips.push({
    id: "document",
    icon: "document",
    label: documentTitle ? truncateChipLabel(documentTitle) : "",
    fullLabel: documentTitle,
    active: documentTitle.length > 0,
    opens: "document",
  });

  // Deck — always present; generated cards need somewhere to go.
  const deckName = state.deckName?.trim() || "";
  chips.push({
    id: "deck",
    icon: "deck",
    label: deckName ? truncateChipLabel(deckName) : "",
    fullLabel: deckName,
    active: deckName.length > 0,
    opens: "deck",
  });

  // Deck tags — display-only, and only when the deck actually has tags.
  if (state.deckTags.length > 0) {
    const joined = state.deckTags.join(", ");
    chips.push({
      id: "tags",
      icon: "tag",
      label: truncateChipLabel(joined),
      fullLabel: joined,
      active: false,
      opens: null,
    });
  }

  // Images — only when the registry has something, or the user already picked.
  if (state.imageCount > 0 || state.selectedImageCount > 0) {
    const label = state.selectedImageCount > 0
      ? `${state.selectedImageCount}`
      : `${state.imageCount}`;
    chips.push({
      id: "images",
      icon: "images",
      label,
      fullLabel: label,
      active: state.selectedImageCount > 0,
      opens: "images",
    });
  }

  // Context Control — the token figure is the number users actually watch.
  chips.push({
    id: "context",
    icon: "context",
    label: formatChipTokens(state.contextTokens),
    fullLabel: formatChipTokens(state.contextTokens),
    active: selection.mode !== "full",
    opens: "context",
  });

  // Provider — configuration state, so it belongs in the bar rather than
  // consuming one of the header's four touch targets.
  const providerName = state.providerName?.trim() || "";
  chips.push({
    id: "provider",
    icon: "provider",
    label: providerName ? truncateChipLabel(providerName) : "",
    fullLabel: providerName,
    active: providerName.length > 0,
    opens: "provider",
  });

  return chips;
}
