import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleNotch, FolderOpen, X } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";
import { getDocuments, updateDocument, clearDocumentCategory } from "../../api/documents";
import { useDocumentStore } from "../../stores/documentStore";

export interface ItemCategoryEditorProps {
  documentId: string;
  /** Current category (empty/undefined = uncategorized). */
  category?: string | null;
  /**
   * Caller-known document snapshot used as the update base when the document
   * is not (yet) in the store — updateDocument writes whole-document partials.
   */
  baseDocument?: Record<string, unknown> | null;
  /** Callback with the persisted category (null = cleared) after a mutation. */
  onCategoryPersisted?: (category: string | null) => void;
  className?: string;
}

/**
 * Shared inline category editor for documents (pattern: ItemTagEditor).
 * Preset chips derive from the union of existing document categories plus a
 * free-text input; clearing is an explicit action backed by the dedicated
 * clear path — an empty string through `updateDocument` means "not provided"
 * (issue #44 bug 11).
 */
export function ItemCategoryEditor({
  documentId,
  category,
  baseDocument,
  onCategoryPersisted,
  className,
}: ItemCategoryEditorProps) {
  const { t } = useI18n();
  const documents = useDocumentStore((state) => state.documents);
  const [current, setCurrent] = useState(category ?? "");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCurrent(category ?? "");
  }, [category, documentId]);

  // Preset chips: the union of categories already used by documents, so the
  // editor offers what the library actually uses (mirrors the Library filter).
  const presets = useMemo(() => {
    const names = new Set<string>();
    for (const doc of documents) {
      const name = doc.category?.trim();
      if (name) names.add(name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [documents]);

  // Make sure the store has documents loaded so the chip union is populated.
  useEffect(() => {
    if (documents.length > 0) return;
    let cancelled = false;
    getDocuments()
      .then(() => {
        /* the store listener populates state */
      })
      .catch(() => {
        if (!cancelled) setError(t("itemDetails.categoryLoadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [documents.length, t]);

  const persist = useCallback(
    async (next: string | null) => {
      setBusy(true);
      setError(null);
      try {
        if (next === null) {
          await clearDocumentCategory(documentId);
          setCurrent("");
          onCategoryPersisted?.(null);
        } else {
          const existing =
            (documents.find((doc) => doc.id === documentId) as unknown as Record<string, unknown> | undefined) ??
            baseDocument ??
            null;
          if (!existing) throw new Error(t("itemDetails.documentUnavailable"));
          const updated = await updateDocument(documentId, {
            ...existing,
            category: next,
          } as Parameters<typeof updateDocument>[1]);
          setCurrent(updated.category ?? "");
          onCategoryPersisted?.(updated.category ?? null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t("itemDetails.updateFailed"));
      } finally {
        setBusy(false);
      }
    },
    [documentId, documents, baseDocument, onCategoryPersisted, t]
  );

  const submitFreeText = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setInput("");
    void persist(trimmed);
  };

  return (
    <div className={cn("space-y-1.5", className)} aria-busy={busy} data-testid="item-category-editor">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <FolderOpen className="h-3.5 w-3.5" />
        <span>{t("itemDetails.category")}</span>
        {busy && <CircleNotch className="h-3 w-3 animate-spin" />}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {presets.map((preset) => {
          const selected = preset === current;
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={selected}
              onClick={() => void persist(selected ? null : preset)}
              className={cn(
                "rounded border px-2 py-0.5 text-xs transition-colors",
                selected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/50 bg-muted/60 text-foreground hover:border-primary/50"
              )}
            >
              {preset}
            </button>
          );
        })}
        {presets.length === 0 && (
          <span className="text-xs text-muted-foreground">{t("itemDetails.noCategoriesYet")}</span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitFreeText();
            }
          }}
          placeholder={t("itemDetails.categoryPlaceholder")}
          aria-label={t("itemDetails.categoryPlaceholder")}
          className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {current && !busy && (
          <button
            type="button"
            onClick={() => void persist(null)}
            title={t("itemDetails.clearCategory")}
            aria-label={t("itemDetails.clearCategory")}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
