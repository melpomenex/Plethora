import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PencilSimple, Tag } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { useMobileShell } from "../../hooks/useMobileShell";
import { cn } from "../../utils";
import { ItemTagEditor } from "./ItemTagEditor";
import type { ItemTagTarget } from "../../lib/tagEditing/types";

export interface CompactTagEditorProps {
  target: ItemTagTarget;
  className?: string;
  /** Callback with the persisted tag list after a successful mutation. */
  onTagsPersisted?: (tags: string[]) => void;
  /** Browse action for a chip body inside the popover (optional). */
  onTagClick?: (tag: string) => void;
  /** Max chips shown in the collapsed preview before "+N". */
  previewLimit?: number;
  /** Force mobile sheet/modal presentation mode (optional, defaults to auto-detect). */
  isMobile?: boolean;
}

/**
 * Compact tag presentation for dense rows/cards: readable chips preview plus a
 * localized edit affordance that opens a portaled, focus-managed popover or
 * mobile sheet containing the shared inline editor.
 *
 * Rendered via createPortal to document.body to escape virtualized row
 * transforms, CSS stacking contexts, and overflow clipping.
 * Activating a chip body or the trigger NEVER removes a tag. Escape closes the
 * popover and returns focus to the trigger.
 */
export function CompactTagEditor({
  target,
  className,
  onTagsPersisted,
  onTagClick,
  previewLimit = 3,
  isMobile: isMobileProp,
}: CompactTagEditorProps) {
  const { t } = useI18n();
  const isMobileShell = useMobileShell();
  const [open, setOpen] = useState(false);
  const [isSmallScreen, setIsSmallScreen] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 640
  );
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  const tags = target.tags ?? [];
  const preview = tags.slice(0, previewLimit);
  const remaining = tags.length - preview.length;

  useEffect(() => {
    const handleResize = () => {
      setIsSmallScreen(window.innerWidth < 640);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const isMobile = isMobileProp ?? (isMobileShell || isSmallScreen);

  const getAnchorPosition = useCallback(() => {
    if (!triggerRef.current) {
      return { top: 16, left: 16, width: 288 };
    }
    const rect = triggerRef.current.getBoundingClientRect();
    const width = 288;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;

    let left = rect.right > 0 ? rect.right - width : rect.left;
    if (left < 16) {
      left = Math.max(16, rect.left);
    }
    if (left + width > vw - 16) {
      left = Math.max(16, vw - 16 - width);
    }
    let top = rect.bottom > 0 ? rect.bottom + 6 : 16;
    const estimatedHeight = 240;
    if (top + estimatedHeight > vh - 16 && rect.top - estimatedHeight - 6 > 0) {
      top = rect.top - estimatedHeight - 6;
    }
    return { top, left, width };
  }, []);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const toggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setOpen((prev) => {
        if (!prev) {
          setPopoverPos(getAnchorPosition());
          return true;
        }
        return false;
      });
    },
    [getAnchorPosition]
  );

  useLayoutEffect(() => {
    if (open) {
      setPopoverPos(getAnchorPosition());
    }
  }, [open, getAnchorPosition]);

  // Focus management: return focus to the trigger when the popover closes
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  // Dismiss on outside click, escape key, or outside scroll
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (panelRef.current && panelRef.current.contains(event.target as Node)) return;
      if (triggerRef.current && triggerRef.current.contains(event.target as Node)) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    const handleScroll = (event: Event) => {
      if (panelRef.current && event.target instanceof Node && panelRef.current.contains(event.target)) {
        return;
      }
      close();
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, close]);

  return (
    <div ref={wrapperRef} className={cn("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("tagEditor.editTags", { count: tags.length })}
        title={t("tagEditor.editTags", { count: tags.length })}
        className="inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden rounded-md border border-border/50 bg-muted/40 px-2 py-1 text-xs text-foreground hover:bg-muted/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Tag className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        {preview.map((tag) => (
          <span key={tag} className="max-w-[5rem] truncate sm:max-w-[8rem]">
            {tag}
          </span>
        ))}
        {remaining > 0 && <span className="shrink-0 text-muted-foreground">+{remaining}</span>}
        <span className="shrink-0 text-muted-foreground">
          <PencilSimple className="w-3 h-3" />
        </span>
      </button>

      {open && typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              data-testid="compact-tag-editor-backdrop"
              className={cn(
                "fixed inset-0 z-[9998]",
                isMobile ? "bg-black/50 backdrop-blur-sm" : "bg-black/10"
              )}
              onClick={close}
              aria-hidden="true"
            />
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label={t("tagEditor.editTagsTitle")}
              style={{
                backgroundColor: "var(--color-popover, #1e293b)",
                opacity: 1,
                ...(isMobile
                  ? {}
                  : {
                      top: `${popoverPos?.top ?? 16}px`,
                      left: `${popoverPos?.left ?? 16}px`,
                      width: `${popoverPos?.width ?? 288}px`,
                    }),
              }}
              className={cn(
                "fixed z-[9999] rounded-xl border border-border shadow-xl bg-popover flex flex-col",
                isMobile
                  ? "inset-x-4 bottom-6 max-w-sm mx-auto w-[calc(100vw-2rem)] p-3.5 max-h-[80dvh]"
                  : "p-3 max-h-[80vh] w-72 max-w-[calc(100vw-2rem)]"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("tagEditor.editTagsTitle")}
                </span>
                <button
                  type="button"
                  onClick={close}
                  aria-label={t("common.close")}
                  className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
                >
                  <span aria-hidden>×</span>
                </button>
              </div>
              <div className="overflow-y-auto min-h-0 flex-1">
                <ItemTagEditor
                  target={target}
                  onTagsPersisted={onTagsPersisted}
                  onTagClick={onTagClick}
                  autoFocus
                />
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
