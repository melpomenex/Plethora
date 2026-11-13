import { useCallback, useId, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import {
  useContextMenu,
  type ContextMenuCloseReason,
  type ContextMenuItem,
} from '../common/ContextMenu';

export function isContextMenuNativeTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    "button, a[href], input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"
  ));
}

export function useStudyPlanContextMenu(menuId: string) {
  const instanceMenuId = `${menuId}-${useId()}`;
  const menu = useContextMenu(instanceMenuId);
  const targetRef = useRef<HTMLElement | null>(null);
  const ownerRef = useRef<HTMLDivElement>(null);

  const openMenu = useCallback((event: ReactMouseEvent<HTMLElement>, items: ContextMenuItem[]) => {
    if (isContextMenuNativeTarget(event.target) || items.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    targetRef.current = event.currentTarget;
    menu.showMenu({ x: event.clientX, y: event.clientY }, items);
  }, [menu.showMenu]);

  const closeMenu = useCallback((reason?: ContextMenuCloseReason) => {
    menu.hideMenu();
    if (reason === 'action' || reason === 'escape') {
      const target = targetRef.current;
      if (target?.isConnected) target.focus();
      else ownerRef.current?.focus();
    }
  }, [menu.hideMenu]);

  return { ...menu, menuId: instanceMenuId, ownerRef, openMenu, closeMenu };
}
