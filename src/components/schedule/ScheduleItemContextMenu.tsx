import { useEffect, useRef, useState, memo } from "react";
import { createPortal } from "react-dom";
import {
  CalendarHeart,
  EyeSlash,
  Pause,
  Play,
  Trash,
} from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";
import type { ScheduleDayItem } from "../../types/queue";
import {
  actionAppliesTo,
  runScheduleAction,
  runPostpone,
  POSTPONE_PRESETS,
  type ScheduleActionCallbacks,
} from "../../lib/scheduleActions";

interface ScheduleItemContextMenuProps {
  /** Anchor position in viewport coordinates, or null when closed. */
  position: { x: number; y: number } | null;
  item: ScheduleDayItem;
  callbacks: ScheduleActionCallbacks;
  onClose: () => void;
}

/**
 * Portaled context menu using the shared action contract. Portaled to
 * document.body so transformed/virtualized ancestors cannot change its
 * positioning. Dismisses on outside click, scroll, and Escape, and clamps to
 * the viewport.
 */
export const ScheduleItemContextMenu = memo(function ScheduleItemContextMenu({
  position,
  item,
  callbacks,
  onClose,
}: ScheduleItemContextMenuProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<{ left: number; top: number } | null>(null);

  // Dismissal: outside click, scroll (capture), Escape.
  useEffect(() => {
    if (!position) return;
    const handleClick = () => onClose();
    const handleScroll = () => onClose();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Delay listener to avoid the right-click event itself closing the menu.
    const timer = setTimeout(() => {
      document.addEventListener("click", handleClick);
      document.addEventListener("scroll", handleScroll, true);
      document.addEventListener("keydown", handleKeyDown);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClick);
      document.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [position, onClose]);

  // Viewport clamping after the menu has rendered (layout measurement).
  useEffect(() => {
    if (!position || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    let { x, y } = position;
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
    if (x < 4) x = 4;
    if (y < 4) y = 4;
    setStyle({ left: x, top: y });
  }, [position]);

  if (!position) return null;

  const menuButtonClass = cn(
    "w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted/80",
    "flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:bg-muted/80",
  );

  const menuItem = (
    key: string,
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    className?: string,
  ) => (
    <button key={key} type="button" className={cn(menuButtonClass, className)} onClick={onClick}>
      {icon}
      {label}
    </button>
  );

  const canPostpone = actionAppliesTo("postpone", item.itemType);
  const canSuspend = actionAppliesTo("suspend", item.itemType);
  const canUnsuspend = actionAppliesTo("unsuspend", item.itemType);
  const canDismiss = actionAppliesTo("dismiss", item.itemType);
  const canDelete = actionAppliesTo("delete", item.itemType);

  return createPortal(
    <>
      {/* Backdrop to close on outside click (captured by the document listener too) */}
      <div className="fixed inset-0 z-[9998]" aria-hidden="true" />
      <div
        ref={ref}
        role="menu"
        className="fixed z-[9999] bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[220px] animate-in fade-in-0 zoom-in-95 duration-100 motion-reduce:animate-none motion-reduce:transition-none"
        style={style ?? { left: position.x, top: position.y }}
      >
        {callbacks.onOpen && (
          <div role="none">
            {menuItem(
              "open",
              <Play className="w-4 h-4 text-emerald-500" />,
              item.itemType === "learning-item" ? t("queue.studyNow") : t("queue.openDocument"),
              () => {
                onClose();
                runScheduleAction("open", item, callbacks);
              },
            )}
          </div>
        )}

        {canSuspend && callbacks.onSuspend && (
          <div role="none">
            {menuItem(
              "suspend",
              <Pause className="w-4 h-4 text-amber-500" />,
              t("queue.suspend"),
              () => {
                onClose();
                runScheduleAction("suspend", item, callbacks);
              },
            )}
          </div>
        )}

        {canUnsuspend && callbacks.onUnsuspend && (
          <div role="none">
            {menuItem(
              "unsuspend",
              <Play className="w-4 h-4 text-emerald-500" />,
              t("queue.unsuspend"),
              () => {
                onClose();
                runScheduleAction("unsuspend", item, callbacks);
              },
            )}
          </div>
        )}

        {canPostpone && (
          <div role="none">
            <div className="h-px bg-border my-1" />
            <div className="px-3 py-1 text-xs text-muted-foreground font-medium">
              {t("queue.postpone")}
            </div>
            {POSTPONE_PRESETS.map((days) =>
              menuItem(
                `postpone-${days}`,
                <CalendarHeart className="w-4 h-4 text-blue-400" />,
                `+${days}${days === 1 ? t("queue.day") : t("queue.days")}`,
                () => {
                  onClose();
                  runPostpone(item, days, callbacks);
                },
              ),
            )}
          </div>
        )}

        {canDismiss && callbacks.onDismiss && (
          <div role="none">
            <div className="h-px bg-border my-1" />
            {menuItem(
              "dismiss",
              <EyeSlash className="w-4 h-4 text-slate-400" />,
              t("queue.dismiss"),
              () => {
                onClose();
                runScheduleAction("dismiss", item, callbacks);
              },
            )}
          </div>
        )}

        {canDelete && callbacks.onDelete && (
          <div role="none">
            <div className="h-px bg-border my-1" />
            {menuItem(
              "delete",
              <Trash className="w-4 h-4" />,
              t("queue.delete"),
              () => {
                onClose();
                runScheduleAction("delete", item, callbacks);
              },
              "text-destructive hover:bg-destructive/10",
            )}
          </div>
        )}
      </div>
    </>,
    document.body,
  );
});
