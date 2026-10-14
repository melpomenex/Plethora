/**
 * Typed contracts for the command-palette hub (revamp-command-palette).
 *
 * These are the shared types across the controller (`CommandCenter`) and the
 * presentation tree (`GlobalSearch` + `Palette*` children). Pure data only:
 * no React, no stores, no native calls. The controller derives a
 * `PaletteHomeModel`, dispatches `PaletteActionInvocation`s through one
 * executor, and passes both across an explicit typed boundary.
 *
 * Invalid scopes/action ids are rejected at compile time by the literal
 * unions below; `isPaletteScope` / `isPaletteActionId` provide the runtime
 * guard for data crossing untrusted boundaries (tests, events, persistence).
 */

import type { ContextualViewType, ViewActionId } from "./contextualActions";
import type { Document } from "../types/document";

/** The six exclusive scopes, in reference order. `all` is the default. */
export const PALETTE_SCOPES = [
  "all",
  "actions",
  "documents",
  "library",
  "cards",
  "settings",
] as const;

export type PaletteScope = (typeof PALETTE_SCOPES)[number];

export function isPaletteScope(value: unknown): value is PaletteScope {
  return (
    typeof value === "string" &&
    (PALETTE_SCOPES as readonly string[]).includes(value)
  );
}

/**
 * Body mode derived from input classification, selected scope, and explicit
 * browse/composer state. URL import and note composition take precedence over
 * search.
 */
export type PaletteInputMode = "home" | "search" | "url" | "help" | "note";

/**
 * Stable action identifiers for every hub action. Presentation code never
 * implements behavior; it invokes one of these through the shared executor.
 */
export const PALETTE_ACTION_IDS = [
  "palette.resume",
  "palette.openRecent",
  "palette.reviewDue",
  "palette.openReviewOverview",
  "palette.askLibrary",
  "palette.openSettings",
  "palette.createNote",
  "palette.importDocument",
  "palette.openLibrary",
  "palette.viewAll",
  "palette.seeAllActions",
  "palette.seeExamples",
  "palette.filterAdvanced",
  "palette.selectSuggestion",
  "doc.viewInLibrary",
  "doc.openDetails",
  "doc.copyTitle",
  "doc.copySourceLink",
  "window.close",
] as const;

export type PaletteActionId = (typeof PALETTE_ACTION_IDS)[number];

export function isPaletteActionId(value: unknown): value is PaletteActionId {
  return (
    typeof value === "string" &&
    (PALETTE_ACTION_IDS as readonly string[]).includes(value)
  );
}

/** One typed invocation handed to the shared executor. */
export interface PaletteActionInvocation {
  id: PaletteActionId;
  /** Target document, when the action operates on one. */
  documentId?: string;
  /** Suggestion payload, when `id === "palette.selectSuggestion"`. */
  suggestion?: PaletteSuggestion;
}

/* ------------------------------------------------------------------------- */
/* Home data                                                                  */
/* ------------------------------------------------------------------------- */

export interface PaletteResumeItem {
  documentId: string;
  title: string;
  fileType: Document["fileType"];
  /** Normalized 0–100 progress. `null` when unknown. */
  progressPercent: number | null;
  coverUrl: string | null;
  pageCount: number | null;
  /** Human format label ("PDF Document"), derived from `fileType`. */
  formatLabel: string | null;
  /** Persisted location label ("Page 137", "62%", "1:04:12"). */
  locationLabel: string | null;
  /** Relative timestamp label, already translated. */
  timestampLabel: string | null;
  /** What the timestamp means; never claim reading when it is modified. */
  timestampKind: "read" | "modified" | null;
  /** Saved passage for the location, when one exists. */
  passage: string | null;
  /** Accurately-worded source note ("Last read", "Last updated"). */
  timestampLeadKey: "lastRead" | "lastUpdated" | null;
  /** External source URL (http/https filePath) for the Copy source link action. */
  sourceUrl: string | null;
}

export interface PaletteResumeState {
  status: "loading" | "ready" | "none";
  item: PaletteResumeItem | null;
}

export interface PaletteRecentItem {
  documentId: string;
  title: string;
  fileType: Document["fileType"];
  /** Epoch ms when the opening was recorded (actual open), or null. */
  openedAt: number | null;
  /** How the target was chosen; wording must follow this honestly. */
  source: "opened" | "modified";
}

export interface PaletteRecentState {
  status: "loading" | "ready" | "none";
  item: PaletteRecentItem | null;
}

export interface PaletteDueState {
  status: "loading" | "ready" | "unavailable";
  /** Eligible due cards for the active collection/deck. */
  dueCount: number;
}

export interface PaletteAssistantState {
  available: boolean;
  /** i18n key describing why the assistant is unavailable. */
  unavailableReasonKey?: string;
}

export type PaletteSuggestionRole = "themes" | "summary" | "related" | "review";

export type PaletteSuggestionIcon =
  | "sparkle"
  | "fileText"
  | "magnifyingGlass"
  | "cards";

export interface PaletteSuggestion {
  id: string;
  role: PaletteSuggestionRole;
  /** Complete prompt/question text (already translated/generic). */
  label: string;
  icon: PaletteSuggestionIcon;
  /** Document context, when the suggestion is document-specific. */
  documentId?: string;
  /** Query handed to Documents search for `related` suggestions. */
  query?: string;
  /** True when derived from user data; false for honest generic fallbacks. */
  personalized: boolean;
}

/** A resolved contextual action for the active view (pure descriptor). */
export interface PaletteContextualAction {
  view: ContextualViewType;
  actionId: ViewActionId;
  title: string;
  subtitle?: string;
  shortcutHint?: string;
}

export interface PaletteHomeModel {
  /** Active collection the model was derived for (stale-response guard). */
  collectionId: string | null;
  /** True when the library has no documents at all. */
  firstUse: boolean;
  resume: PaletteResumeState;
  recent: PaletteRecentState;
  due: PaletteDueState;
  assistant: PaletteAssistantState;
  suggestions: PaletteSuggestion[];
  /** Applicable "Actions in this view" descriptors, in priority order. */
  contextualActions: PaletteContextualAction[];
}

/* ------------------------------------------------------------------------- */
/* Mode classification                                                        */
/* ------------------------------------------------------------------------- */

export interface PaletteClassificationInput {
  query: string;
  scope: PaletteScope;
  /** True when an import URL is recognized (URL mode wins over everything). */
  isUrl: boolean;
  /** True while the note composer is active. */
  composingNote: boolean;
  /** True when callers explicitly opened the palette with a help query. */
  helpForced: boolean;
}

/**
 * Derive the body mode. Precedence: note composer → recognized URL → forced
 * help → typed search → home.
 */
export function classifyPaletteMode(
  input: PaletteClassificationInput
): PaletteInputMode {
  if (input.composingNote) return "note";
  if (input.isUrl) return "url";
  if (input.helpForced) return "help";
  if (input.query.trim().length > 0) return "search";
  return "home";
}
