import { useEffect, useId, useRef, type RefObject } from "react";
import { ChatCircleDots, ClockCounterClockwise, NotePencil, Trash, X } from "@phosphor-icons/react";
import { registerOverlayDismissal } from "../../../lib/overlayStack";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../utils/cn";
import { MAX_MOBILE_CHAT_HISTORY, type MobileChatHistoryEntry } from "./chatHistory";

export interface MobileChatHistoryProps {
  entries: MobileChatHistoryEntry[];
  activeChatId?: string;
  onSelect: (entry: MobileChatHistoryEntry) => void;
  onDelete: (id: string) => void;
  onNewConversation: () => void;
  onClose: () => void;
  /** The history trigger button receives focus again when the view closes. */
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  className?: string;
}

const formatChatTimestamp = (timestamp: number): string => {
  const diffMs = Date.now() - timestamp;
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (diffMs < minuteMs) return "Just now";
  if (diffMs < hourMs) return `${Math.floor(diffMs / minuteMs)}m ago`;
  if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)}h ago`;
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
      new Date(timestamp)
    );
  } catch {
    return "";
  }
};

/**
 * In-flow mobile chat history browser. Replaces the conversation body inside
 * the mobile Assistant sheet so it inherits keyboard sizing and back-stack
 * dismissal without overflowing the sheet.
 */
export function MobileChatHistory({
  entries,
  activeChatId,
  onSelect,
  onDelete,
  onNewConversation,
  onClose,
  returnFocusRef,
  className,
}: MobileChatHistoryProps) {
  const { t } = useI18n();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    // Above the Assistant sheet's own 60 so Back closes history first.
    const unregister = registerOverlayDismissal(() => onCloseRef.current(), { priority: 70 });
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus());
    return () => {
      unregister();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => () => {
    const target = returnFocusRef.current;
    if (target?.isConnected && !target.closest("[hidden]")) target.focus({ preventScroll: true });
  }, [returnFocusRef]);

  return (
    <div
      data-assistant-mobile-history
      role="group"
      aria-labelledby={headingId}
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-surface-container-high",
        className
      )}
    >
      <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <ClockCounterClockwise size={18} className="shrink-0 text-primary" aria-hidden="true" />
          <h3
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="truncate text-sm font-semibold text-foreground outline-none"
          >
            {t("assistant.history.title")}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onNewConversation}
            className="md-state inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-medium text-foreground focus-visible:outline focus-visible:outline-2"
          >
            <NotePencil size={15} aria-hidden="true" />
            <span>{t("assistant.composer.newConversation")}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("assistant.history.close")}
            className="md-state flex min-h-12 min-w-12 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
            <ChatCircleDots size={28} className="text-muted-foreground/70" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">{t("assistant.history.empty")}</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              {t("assistant.history.emptyHint")}
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5" aria-label={t("assistant.history.title")}>
            {entries.map((entry) => {
              const isCurrent = entry.id === activeChatId;
              const messageCount = entry.messages.filter((m) => m.role !== "system").length;
              const timeLabel = formatChatTimestamp(entry.updatedAt);
              const countLabel =
                messageCount === 1
                  ? t("assistant.history.oneMessage")
                  : t("assistant.history.messageCount", { count: messageCount });
              const metaParts = [timeLabel, countLabel, entry.sourceTitle].filter(Boolean);

              return (
                <li
                  key={entry.id}
                  className={cn(
                    "flex items-center gap-1 rounded-xl border transition-colors",
                    isCurrent
                      ? "border-primary/40 bg-primary/5"
                      : "border-border/60 bg-background/60 hover:bg-muted/40"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(entry)}
                    aria-current={isCurrent ? "true" : undefined}
                    className="md-state flex min-h-12 min-w-0 flex-1 flex-col items-start justify-center rounded-xl px-3 py-2 text-start focus-visible:outline focus-visible:outline-2"
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {entry.title}
                      </span>
                      {isCurrent && (
                        <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          {t("assistant.history.current")}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 w-full truncate text-xs text-muted-foreground">
                      {metaParts.join(" · ")}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(entry.id)}
                    aria-label={t("assistant.history.deleteChat", { title: entry.title })}
                    className="md-state flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:text-destructive focus-visible:outline focus-visible:outline-2"
                  >
                    <Trash size={17} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="shrink-0 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
        {t("assistant.history.limitNote", { limit: MAX_MOBILE_CHAT_HISTORY })}
      </p>
    </div>
  );
}
