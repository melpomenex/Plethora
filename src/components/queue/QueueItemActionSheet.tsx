import { useState, type ReactNode } from "react";
import {
  BookOpen,
  CalendarHeart,
  CheckSquare,
  EyeSlash,
  Pause,
  Play,
  SpinnerGap,
} from "@phosphor-icons/react";
import { ResponsiveDialogSheet } from "../adaptive/ResponsiveDialogSheet";
import type { QueueItem } from "../../types/queue";
import { useI18n } from "../../lib/i18n";
import {
  getQueueItemSheetActions,
  type QueueItemSheetAction,
} from "../review/queueActions";

interface QueueItemActionSheetProps {
  item: QueueItem | null;
  open: boolean;
  onClose: () => void;
  onOpenDocument?: (item: QueueItem) => void;
  onStartReview?: (itemId: string) => void;
  onPostpone?: (item: QueueItem) => Promise<void>;
  onRemove?: (item: QueueItem) => Promise<void>;
  onSelect?: (item: QueueItem) => void;
  triggerElement?: HTMLElement | null;
}

const actionButtonClass =
  "w-full min-h-12 rounded-xl border border-border bg-background px-4 py-3 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-3";

export function QueueItemActionSheet({
  item,
  open,
  onClose,
  onOpenDocument,
  onStartReview,
  onPostpone,
  onRemove,
  onSelect,
  triggerElement,
}: QueueItemActionSheetProps) {
  const { t } = useI18n();
  const [busyAction, setBusyAction] = useState<QueueItemSheetAction | null>(null);

  if (!item) return null;

  const actions = getQueueItemSheetActions(item);

  const closeAndRestoreFocus = () => {
    onClose();
    requestAnimationFrame(() => triggerElement?.focus());
  };

  const runAction = async (action: QueueItemSheetAction) => {
    if (busyAction) return;
    setBusyAction(action);

    try {
      switch (action) {
        case "study-now":
          closeAndRestoreFocus();
          onStartReview?.(item.learningItemId ?? item.id);
          break;
        case "open-document":
          closeAndRestoreFocus();
          onOpenDocument?.(item);
          break;
        case "postpone":
          closeAndRestoreFocus();
          await onPostpone?.(item);
          break;
        case "suspend":
        case "dismiss":
          closeAndRestoreFocus();
          await onRemove?.(item);
          break;
        case "select":
          closeAndRestoreFocus();
          onSelect?.(item);
          break;
      }
    } finally {
      setBusyAction(null);
    }
  };

  const actionConfig: Record<QueueItemSheetAction, {
    label: string;
    icon: ReactNode;
    destructive?: boolean;
  }> = {
    "study-now": { label: t("queue.studyNow"), icon: <Play className="w-5 h-5 text-emerald-500" /> },
    "open-document": { label: t("queue.openDocument"), icon: <BookOpen className="w-5 h-5 text-blue-500" /> },
    postpone: { label: t("queue.postpone"), icon: <CalendarHeart className="w-5 h-5 text-amber-500" /> },
    suspend: { label: t("queue.suspend"), icon: <Pause className="w-5 h-5 text-amber-500" /> },
    dismiss: { label: t("queue.dismiss"), icon: <EyeSlash className="w-5 h-5 text-slate-500" /> },
    select: { label: t("queue.selectForBulkActions"), icon: <CheckSquare className="w-5 h-5 text-primary" /> },
  };

  return (
    <ResponsiveDialogSheet
      open={open}
      onClose={closeAndRestoreFocus}
      title={t("queue.itemActions")}
      description={item.documentTitle}
      closeLabel={t("common.close")}
      presentation="auto"
      className="max-w-lg"
    >
      <div className="space-y-2">
        {actions.map((action) => {
          const config = actionConfig[action];
          const isBusy = busyAction === action;
          return (
            <button
              key={action}
              type="button"
              className={`${actionButtonClass} ${config.destructive ? "text-destructive hover:bg-destructive/10" : ""}`}
              disabled={Boolean(busyAction)}
              aria-busy={isBusy}
              onClick={() => void runAction(action)}
            >
              {isBusy ? <SpinnerGap className="w-5 h-5 animate-spin" /> : config.icon}
              <span>{config.label}</span>
            </button>
          );
        })}
      </div>
    </ResponsiveDialogSheet>
  );
}
