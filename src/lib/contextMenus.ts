/**
 * contextMenus — shared app-wide context-menu contract.
 *
 * Pure, UI-free helpers behind every right-click menu in the app
 * (see openspec change `app-wide-context-menus`):
 * - trigger/yield rules (when the native menu keeps precedence),
 * - viewport clamping,
 * - canonical per-surface item ORDER (components map ids to items),
 * - postponability gating shared with QueueContextMenu.
 *
 * Components render through `src/components/common/ContextMenu.tsx`
 * (desktop popover + mobile bottom-sheet parity) via `useSurfaceMenu`.
 * Nothing here touches React, so it is unit-testable with node.
 */

export const LONG_PRESS_MS = 500;

/** Elements whose native right-click menu always wins. */
export const EDITABLE_SELECTOR =
  'input,textarea,select,[contenteditable="true"],[contenteditable=""]';

/** Media/link elements the viewer menus own — list rows yield to them. */
const VIEWER_OWNED_SELECTOR = "a[href],img,video,audio,canvas,iframe";

/**
 * True when a `contextmenu` event target owns its native menu
 * (text fields, links, media). Callers showing an object menu
 * should return early and let the browser menu appear.
 */
export function shouldYieldToNative(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(EDITABLE_SELECTOR)) return true;
  if (target.closest(VIEWER_OWNED_SELECTOR)) return true;
  return false;
}

/**
 * True when a list-row object menu may open: anything except an
 * in-progress edit. Links/media inside rows are covered by the row's
 * own Open/Copy-link items, so only editables yield here.
 */
export function shouldYieldRowMenu(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(EDITABLE_SELECTOR));
}

export interface ClampSize {
  w: number;
  h: number;
}

export interface ViewportSize {
  w: number;
  h: number;
}

/**
 * Clamp a menu origin into the viewport with a margin.
 * Pure equivalent of the in-component `adjustedPosition` logic.
 */
export function clampMenuPosition(
  x: number,
  y: number,
  menu: ClampSize,
  viewport: ViewportSize,
  margin = 8,
): { x: number; y: number } {
  const maxX = Math.max(margin, viewport.w - menu.w - margin);
  const maxY = Math.max(margin, viewport.h - menu.h - margin);
  return {
    x: Math.min(Math.max(x, margin), maxX),
    y: Math.min(Math.max(y, margin), maxY),
  };
}

// ---------------------------------------------------------------------------
// Canonical item orders. Each builder returns item ids in display order,
// including `"sep:<n>"` separator markers. Components map ids to full
// ContextMenuItems (labels, icons, handlers) — the order array is the
// single source of truth asserted by unit tests.
// ---------------------------------------------------------------------------

export interface DeckMenuOptions {
  /** Deck holds zero cards: Start/Preview show disabled. */
  isEmpty: boolean;
  /** Deck is the exclusive active focus: offer Clear instead of Set. */
  isActiveFocus: boolean;
}

/** Review deck rows — spec-exact order (Start → Preview → Focus → Rename → Tags → Export → Delete). */
export function deckMenuItemIds(_opts: DeckMenuOptions): string[] {
  void _opts;
  return [
    "start-review",
    "preview-cards",
    "toggle-focus",
    "rename",
    "edit-tags",
    "export-apkg",
    "sep:1",
    "delete",
  ];
}

export type PostponableItemType = "learning-item" | "document";

/** Mirrors QueueContextMenu's `canPostpone` rule — keep in sync. */
export function canPostponeQueueItemType(itemType: string): boolean {
  return itemType === "learning-item" || itemType === "document";
}

/** Queue rows — identical set to the ⋯ button (single-sourced in queue.tsx). */
export function queueMenuItemIds(itemType: string, hasEditHandler: boolean): string[] {
  const ids = ["start-review"];
  if (itemType === "learning-item" && hasEditHandler) ids.push("edit-card");
  if (canPostponeQueueItemType(itemType)) ids.push("postpone");
  ids.push("mark-done", "copy-title", "sep:1", "remove");
  return ids;
}

export interface RssArticleMenuOptions {
  read: boolean;
  favorite: boolean;
  hasFullContent: boolean;
}

/** RSS article rows — read state flips the toggle label (never both). */
export function rssArticleMenuItemIds(opts: RssArticleMenuOptions): string[] {
  const ids = ["open", opts.read ? "mark-unread" : "mark-read"];
  ids.push(opts.favorite ? "remove-favorite" : "add-favorite");
  if (!opts.hasFullContent) ids.push("fetch-full");
  ids.push("tag", "copy-link", "open-original", "sep:1", "mark-all-read");
  return ids;
}

/** RSS feed (sidebar) rows. */
export function rssFeedMenuItemIds(): string[] {
  return ["refresh", "mark-all-read", "copy-feed-url", "sep:1", "rename", "sep:2", "unsubscribe"];
}

/** Tag pills in the Deck Tag Manager. */
export function deckTagMenuItemIds(): string[] {
  return ["copy-tag", "remove-tag"];
}

/** Per-document learning-card rows (LearningCardsList). */
export function flashcardMenuItemIds(): string[] {
  return ["edit", "preview", "copy-question", "sep:1", "delete"];
}

/** Toolbar rail buttons — background entry only when supported. */
export function toolbarMenuItemIds(hasBackgroundAction: boolean): string[] {
  return hasBackgroundAction ? ["open", "open-background"] : ["open"];
}

/** Document Q&A citation chips. */
export function docQACitationMenuItemIds(): string[] {
  return ["open-source", "copy-citation"];
}
