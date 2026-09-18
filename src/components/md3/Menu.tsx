import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../utils/cn";

export interface MenuItemSpec {
  key: string;
  label: ReactNode;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
  keepOpen?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export interface MenuProps {
  items: MenuItemSpec[];
  /** Anchor element the menu positions against. */
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  label: string;
  align?: "start" | "end";
  className?: string;
  footer?: ReactNode;
}

/**
 * Material 3 menu rendered in a body portal at the md-z-menu layer.
 * Keyboard: ArrowUp/Down move focus, Home/End jump, Escape closes and
 * restores focus to the anchor, typeahead prefixes focus matching items.
 */
export function Menu({ items, anchorRef, open, onClose, label, align = "end", className, footer }: MenuProps) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    setPosition({
      top: anchor.bottom + 4,
      left: align === "end" ? anchor.right : anchor.left,
    });
  }, [open, anchorRef, align]);

  useLayoutEffect(() => {
    if (!open || !position || !menuRef.current || !anchorRef.current) return;
    const height = menuRef.current.offsetHeight;
    if (position.top + height <= window.innerHeight - 8) return;
    const above = anchorRef.current.getBoundingClientRect().top - height - 4;
    const top = Math.max(8, Math.min(above, window.innerHeight - height - 8));
    if (top !== position.top) setPosition({ ...position, top });
  }, [open, position, anchorRef]);

  const positioned = position !== null;
  useEffect(() => {
    if (!open || !positioned) return;
    const menu = menuRef.current;
    menu?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !anchorRef.current?.contains(target)) closeRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeRef.current();
        anchorRef.current?.focus();
        return;
      }
      if (!menuRef.current) return;
      const buttons = Array.from(
        menuRef.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      );
      if (buttons.length === 0) return;
      const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        buttons[(idx + 1 + buttons.length) % buttons.length].focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        buttons[(idx - 1 + buttons.length) % buttons.length].focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        buttons[0].focus();
      } else if (event.key === "End") {
        event.preventDefault();
        buttons[buttons.length - 1].focus();
      } else if (event.key.length === 1 && /\S/.test(event.key)) {
        const match = buttons.find((b) =>
          b.textContent?.toLowerCase().startsWith(event.key.toLowerCase()),
        );
        if (match) match.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, positioned, anchorRef]);

  if (!open || !position) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={{
        position: "fixed",
        top: Math.min(position.top, window.innerHeight - 16),
        left: align === "end" ? undefined : Math.max(8, position.left),
        right:
          align === "end"
            ? Math.max(8, window.innerWidth - position.left)
            : undefined,
        maxHeight: "min(24rem, calc(100vh - 2rem))",

      }}
      className={cn(
        "md-elevated-menu z-[var(--md-z-menu)] flex min-w-48 flex-col overflow-y-auto rounded-lg p-1",
        className,
      )}
      // Material menu surface: elevated container + shadow reserved for
      // floating layers (see elevation model, docs/design-system.md).
    >
      {items.map((item) => (
        <MenuItemRow key={item.key} item={item} onClose={onClose} />
      ))}
      {footer}
    </div>,
    document.body,
  );
}

function MenuItemRow({ item, onClose }: { item: MenuItemSpec; onClose: () => void }) {
  const IconCmp = item.icon;
  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      className={cn(
        "md-state flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-40",
        item.destructive
          ? "text-error hover:bg-error/10"
          : "text-on-surface hover:bg-surface-container-high",
      )}
      onClick={() => {
        item.onSelect();
        if (!item.keepOpen) onClose();
      }}
    >
      {item.leading}
      {IconCmp && <IconCmp className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="flex-1 truncate">{item.label}</span>
      {item.trailing}
    </button>
  );
}
