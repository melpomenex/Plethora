import { PencilSimple } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../utils";

interface InlineDocumentTitleProps {
  title: string;
  onSave: (title: string) => Promise<boolean>;
  renameLabel: string;
  inputLabel: string;
  className?: string;
}

/** A compact title display that becomes an input when clicked. */
export function InlineDocumentTitle({
  title,
  onSave,
  renameLabel,
  inputLabel,
  className,
}: InlineDocumentTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [editing, title]);

  const finishEditing = async () => {
    if (savingRef.current) return;

    const nextTitle = draft.trim();
    if (!nextTitle || nextTitle === title) {
      setDraft(title);
      setEditing(false);
      return;
    }

    savingRef.current = true;
    const saved = await onSave(nextTitle);
    savingRef.current = false;
    if (!saved) setDraft(title);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void finishEditing()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void finishEditing();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(title);
            setEditing(false);
          }
        }}
        aria-label={inputLabel}
        autoFocus
        className={cn(
          "min-w-0 flex-1 rounded border border-primary/60 bg-background px-1.5 py-0.5 font-semibold text-foreground outline-none ring-2 ring-primary/20",
          className,
        )}
        onFocus={(event) => event.currentTarget.select()}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={renameLabel}
      title={renameLabel}
      className={cn(
        "group/title flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-0.5 text-left font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        className,
      )}
    >
      <span className="truncate">{title}</span>
      <PencilSimple className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover/title:opacity-60 group-focus-visible/title:opacity-60" />
    </button>
  );
}
