import { memo } from "react";
import {
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
  POSTPONE_PRESETS,
  type ScheduleActionCallbacks,
} from "../../lib/scheduleActions";

/** Compact postpone presets shown as always-visible quick actions. */
const QUICK_POSTPONE_PRESETS = POSTPONE_PRESETS.slice(0, 3);

interface ScheduleItemActionsProps {
  item: ScheduleDayItem;
  callbacks: ScheduleActionCallbacks;
  /** true while a mutation for this item is in flight */
  busy?: boolean;
  className?: string;
}

/**
 * Shared action controls: postpone presets and item-type-specific actions with
 * busy state. Keyboard-visible (not hover-only) — the same actions are exposed
 * through the portaled context menu.
 */
export const ScheduleItemActions = memo(function ScheduleItemActions({
  item,
  callbacks,
  busy = false,
  className,
}: ScheduleItemActionsProps) {
  const { t } = useI18n();

  const canPostpone = actionAppliesTo("postpone", item.itemType);
  const canSuspend = actionAppliesTo("suspend", item.itemType);
  const canUnsuspend = actionAppliesTo("unsuspend", item.itemType);
  const canDismiss = actionAppliesTo("dismiss", item.itemType);
  const canDelete = actionAppliesTo("delete", item.itemType);

  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap", className)}>
      {canPostpone &&
        QUICK_POSTPONE_PRESETS.map((days) => (
          <button
            key={days}
            type="button"
            disabled={busy}
            onClick={() => callbacks.onPostpone?.(item.id, days, item.itemType)}
            className="px-2 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground text-xs font-medium transition-colors disabled:opacity-50 min-h-[36px] min-w-[44px]"
            aria-label={t("schedule.postponeDays", { count: days })}
          >
            +{days}d
          </button>
        ))}

      {canSuspend && callbacks.onSuspend && (
        <button
          type="button"
          disabled={busy}
          onClick={() => runScheduleAction("suspend", item, callbacks)}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-amber-600 dark:text-amber-400 text-xs font-medium transition-colors disabled:opacity-50 min-h-[36px]"
          title={t("queue.suspend")}
          aria-label={t("queue.suspend")}
        >
          <Pause className="w-3.5 h-3.5" />
        </button>
      )}

      {canUnsuspend && callbacks.onUnsuspend && (
        <button
          type="button"
          disabled={busy}
          onClick={() => runScheduleAction("unsuspend", item, callbacks)}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-emerald-600 dark:text-emerald-400 text-xs font-medium transition-colors disabled:opacity-50 min-h-[36px]"
          title={t("queue.unsuspend")}
          aria-label={t("queue.unsuspend")}
        >
          <Play className="w-3.5 h-3.5" />
        </button>
      )}

      {canDismiss && callbacks.onDismiss && (
        <button
          type="button"
          disabled={busy}
          onClick={() => runScheduleAction("dismiss", item, callbacks)}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-slate-500 dark:text-slate-400 text-xs font-medium transition-colors disabled:opacity-50 min-h-[36px]"
          title={t("queue.dismiss")}
          aria-label={t("queue.dismiss")}
        >
          <EyeSlash className="w-3.5 h-3.5" />
        </button>
      )}

      {canDelete && callbacks.onDelete && (
        <button
          type="button"
          disabled={busy}
          onClick={() => runScheduleAction("delete", item, callbacks)}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md bg-muted hover:bg-destructive/10 text-destructive text-xs font-medium transition-colors disabled:opacity-50 min-h-[36px]"
          title={t("queue.delete")}
          aria-label={t("queue.delete")}
        >
          <Trash className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
});

export { POSTPONE_PRESETS, QUICK_POSTPONE_PRESETS };
