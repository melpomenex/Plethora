import { useCallback, useId, useRef, useState } from "react";
import { Calendar, CaretDown } from "@phosphor-icons/react";
import { rescheduleDocument } from "../../api/queue";
import { useDocumentStore } from "../../stores/documentStore";
import { useQueueStore } from "../../stores/queueStore";
import { useToast } from "../common/Toast";
import { Dialog } from "../md3/Dialog";

export interface DueDateRescheduleControlProps {
  documentId: string;
  nextReadingDate?: string | null;
}

/** Local calendar day start (00:00:00) for DST-safe day-diff calculations. */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Compute local calendar day difference (dueDay - today). */
export function localDueDayDiff(nextReadingDate: string, now: Date = new Date()): number | null {
  const due = new Date(nextReadingDate);
  if (Number.isNaN(due.getTime())) return null;
  const dueDay = startOfLocalDay(due);
  const today = startOfLocalDay(now);
  return Math.round((dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/** Build an RFC 3339 timestamp for N local days from today at 09:00 local time. */
export function buildLocalPresetIso(daysFromToday: number, now: Date = new Date()): string {
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysFromToday, 9, 0, 0, 0);
  return target.toISOString();
}

/** Convert a local `YYYY-MM-DD` date input value to an ISO timestamp at 09:00 local time. */
export function localDateInputToIso(value: string): string | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!parts) return null;
  const year = Number(parts[1]);
  const month = Number(parts[2]) - 1;
  const day = Number(parts[3]);
  const local = new Date(year, month, day, 9, 0, 0, 0);
  if (Number.isNaN(local.getTime())) return null;
  return local.toISOString();
}

function toLocalDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function DueDateRescheduleControl({
  documentId,
  nextReadingDate,
}: DueDateRescheduleControlProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customDate, setCustomDate] = useState(() => toLocalDateInputValue(new Date()));

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const toast = useToast();

  const updateDocumentOptimistic = useDocumentStore((s) => s.updateDocumentOptimistic);

  const closeModal = useCallback(() => {
    setIsOpen(false);
    setError(null);
  }, []);

  if (!nextReadingDate) return null;
  const diff = localDueDayDiff(nextReadingDate);
  if (diff === null || (diff > 7 && !isOpen)) return null;

  const label =
    diff < 0
      ? `Overdue ${Math.abs(diff)}d`
      : diff === 0
      ? "Due today"
      : `Due in ${diff}d`;

  const color =
    diff < 0
      ? "bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20"
      : diff === 0
      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
      : "bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20";

  const statusDetail =
    diff < 0
      ? `Currently overdue by ${Math.abs(diff)} ${Math.abs(diff) === 1 ? "day" : "days"}`
      : diff === 0
      ? "Currently scheduled for today"
      : `Currently scheduled in ${diff} ${diff === 1 ? "day" : "days"}`;

  const commitReschedule = async (targetIso: string) => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = await rescheduleDocument(documentId, targetIso);
      await updateDocumentOptimistic(documentId, { nextReadingDate: result.nextDate });
      const queueState = useQueueStore.getState();
      if (queueState.hasCompletedFirstLoad) {
        void queueState.reloadForCurrentMode();
      }
      closeModal();

      const formatted = new Date(result.nextDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });

      toast.success(`Reading rescheduled to ${formatted}`, undefined, {
        duration: 6000,
        action: result.previousDate
          ? {
              label: "Undo",
              onClick: () => {
                const current = useDocumentStore
                  .getState()
                  .documents.find((d) => d.id === documentId)?.nextReadingDate;
                // Guard against undoing if the user already made a newer change.
                if (current && current !== result.nextDate) return;
                void rescheduleDocument(documentId, result.previousDate!)
                  .then((restored) =>
                    updateDocumentOptimistic(documentId, { nextReadingDate: restored.nextDate })
                  )
                  .then(() => {
                    const q = useQueueStore.getState();
                    if (q.hasCompletedFirstLoad) void q.reloadForCurrentMode();
                  })
                  .catch(() => {
                    toast.error("Undo failed", "Could not restore previous reading date.");
                  });
              },
            }
          : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to reschedule reading";
      setError(message);
      toast.error("Reschedule failed", message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setCustomDate(toLocalDateInputValue(new Date()));
          setIsOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`Reschedule reading (${label})`}
        title="Click to reschedule reading"
        className={`hidden sm:inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${color}`}
      >
        <span>{label}</span>
        <CaretDown className="h-2.5 w-2.5 opacity-75" aria-hidden="true" />
      </button>

      <Dialog
        open={isOpen}
        onClose={closeModal}
        title={
          <span className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" aria-hidden="true" />
            <span>Reschedule reading</span>
          </span>
        }
        description={statusDetail}
        className="max-w-sm"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {diff !== 0 && (
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void commitReschedule(buildLocalPresetIso(0))}
                className="rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                Today
              </button>
            )}
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void commitReschedule(buildLocalPresetIso(1))}
              className="rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              Tomorrow
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void commitReschedule(buildLocalPresetIso(3))}
              className="rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              In 3 days
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void commitReschedule(buildLocalPresetIso(7))}
              className="rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              In 7 days
            </button>
          </div>

          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const iso = localDateInputToIso(customDate);
              if (iso) void commitReschedule(iso);
            }}
          >
            <label className="sr-only" htmlFor={`${dialogId}-date`}>
              Choose a custom date
            </label>
            <input
              id={`${dialogId}-date`}
              type="date"
              value={customDate}
              onChange={(event) => setCustomDate(event.target.value)}
              disabled={isSaving}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
            />
            <button
              type="submit"
              disabled={isSaving || !customDate}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Apply
            </button>
          </form>

          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Reading progress and review history will be preserved.
          </p>
        </div>
      </Dialog>
    </>
  );
}
