import { useCallback, useEffect, useRef, useState } from "react";
import { PencilSimple, Tag } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
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
}

/**
 * Compact tag presentation for dense rows/cards: readable chips preview plus a
 * localized edit affordance that opens a small focus-managed popover
 * containing the shared inline editor. Activating a chip body or the trigger
 * NEVER removes a tag. Escape closes the popover and returns focus to the
 * trigger. See openspec change unify-tag-editing-and-align-schedule-grid (2.5).
 */
export function CompactTagEditor({
  target,
  className,
  onTagsPersisted,
  onTagClick,
  previewLimit = 3,
}: CompactTagEditorProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const tags = target.tags ?? [];
  const preview = tags.slice(0, previewLimit);
  const remaining = tags.length - preview.length;

  // Focus management: return focus to the trigger when the popover closes,
  // whether via Escape, outside click, or the close button. `wasOpenRef`
  // records that the popover was actually open (the panel unmounts before
  // this effect runs, so we cannot inspect the DOM after the fact).
  const close = useCallback(() => {
    setOpen(false);
  }, []);

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

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (event.target instanceof Node && wrapperRef.current.contains(event.target)) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, close]);

  return (
    <div ref={wrapperRef} className={cn("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          // Embedding in clickable rows/cards: opening the editor must not
          // trigger the host row's click handler.
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("tagEditor.editTags", { count: tags.length })}
        title={t("tagEditor.editTags", { count: tags.length })}
        className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/40 px-2 py-1 text-xs text-foreground hover:bg-muted/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Tag className="w-3.5 h-3.5 text-muted-foreground" />
        {preview.map((tag) => (
          <span key={tag} className="max-w-[8rem] truncate">
            {tag}
          </span>
        ))}
        {remaining > 0 && <span className="text-muted-foreground">+{remaining}</span>}
        <span className="text-muted-foreground">
          <PencilSimple className="w-3 h-3" />
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("tagEditor.editTagsTitle")}
          className="absolute z-50 mt-1.5 right-0 top-full w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-2.5 shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("tagEditor.editTagsTitle")}
            </span>
            <button
              type="button"
              onClick={close}
              aria-label={t("common.close")}
              className="text-muted-foreground hover:text-foreground p-0.5 rounded"
            >
              <span aria-hidden>×</span>
            </button>
          </div>
          <ItemTagEditor target={target} onTagsPersisted={onTagsPersisted} onTagClick={onTagClick} autoFocus />
        </div>
      )}
    </div>
  );
}
