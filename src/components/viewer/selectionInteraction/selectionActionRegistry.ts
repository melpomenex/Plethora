/**
 * selectionActionRegistry — the single authoritative definition of the
 * actions offered on a text selection (change:
 * hyperlink-selection-context-actions, design decision D1).
 *
 * Every selection menu surface — the compact anchored bar, the mobile
 * action sheet, and the desktop context menu — derives its items (ids,
 * labels, icons, ordering, availability gating) from this module instead of
 * enumerating them locally. Handlers stay with the host because they close
 * over viewer state; they route by action id, so adding an action is one
 * descriptor here plus one handler route in the host.
 */

import type { Icon } from "@phosphor-icons/react";
import {
  ChalkboardTeacher,
  Copy,
  GraduationCap,
  Highlighter,
  Lightbulb,
  ListBullets,
  Question,
  Sparkle,
  SpeakerHigh,
  TextAa,
  TextAlignLeft,
  TextT,
  Translate,
  TreeStructure,
} from "@phosphor-icons/react";

/** Every selection action id across all menu surfaces. */
export type SelectionActionId =
  | "summarize"
  | "explain"
  | "simplify"
  | "keyTerms"
  | "ask"
  | "readFromHere"
  | "extract"
  | "extractDialog"
  | "highlight"
  | "copy"
  | "dictionary"
  | "flashcard"
  | "learnThis"
  | "askLibrary"
  | "socraticTutor"
  | "prerequisites";

/** The menu surfaces that derive their items from this registry. */
export type SelectionActionSurface = "bar" | "menu" | "sheet";

/** AI passage actions runnable against a selection. */
export type SelectionAiAction = Extract<
  SelectionActionId,
  "explain" | "summarize" | "simplify" | "keyTerms" | "ask"
>;

/** Bar-invocable actions (Learn-this routes through its own host callback). */
export type SelectionBarAction = Extract<
  SelectionActionId,
  "summarize" | "explain" | "ask" | "readFromHere" | "extract" | "copy"
>;

/**
 * What a host tells the registry about the current selection context.
 * All flags are optional; unspecified flags disable their actions.
 */
export interface SelectionActionAvailability {
  /** A usable AI provider path exists (cloud or on-device). */
  aiAvailable?: boolean;
  /** The surface can create extracts (transcripts cannot). Default true. */
  canExtract?: boolean;
  /** The surface can map the selection to a TTS start anchor. */
  canReadAloud?: boolean;
  /** "Learn this" feature flag. */
  learnThisEnabled?: boolean;
  /** The bar's host wired the Learn-this proposal UI. */
  learnThisHandlerAvailable?: boolean;
  /** Ask-library RAG feature flag (sheet only). */
  libraryRagEnabled?: boolean;
  /** Socratic tutor feature flag (sheet only). */
  socraticTutorEnabled?: boolean;
  /** Prerequisite analysis feature flag (sheet only). */
  prerequisitesEnabled?: boolean;
}

export interface SelectionActionDescriptor {
  id: SelectionActionId;
  icon: Icon;
  /**
   * Per-surface i18n label keys. Surfaces phrase the same action
   * differently (bar "selectionSheet.copy" vs menu "viewer.copy"), but each
   * key is defined exactly once here.
   */
  labelKeys: Partial<Record<SelectionActionSurface, string>>;
  /**
   * Position on each surface that shows this action. Absent = the action
   * does not appear on that surface.
   */
  order: Partial<Record<SelectionActionSurface, number>>;
  /**
   * Menu separator groups: the desktop context menu inserts a separator
   * between consecutive items of different groups.
   */
  menuGroup?: number;
  isAvailable(surface: SelectionActionSurface, availability: SelectionActionAvailability): boolean;
}

function aiActions(_surface: SelectionActionSurface, a: SelectionActionAvailability): boolean {
  return Boolean(a.aiAvailable);
}

const always = () => true;

export const SELECTION_ACTIONS: readonly SelectionActionDescriptor[] = [
  {
    id: "summarize",
    icon: TextAlignLeft,
    labelKeys: { bar: "selectionSheet.summarize", menu: "selectionSheet.summarize", sheet: "selectionSheet.summarize" },
    order: { bar: 0, menu: 7, sheet: 3 },
    menuGroup: 4,
    isAvailable: aiActions,
  },
  {
    id: "explain",
    icon: Lightbulb,
    labelKeys: { bar: "selectionSheet.explain", menu: "selectionSheet.explain", sheet: "selectionSheet.explain" },
    order: { bar: 1, menu: 6, sheet: 2 },
    menuGroup: 4,
    isAvailable: aiActions,
  },
  {
    id: "learnThis",
    icon: GraduationCap,
    labelKeys: { bar: "aiLearning.learnThis", menu: "aiLearning.learnThis", sheet: "aiLearning.learnThis" },
    order: { bar: 2, menu: 11, sheet: 7 },
    menuGroup: 4,
    // Bar: the host-wired proposal UI must exist. Menu/sheet: feature flag.
    isAvailable: (surface, a) =>
      aiActions(surface, a) && (surface === "bar" ? Boolean(a.learnThisHandlerAvailable) : Boolean(a.learnThisEnabled)),
  },
  {
    id: "ask",
    icon: Question,
    labelKeys: { bar: "selectionBar.ask", menu: "selectionSheet.ask", sheet: "selectionSheet.ask" },
    order: { bar: 3, menu: 10, sheet: 6 },
    menuGroup: 4,
    isAvailable: aiActions,
  },
  {
    id: "simplify",
    icon: TextAa,
    labelKeys: { menu: "selectionSheet.simplify", sheet: "selectionSheet.simplify" },
    order: { menu: 8, sheet: 4 },
    menuGroup: 4,
    isAvailable: aiActions,
  },
  {
    id: "keyTerms",
    icon: ListBullets,
    labelKeys: { menu: "selectionSheet.keyTerms", sheet: "selectionSheet.keyTerms" },
    order: { menu: 9, sheet: 5 },
    menuGroup: 4,
    isAvailable: aiActions,
  },
  {
    id: "readFromHere",
    icon: SpeakerHigh,
    labelKeys: { bar: "selectionBar.readFromHere" },
    order: { bar: 4 },
    isAvailable: (_, a) => Boolean(a.canReadAloud),
  },
  {
    id: "extract",
    icon: Lightbulb,
    labelKeys: { bar: "selectionSheet.createExtract", menu: "viewer.createExtract", sheet: "selectionSheet.createExtract" },
    order: { bar: 5, menu: 0, sheet: 0 },
    menuGroup: 1,
    isAvailable: (_, a) => a.canExtract !== false,
  },
  {
    id: "extractDialog",
    icon: TextT,
    labelKeys: { menu: "viewer.addNote" },
    order: { menu: 1 },
    menuGroup: 1,
    isAvailable: always,
  },
  {
    id: "highlight",
    icon: Highlighter,
    labelKeys: { menu: "viewer.highlight" },
    order: { menu: 2 },
    menuGroup: 1,
    isAvailable: always,
  },
  {
    id: "copy",
    icon: Copy,
    labelKeys: { bar: "selectionSheet.copy", menu: "viewer.copy", sheet: "selectionSheet.copy" },
    order: { bar: 6, menu: 3, sheet: 1 },
    menuGroup: 2,
    isAvailable: always,
  },
  {
    id: "dictionary",
    icon: Translate,
    labelKeys: { menu: "viewer.lookupDictionaryThesaurus" },
    order: { menu: 4 },
    menuGroup: 2,
    isAvailable: always,
  },
  {
    id: "flashcard",
    icon: Sparkle,
    labelKeys: { menu: "extractScrollItem.createFlashcard" },
    order: { menu: 5 },
    menuGroup: 3,
    isAvailable: always,
  },
  {
    id: "askLibrary",
    icon: Sparkle,
    labelKeys: { sheet: "aiLibrary.askLibrary" },
    order: { sheet: 8 },
    menuGroup: 4,
    isAvailable: (surface, a) => aiActions(surface, a) && Boolean(a.libraryRagEnabled),
  },
  {
    id: "socraticTutor",
    icon: ChalkboardTeacher,
    labelKeys: { sheet: "aiTutor.title" },
    order: { sheet: 9 },
    menuGroup: 4,
    isAvailable: (surface, a) => aiActions(surface, a) && Boolean(a.socraticTutorEnabled),
  },
  {
    id: "prerequisites",
    icon: TreeStructure,
    labelKeys: { sheet: "aiLearning.prerequisites" },
    order: { sheet: 10 },
    menuGroup: 4,
    isAvailable: (surface, a) => aiActions(surface, a) && Boolean(a.prerequisitesEnabled),
  },
];

const DESCRIPTORS_BY_ID = new Map(SELECTION_ACTIONS.map((d) => [d.id, d]));

export function getSelectionAction(id: SelectionActionId): SelectionActionDescriptor | undefined {
  return DESCRIPTORS_BY_ID.get(id);
}

/**
 * The ordered, availability-filtered action list for one menu surface.
 * Order comes from each descriptor's `order[surface]`; actions without a
 * position on that surface never appear.
 */
export function getSelectionActions(
  surface: SelectionActionSurface,
  availability: SelectionActionAvailability = {},
): SelectionActionDescriptor[] {
  return SELECTION_ACTIONS.filter(
    (d) => d.order[surface] !== undefined && d.isAvailable(surface, availability),
  ).sort((a, b) => (a.order[surface] ?? 0) - (b.order[surface] ?? 0));
}

/** The label key an action uses on a surface (falls back to any defined key). */
export function selectionActionLabelKey(
  action: SelectionActionDescriptor,
  surface: SelectionActionSurface,
): string {
  return action.labelKeys[surface] ?? Object.values(action.labelKeys)[0] ?? action.id;
}

/**
 * Whether an action belongs to the AI section (menu group 4): all AI
 * passage actions plus the sheet's AI-powered extras. The action sheet
 * renders these under its "AI" heading; the desktop context menu separates
 * the group with a leading separator.
 */
export function isAiSelectionAction(action: SelectionActionDescriptor): boolean {
  return action.menuGroup === 4;
}
