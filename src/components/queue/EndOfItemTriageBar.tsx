import { useEffect } from "react";
import {
  Archive,
  ArrowRight,
  ChatCircle,
  Flag,
  Scissors,
} from "@phosphor-icons/react";
import { cn } from "../../utils";

export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as Element;
  if (typeof el.tagName !== "string") return false;
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  const htmlEl = target as HTMLElement;
  if (htmlEl.isContentEditable) {
    return true;
  }
  const attr = typeof el.getAttribute === "function" ? el.getAttribute("contenteditable") : null;
  if (attr === "" || attr === "true") {
    return true;
  }
  if (
    typeof el.closest === "function" &&
    el.closest(
      "[contenteditable='true'], [contenteditable=''], .ProseMirror, [data-split-sheet='true'], [data-provenance-popover='true']"
    )
  ) {
    return true;
  }
  return false;
}

export interface EndOfItemTriageBarProps {
  onNext?: () => void;
  onExtract?: () => void;
  onCreateQA?: () => void;
  onArchive?: () => void;
  onOpenPriority?: () => void;
  disabled?: boolean;
  enableSpaceKey?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

interface TriageActionItem {
  id: string;
  keyHint: string;
  label: string;
  ariaLabel: string;
  icon: typeof ArrowRight;
  onClick?: () => void;
}

export function EndOfItemTriageBar({
  onNext,
  onExtract,
  onCreateQA,
  onArchive,
  onOpenPriority,
  disabled = false,
  enableSpaceKey = true,
  className,
  style,
}: EndOfItemTriageBarProps) {
  useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (
        isEditableEventTarget(event.target) ||
        isEditableEventTarget(typeof document !== "undefined" ? document.activeElement : null)
      ) {
        return;
      }

      if (event.key === " " && enableSpaceKey && onNext) {
        event.preventDefault();
        onNext();
        return;
      }

      const lower = event.key.toLowerCase();
      if (lower === "e" && onExtract) {
        event.preventDefault();
        onExtract();
      } else if (lower === "q" && onCreateQA) {
        event.preventDefault();
        onCreateQA();
      } else if (lower === "d" && onArchive) {
        event.preventDefault();
        onArchive();
      } else if (lower === "p" && onOpenPriority) {
        event.preventDefault();
        onOpenPriority();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, enableSpaceKey, onNext, onExtract, onCreateQA, onArchive, onOpenPriority]);

  const items: TriageActionItem[] = [
    {
      id: "next",
      keyHint: "Space",
      label: "Next",
      ariaLabel: "Next item",
      icon: ArrowRight,
      onClick: onNext,
    },
    {
      id: "extract",
      keyHint: "E",
      label: "Extract",
      ariaLabel: "Extract selection",
      icon: Scissors,
      onClick: onExtract,
    },
    {
      id: "qa",
      keyHint: "Q",
      label: "Q&A",
      ariaLabel: "Create Q&A",
      icon: ChatCircle,
      onClick: onCreateQA,
    },
    {
      id: "archive",
      keyHint: "D",
      label: "Done",
      ariaLabel: "Archive or mark done",
      icon: Archive,
      onClick: onArchive,
    },
    {
      id: "priority",
      keyHint: "P",
      label: "Priority",
      ariaLabel: "Edit priority",
      icon: Flag,
      onClick: onOpenPriority,
    },
  ];

  return (
    <div
      data-end-of-item-triage-bar="true"
      role="toolbar"
      aria-label="End-of-item micro-triage actions"
      style={style}
      className={cn(
        "inline-flex flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-border/80 bg-card/90 px-3 py-2 text-xs text-foreground shadow-lg backdrop-blur-md",
        className
      )}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActionDisabled = disabled || !item.onClick;
        return (
          <button
            key={item.id}
            type="button"
            disabled={isActionDisabled}
            onClick={item.onClick}
            aria-label={item.ariaLabel}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5 font-medium transition-colors",
              "hover:border-border hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              "disabled:pointer-events-none disabled:opacity-45"
            )}
          >
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
              {item.keyHint}
            </kbd>
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
