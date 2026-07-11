/**
 * Context menu system
 * Provides right-click context menus for various elements
 */

import { useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { useMobileShell } from "../../hooks/useMobileShell";
import { MobileContextMenuSheet, mobileSheetItemClass } from "./MobileContextMenuSheet";

/**
 * Context menu item type
 */
export enum ContextMenuItemType {
  Normal = "normal",
  Separator = "separator",
  Submenu = "submenu",
  Checkbox = "checkbox",
  Radio = "radio",
  Danger = "danger",
}

/**
 * Context menu item
 */
export interface ContextMenuItem {
  id: string;
  type?: ContextMenuItemType;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  onClick?: () => void;
  children?: ContextMenuItem[];
}

/**
 * Context menu position
 */
export interface ContextMenuPosition {
  x: number;
  y: number;
}

/**
 * Context menu state
 */
interface ContextMenuState {
  visible: boolean;
  position: ContextMenuPosition;
  items: ContextMenuItem[];
  parentId?: string;
}

/**
 * Context menu store
 */
interface ContextMenuStore {
  menus: Map<string, ContextMenuState>;
  showMenu: (id: string, position: ContextMenuPosition, items: ContextMenuItem[]) => void;
  hideMenu: (id: string) => void;
  hideAll: () => void;
  subscribe: (listener: (id: string) => void) => () => void;
}

const createContextMenuStore = () => {
  const menus = new Map<string, ContextMenuState>();
  const listeners = new Set<(id: string) => void>();

  const notify = (id: string) => {
    listeners.forEach((listener) => listener(id));
  };

  let store: ContextMenuStore = {
    menus,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    showMenu: (id, position, items) => {
      // Hide all other menus first
      menus.forEach((menu, existingId) => {
        if (existingId !== id && menu.visible) {
          menus.set(existingId, { ...menu, visible: false });
          notify(existingId);
        }
      });

      const existing = menus.get(id);
      menus.set(id, {
        visible: true,
        position,
        items,
        parentId: existing?.parentId,
      });
      notify(id);
    },
    hideMenu: (id) => {
      const menu = menus.get(id);
      if (menu) {
        menus.set(id, { ...menu, visible: false });
        notify(id);
      }
    },
    hideAll: () => {
      menus.forEach((menu, id) => {
        if (menu.visible) {
          menus.set(id, { ...menu, visible: false });
          notify(id);
        }
      });
    },
  };
  return store;
};

const contextMenuStore = createContextMenuStore();

/**
 * Hook to use context menu
 */
export function useContextMenu(menuId: string) {
  const [state, setState] = useState<ContextMenuState>({
    visible: false,
    position: { x: 0, y: 0 },
    items: [],
  });

  useEffect(() => {
    const current = contextMenuStore.menus.get(menuId);
    if (current) {
      setState(current);
    }

    const unsubscribe = contextMenuStore.subscribe((id) => {
      if (id === menuId) {
        const updated = contextMenuStore.menus.get(menuId);
        if (updated) {
          setState({ ...updated });
        }
      }
    });

    return unsubscribe;
  }, [menuId]);

  const showMenu = useCallback((position: ContextMenuPosition, items: ContextMenuItem[]) => {
    contextMenuStore.showMenu(menuId, position, items);
  }, [menuId]);

  const hideMenu = useCallback(() => {
    contextMenuStore.hideMenu(menuId);
  }, [menuId]);

  return {
    visible: state.visible,
    position: state.position,
    items: state.items,
    showMenu,
    hideMenu,
  };
}

/**
 * Context menu component
 */
export function ContextMenu({
  menuId,
  items,
  visible,
  position,
  onClose,
}: {
  menuId: string;
  items: ContextMenuItem[];
  visible: boolean;
  position: ContextMenuPosition;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [submenuState, setSubmenuState] = useState<{
    itemId: string | null;
    position: ContextMenuPosition;
  } | null>(null);

  // Adjust position if menu goes off screen
  const adjustedPosition = useCallback(() => {
    if (!menuRef.current) return position;

    const rect = menuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = position.x;
    let y = position.y;

    if (x + rect.width > viewportWidth) {
      x = viewportWidth - rect.width - 8;
    }

    if (y + rect.height > viewportHeight) {
      y = viewportHeight - rect.height - 8;
    }

    return { x, y };
  }, [position]);

  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const menu = menuRef.current;
      if (!menu) return;

      const focusableItems = menu.querySelectorAll<HTMLElement>(
        "[role^='menuitem']:not([disabled])"
      );
      const currentIndex = Array.from(focusableItems).findIndex(
        (item) => item === document.activeElement
      );

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const nextIndex = (currentIndex + 1) % focusableItems.length;
          focusableItems[nextIndex]?.focus();
          break;
        }

        case "ArrowUp": {
          e.preventDefault();
          const prevIndex =
            (currentIndex - 1 + focusableItems.length) % focusableItems.length;
          focusableItems[prevIndex]?.focus();
          break;
        }

        case "Enter":
        case " ":
          e.preventDefault();
          (document.activeElement as HTMLElement)?.click();
          break;

        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visible, onClose]);

  useEffect(() => {
    if (!visible) return;

    const handleOutsideInteraction = (e: MouseEvent | TouchEvent) => {
      const menu = menuRef.current;
      if (!menu) return;

      if (!menu.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleDismissal = () => {
      onClose();
    };

    document.addEventListener("mousedown", handleOutsideInteraction);
    document.addEventListener("pointerdown", handleOutsideInteraction);
    document.addEventListener("contextmenu", handleOutsideInteraction);

    document.addEventListener("scroll", handleDismissal, { capture: true });
    window.addEventListener("resize", handleDismissal);
    window.addEventListener("blur", handleDismissal);
    document.addEventListener("visibilitychange", handleDismissal);

    // Also attach to all same-origin iframes on the page (e.g. EPUB/document viewer iframes)
    const iframes = Array.from(document.querySelectorAll("iframe"));
    const attachedDocuments: Document[] = [];

    iframes.forEach((iframe) => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc) {
          iframeDoc.addEventListener("mousedown", handleOutsideInteraction);
          iframeDoc.addEventListener("pointerdown", handleOutsideInteraction);
          iframeDoc.addEventListener("contextmenu", handleOutsideInteraction);
          iframeDoc.addEventListener("scroll", handleDismissal, { capture: true });
          attachedDocuments.push(iframeDoc);
        }
      } catch (err) {
        // Cross-origin iframe, ignore security errors
        console.warn("Could not attach context menu listeners to iframe", err);
      }
    });

    return () => {
      document.removeEventListener("mousedown", handleOutsideInteraction);
      document.removeEventListener("pointerdown", handleOutsideInteraction);
      document.removeEventListener("contextmenu", handleOutsideInteraction);
      document.removeEventListener("scroll", handleDismissal, { capture: true });
      window.removeEventListener("resize", handleDismissal);
      window.removeEventListener("blur", handleDismissal);
      document.removeEventListener("visibilitychange", handleDismissal);

      attachedDocuments.forEach((iframeDoc) => {
        try {
          iframeDoc.removeEventListener("mousedown", handleOutsideInteraction);
          iframeDoc.removeEventListener("pointerdown", handleOutsideInteraction);
          iframeDoc.removeEventListener("contextmenu", handleOutsideInteraction);
          iframeDoc.removeEventListener("scroll", handleDismissal, { capture: true });
        } catch {
          // Ignore
        }
      });
    };
  }, [visible, onClose]);

  // ---- Mobile: bottom-sheet presentation ----
  // On phones we render the native-Android-style bottom sheet instead of a
  // floating menu. The sheet's full-screen scrim makes "tap anywhere to close"
  // robust (the core UX fix). Submenus become a drill-in stack with a back
  // button instead of hover flyouts (hover doesn't exist on touch).
  const isMobile = useMobileShell();
  const [mobileSubmenuStack, setMobileSubmenuStack] = useState<ContextMenuItem[]>([]);
  // Reset the drill-in stack each time the menu (re)opens.
  useEffect(() => {
    if (visible) setMobileSubmenuStack([]);
  }, [visible]);

  if (!visible) return null;

  if (isMobile) {
    // The list of items currently in view: the top-level items, or — if the
    // user drilled into a submenu — that submenu's children.
    const currentItems = mobileSubmenuStack.length > 0
      ? mobileSubmenuStack[mobileSubmenuStack.length - 1].children ?? []
      : items;
    const depth = mobileSubmenuStack.length;

    return (
      <MobileContextMenuSheet
        open={visible}
        onClose={() => {
          if (depth > 0) {
            setMobileSubmenuStack((s) => s.slice(0, -1));
          } else {
            onClose();
          }
        }}
        title={
          depth > 0 ? (
            <span className="flex items-center gap-2">
              <button
                className="p-1 -ml-1 rounded active:bg-muted"
                onClick={() => setMobileSubmenuStack((s) => s.slice(0, -1))}
                aria-label="Back"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span className="truncate">{mobileSubmenuStack[depth - 1].label}</span>
            </span>
          ) : undefined
        }
      >
        {currentItems.map((item, index) => {
          if (item.type === ContextMenuItemType.Separator) {
            return <div key={`sep-${index}`} className="h-px bg-border my-1" />;
          }
          const hasSubmenu = item.children && item.children.length > 0;
          const isDanger = item.type === ContextMenuItemType.Danger;
          return (
            <button
              key={item.id}
              className={
                mobileSheetItemClass +
                (isDanger ? " text-destructive active:bg-destructive/10" : "") +
                (item.disabled ? " opacity-50" : "")
              }
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                if (hasSubmenu) {
                  setMobileSubmenuStack((s) => [...s, item]);
                } else {
                  item.onClick?.();
                  onClose();
                }
              }}
            >
              {item.icon && (
                <span className="w-5 h-5 flex items-center justify-center text-muted-foreground">
                  {item.icon}
                </span>
              )}
              <span className="flex-1 truncate">{item.label}</span>
              {hasSubmenu && (
                <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </button>
          );
        })}
      </MobileContextMenuSheet>
    );
  }

  // ---- Desktop: floating menu (unchanged) ----

  const pos = adjustedPosition();

  return (
    <>
      <div
        ref={menuRef}
        className="context-menu fixed z-50 min-w-48 py-1 bg-card border border-border rounded-lg shadow-lg"
        style={{
          left: pos.x,
          top: pos.y,
        }}
        role="menu"
        tabIndex={-1}
      >
        {items.map((item, index) => {
          if (item.type === ContextMenuItemType.Separator) {
            return (
              <hr
                key={`separator-${index}`}
                className="my-1 border-t border-border"
              />
            );
          }

          const hasSubmenu = item.children && item.children.length > 0;

          return (
            <div
              key={item.id}
              className="relative"
              onMouseEnter={(e) => {
                if (hasSubmenu && menuRef.current) {
                  const menuRect = menuRef.current.getBoundingClientRect();
                  const itemRect = e.currentTarget.getBoundingClientRect();
                  setSubmenuState({
                    itemId: item.id,
                    position: {
                      x: menuRect.right - 4,
                      y: itemRect.top,
                    },
                  });
                }
              }}
              onMouseLeave={() => {
                if (hasSubmenu) {
                  setSubmenuState(null);
                }
              }}
            >
              <button
                className={`
                  w-full px-3 py-2 flex items-center gap-2 text-left text-sm
                  hover:bg-muted transition-colors
                  ${item.disabled ? "opacity-50 cursor-not-allowed" : ""}
                  ${item.type === ContextMenuItemType.Danger ? "text-destructive hover:bg-destructive/10" : "text-foreground"}
                  ${item.checked ? "bg-muted/50" : ""}
                `}
                role="menuitem"
                tabIndex={index === 0 ? 0 : -1}
                disabled={item.disabled}
                onClick={(e) => {
                  if (!item.disabled) {
                    if (hasSubmenu) {
                      if (menuRef.current) {
                        const menuRect = menuRef.current.getBoundingClientRect();
                        const itemRect = e.currentTarget.getBoundingClientRect();
                        setSubmenuState(
                          submenuState?.itemId === item.id
                            ? null
                            : {
                                itemId: item.id,
                                position: {
                                  x: menuRect.right - 4,
                                  y: itemRect.top,
                                },
                              }
                        );
                      }
                    } else {
                      item.onClick?.();
                      onClose();
                    }
                  }
                }}
              >
                {/* Checkbox/Radio indicator */}
                {(item.type === ContextMenuItemType.Checkbox ||
                  item.type === ContextMenuItemType.Radio) && (
                  <span className="w-4 h-4 flex items-center justify-center">
                    {item.checked && (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </span>
                )}

                {/* Icon */}
                {item.icon && (
                  <span className="w-4 h-4 flex items-center justify-center text-muted-foreground">
                    {item.icon}
                  </span>
                )}

                {/* Label */}
                <span className="flex-1">{item.label}</span>

                {/* Shortcut */}
                {item.shortcut && (
                  <span className="text-xs text-muted-foreground">{item.shortcut}</span>
                )}

                {/* Submenu indicator */}
                {hasSubmenu && (
                  <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </button>

              {/* Submenu */}
              {hasSubmenu && submenuState && submenuState.itemId === item.id && (
                <ContextMenu
                  menuId={`${menuId}-${submenuState.itemId}`}
                  items={item.children || []}
                  visible={true}
                  position={submenuState.position}
                  onClose={() => {
                    setSubmenuState(null);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * Context menu provider
 */
export function ContextMenuProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/**
 * Hook to create context menu handler
 */
export function useContextMenuHandler(menuId: string, items: ContextMenuItem[]) {
  const { showMenu } = useContextMenu(menuId);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      showMenu({ x: e.clientX, y: e.clientY }, items);
    },
    [showMenu, items]
  );

  return { handleContextMenu };
}

/**
 * Higher-order component to add context menu
 */
export function withContextMenu<P extends object>(
  Component: React.ComponentType<P>,
  items: ContextMenuItem[],
  menuId?: string
) {
  return function ContextMenuWrapper(props: P) {
    const id = menuId || `context-menu-${Math.random().toString(36).substr(2, 9)}`;
    const { handleContextMenu } = useContextMenuHandler(id, items);

    return (
      <div onContextMenu={handleContextMenu}>
        <Component {...props} />
      </div>
    );
  };
}

/**
 * Common context menus
 */
export const CommonContextMenus = {
  text: [
    { id: "copy", label: "Copy", shortcut: "Ctrl+C", type: ContextMenuItemType.Normal },
    { id: "cut", label: "Cut", shortcut: "Ctrl+X", type: ContextMenuItemType.Normal },
    { id: "paste", label: "Paste", shortcut: "Ctrl+V", type: ContextMenuItemType.Normal },
    { id: "sep1", type: ContextMenuItemType.Separator },
    { id: "select-all", label: "Select All", shortcut: "Ctrl+A", type: ContextMenuItemType.Normal },
  ],

  document: [
    { id: "open", label: "Open", type: ContextMenuItemType.Normal },
    { id: "sep1", type: ContextMenuItemType.Separator },
    { id: "edit", label: "Edit", type: ContextMenuItemType.Normal },
    { id: "duplicate", label: "Duplicate", type: ContextMenuItemType.Normal },
    { id: "sep2", type: ContextMenuItemType.Separator },
    { id: "delete", label: "Delete", shortcut: "Del", type: ContextMenuItemType.Danger },
  ],

  folder: [
    { id: "open", label: "Open", type: ContextMenuItemType.Normal },
    { id: "sep1", type: ContextMenuItemType.Separator },
    { id: "new-folder", label: "New Folder", type: ContextMenuItemType.Normal },
    { id: "new-document", label: "New Document", type: ContextMenuItemType.Normal },
    { id: "sep2", type: ContextMenuItemType.Separator },
    { id: "rename", label: "Rename", type: ContextMenuItemType.Normal },
    { id: "delete", label: "Delete", shortcut: "Del", type: ContextMenuItemType.Danger },
  ],

  flashcard: [
    { id: "edit", label: "Edit", type: ContextMenuItemType.Normal },
    { id: "sep1", type: ContextMenuItemType.Separator },
    { id: "suspend", label: "Suspend", type: ContextMenuItemType.Checkbox },
    { id: "bury", label: "Bury", type: ContextMenuItemType.Checkbox },
    { id: "mark-new", label: "Mark as New", type: ContextMenuItemType.Normal },
    { id: "sep2", type: ContextMenuItemType.Separator },
    { id: "delete", label: "Delete", shortcut: "Del", type: ContextMenuItemType.Danger },
  ],

  link: [
    { id: "open", label: "Open Link", type: ContextMenuItemType.Normal },
    { id: "open-new-tab", label: "Open in New Tab", type: ContextMenuItemType.Normal },
    { id: "sep1", type: ContextMenuItemType.Separator },
    { id: "copy-link", label: "Copy Link Address", type: ContextMenuItemType.Normal },
  ],
};
