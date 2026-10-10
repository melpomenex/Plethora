/**
 * useSurfaceMenu — one trigger/dismiss/keyboard contract for every
 * app-wide right-click menu (change `app-wide-context-menus`).
 *
 * Thin wrapper over `useContextMenu` + `ContextMenu`:
 * - `openEvent` guards editable targets, suppresses the native menu,
 *   captures the trigger for focus return, and shows at the cursor.
 * - `handleRowKeyDown` opens the same menu on Shift+F10 / Menu key
 *   anchored to the focused row (keyboard equivalence).
 * - `bindLongPress` opens the same items on touch long-press and
 *   arranges for the press's trailing click to be swallowed, so a
 *   long-press never both opens the menu AND activates the row.
 * - `closeToTrigger` hides and returns focus to the trigger.
 *
 * Rendering stays in the caller so the menu can live next to its row:
 *
 *   const menu = useSurfaceMenu("review-deck-menu");
 *   <div onContextMenu={(e) => menu.openEvent(e, buildItems(deck))}
 *        onKeyDown={(e) => menu.handleRowKeyDown(e, () => buildItems(deck))} …>
 *   <ContextMenu menuId="review-deck-menu" items={menu.items}
 *     visible={menu.visible} position={menu.position}
 *     onClose={menu.closeToTrigger} />
 */

import { useCallback, useRef } from "react";
import {
  useContextMenu,
  type ContextMenuItem,
  type ContextMenuPosition,
} from "../components/common/ContextMenu";
import { LONG_PRESS_MS, shouldYieldRowMenu } from "../lib/contextMenus";
import { emitUserInteraction } from "../lib/feedback/orchestrator";
import { useLongPress } from "./useLongPress";

export interface SurfaceMenu {
  items: ContextMenuItem[];
  visible: boolean;
  position: ContextMenuPosition;
  /** Right-click / `contextmenu` entry. Returns false when yielding to native. */
  openEvent: (e: React.MouseEvent, items: ContextMenuItem[]) => boolean;
  /** Explicit-position entry (⋯ buttons, keyboard, long-press). */
  openPosition: (
    position: ContextMenuPosition,
    items: ContextMenuItem[],
    trigger?: HTMLElement | null,
  ) => void;
  /** Shift+F10 / Menu-key entry for focused rows. Returns true when handled. */
  handleRowKeyDown: (e: React.KeyboardEvent, getItems: () => ContextMenuItem[]) => boolean;
  /** Touch long-press entry returning row touch handlers. */
  bindLongPress: (getItems: () => ContextMenuItem[]) => {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    onTouchCancel: () => void;
  };
  /**
   * Row `onClick` guard: consumes a long-press trailing click.
   * Call first in the row click handler; when true, skip activation.
   */
  claimTouchMenu: () => boolean;
  /** Hide and return focus to the trigger that opened the menu. */
  closeToTrigger: () => void;
}

export function useSurfaceMenu(menuId: string): SurfaceMenu {
  const menu = useContextMenu(menuId);
  const triggerRef = useRef<HTMLElement | null>(null);
  const touchMenuRef = useRef(false);
  // Latest long-press payload (items builder + row trigger), captured at
  // touchstart so the shared timer callback opens the right row's menu.
  const pendingMenu = useRef<{
    getItems: () => ContextMenuItem[];
    trigger: HTMLElement | null;
  } | null>(null);

  const fireLongPressMenu = useCallback(
    (position: ContextMenuPosition) => {
      const pending = pendingMenu.current;
      if (!pending) return;
      pendingMenu.current = null;
      touchMenuRef.current = true;
      if (pending.trigger) triggerRef.current = pending.trigger;
      const items = pending.getItems();
      menu.showMenu(position, items);
      if (items.length) emitUserInteraction("interaction.context-activated");
      // Auto-release the swallow flag: a menu dismissed without a row
      // click must not eat the *next* unrelated tap.
      setTimeout(() => {
        touchMenuRef.current = false;
      }, 1500);
    },
    [menu],
  );

  const longPress = useLongPress(fireLongPressMenu, { threshold: LONG_PRESS_MS });

  const openPosition = useCallback(
    (position: ContextMenuPosition, items: ContextMenuItem[], trigger?: HTMLElement | null) => {
      if (trigger) triggerRef.current = trigger;
      menu.showMenu(position, items);
      if (items.length) emitUserInteraction("interaction.context-activated");
    },
    [menu],
  );

  const openEvent = useCallback(
    (e: React.MouseEvent, items: ContextMenuItem[]) => {
      if (shouldYieldRowMenu(e.target)) return false;
      e.preventDefault();
      e.stopPropagation();
      triggerRef.current = e.currentTarget as HTMLElement | null;
      menu.showMenu({ x: e.clientX, y: e.clientY }, items);
      if (items.length) emitUserInteraction("interaction.context-activated");
      return true;
    },
    [menu],
  );

  const closeToTrigger = useCallback(() => {
    menu.hideMenu();
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger) requestAnimationFrame(() => trigger.focus?.());
  }, [menu]);

  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent, getItems: () => ContextMenuItem[]) => {
      const isMenuKey = e.key === "ContextMenu";
      const isShiftF10 = e.shiftKey && (e.key === "F10" || e.key === "F10".toLowerCase());
      if (!isMenuKey && !isShiftF10) return false;
      const el = e.currentTarget as HTMLElement | null;
      if (!el) return false;
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      triggerRef.current = el;
      const items = getItems();
      menu.showMenu({ x: rect.left + 16, y: rect.bottom + 4 }, items);
      if (items.length) emitUserInteraction("interaction.context-activated");
      return true;
    },
    [menu],
  );

  const bindLongPress = useCallback(
    (getItems: () => ContextMenuItem[]) => ({
      onTouchStart: (e: React.TouchEvent) => {
        pendingMenu.current = { getItems, trigger: e.currentTarget as HTMLElement | null };
        longPress.onTouchStart(e);
      },
      onTouchMove: (e: React.TouchEvent) => longPress.onTouchMove(e),
      onTouchEnd: () => {
        const fired = longPress.didFire();
        longPress.onTouchEnd();
        if (!fired) pendingMenu.current = null;
      },
      onTouchCancel: () => {
        longPress.onTouchCancel();
        pendingMenu.current = null;
      },
    }),
    [longPress],
  );

  const claimTouchMenu = useCallback(() => {
    if (!touchMenuRef.current) return false;
    touchMenuRef.current = false;
    return true;
  }, []);

  return {
    items: menu.items,
    visible: menu.visible,
    position: menu.position,
    openEvent,
    openPosition,
    handleRowKeyDown,
    bindLongPress,
    claimTouchMenu,
    closeToTrigger,
  };
}
