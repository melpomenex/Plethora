import { useCallback } from "react";
import { CircleNotch, Plus, X } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";
import { useItemTagEditor } from "../../hooks/useItemTagEditor";
import type { ItemTagTarget } from "../../lib/tagEditing/types";

export interface ItemTagEditorProps {
  target: ItemTagTarget;
  className?: string;
  /** Callback with the persisted tag list after a successful mutation. */
  onTagsPersisted?: (tags: string[]) => void;
  /**
   * Optional browse action for a tag chip body (e.g. "view items with this
   * tag"). Activating a chip body NEVER removes the tag. When omitted the
   * chip body is not an interactive element.
   */
  onTagClick?: (tag: string) => void;
  /** Render chips + add control with a smaller footprint for dense rows. */
  dense?: boolean;
  /** Render without any editing controls (informational presentations). */
  readOnly?: boolean;
  /** Auto-focus the add input when the editor mounts (compact popovers). */
  autoFocus?: boolean;
}

/**
 * Shared inline tag editor for persisted documents, extracts, and learning
 * items. Removable chips + add input with Enter submission, explicit busy
 * state, optimistic update, rollback on failure, and accessible labels.
 * See openspec change unify-tag-editing-and-align-schedule-grid (2.4).
 */
export function ItemTagEditor({
  target,
  className,
  onTagsPersisted,
  onTagClick,
  dense = false,
  readOnly = false,
  autoFocus = false,
}: ItemTagEditorProps) {
  const { t } = useI18n();
  const { tags, input, busy, error, setInput, addTag, removeTag } = useItemTagEditor(
    target,
    { onTagsPersisted }
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addTag();
      }
    },
    [addTag]
  );

  const chipClass = dense
    ? "px-1.5 py-0.5 text-[11px]"
    : "px-2 py-0.5 text-xs";

  return (
    <div
      className={cn("space-y-1", className)}
      aria-busy={busy}
      data-testid="item-tag-editor"
    >
      <div className="flex flex-wrap items-center gap-1">
        {tags.map((tag) => (
          <span
            key={tag}
            className={cn(
              "inline-flex items-center gap-1 rounded bg-muted/80 text-foreground border border-border/70",
              chipClass
            )}
          >
            {onTagClick ? (
              <button
                type="button"
                onClick={() => onTagClick(tag)}
                className="hover:underline"
                title={t("itemDetails.viewItemsWithTag", { tag })}
              >
                {tag}
              </button>
            ) : (
              <span>{tag}</span>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={() => removeTag(tag)}
                disabled={busy}
                aria-label={t("itemDetails.removeTag", { tag })}
                className="text-muted-foreground hover:text-destructive focus:text-destructive focus:outline-none rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}

        {!readOnly && (
          <div className="inline-flex items-center gap-1">
            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("itemDetails.addTagPlaceholder")}
              disabled={busy}
              autoFocus={autoFocus}
              aria-label={t("itemDetails.addTag")}
              className={cn(
                "px-1.5 py-0.5 text-xs rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50",
                dense ? "w-20" : "w-24"
              )}
            />
            <button
              type="button"
              onClick={addTag}
              disabled={busy || !input.trim()}
              aria-label={t("itemDetails.addTag")}
              className="text-muted-foreground hover:text-foreground focus:text-foreground focus:outline-none rounded p-0.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {busy ? (
                <CircleNotch className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
