import { useState, type ReactNode } from "react";
import {
  BookOpen,
  CalendarHeart,
  CheckSquare,
  EyeSlash,
  Headphones,
  Pause,
  Pencil,
  Play,
  SpinnerGap,
} from "@phosphor-icons/react";
import { ResponsiveDialogSheet } from "../adaptive/ResponsiveDialogSheet";
import type { QueueItem } from "../../types/queue";
import { DaqeScoreBreakdown } from "./DaqeScoreBreakdown";
import type { TermBreakdown } from "../../lib/daqe/snapshot";
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
  onEditCard?: (item: QueueItem) => void;
  onPostpone?: (item: QueueItem) => Promise<void>;
  onRemove?: (item: QueueItem) => Promise<void>;
  onSelect?: (item: QueueItem) => void;
  triggerElement?: HTMLElement | null;
  /**
   * The item's ranking breakdown, when adaptive ranking has produced one.
   *
   * Rendered above the actions so "why is this here?" is answered before "what
   * can I do about it?" — the sheet is reached by long-press, which a reader
   * opens to understand a row as often as to change it. Omitted entirely when
   * there is none, so a queue with ranking off shows exactly the sheet it always
   * did.
   */
  rankBreakdown?: TermBreakdown;
  /** The energy target the user set, for the fatigue-downshift explanation. */
  configuredEnergyTarget?: number;
}

const actionButtonClass =
  "w-full min-h-12 rounded-xl border border-border bg-background px-4 py-3 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-3";

export function QueueItemActionSheet({
  item,
  open,
  onClose,
  onOpenDocument,
  onStartReview,
  onEditCard,
  onPostpone,
  onRemove,
  onSelect,
  triggerElement,
  rankBreakdown,
  configuredEnergyTarget,
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
        case "listen-edition":
          closeAndRestoreFocus();
          onOpenDocument?.(item);
          break;
        case "edit-card":
          closeAndRestoreFocus();
          onEditCard?.(item);
          break;
        case "open-document":
          closeAndRestoreFocus();
          onOpenDocument?.(item);
          break;
        case "open-extract":
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
    "listen-edition": { label: t("queue.listenEdition"), icon: <Headphones className="w-5 h-5 text-primary" /> },
    "edit-card": { label: t("queue.editFlashcard"), icon: <Pencil className="w-5 h-5 text-blue-500" /> },
    "open-document": { label: t("queue.openDocument"), icon: <BookOpen className="w-5 h-5 text-blue-500" /> },
    "open-extract": { label: t("queue.openExtract"), icon: <BookOpen className="w-5 h-5 text-violet-500" /> },
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
      {rankBreakdown ? (
        <div className="mb-3 rounded-lg border border-border bg-muted/30 p-3">
          <DaqeScoreBreakdown
            breakdown={rankBreakdown}
            configuredEnergyTarget={configuredEnergyTarget}
          />
        </div>
      ) : null}

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
