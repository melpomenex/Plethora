import { useEffect, useMemo, useState } from "react";
import { BookOpen, Plus, PushPin, X } from "@phosphor-icons/react";
import { useDocumentStore } from "../../../stores/documentStore";

const PINNED_DOCS_STORAGE_KEY = "plethora_dashboard_pinned_docs_v1";

function readPinnedDocIds(): string[] {
  try {
    if (typeof window === "undefined" || !window.localStorage) return [];
    const raw = window.localStorage.getItem(PINNED_DOCS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export interface PinnedDocsWidgetProps {
  onOpenDocument: (documentId: string) => void;
}

export function PinnedDocsWidget({ onOpenDocument }: PinnedDocsWidgetProps) {
  const documents = useDocumentStore((s) => s.documents);
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => readPinnedDocIds());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(PINNED_DOCS_STORAGE_KEY, JSON.stringify(pinnedIds));
      }
    } catch {
      // Ignore storage errors
    }
  }, [pinnedIds]);

  const pinnedDocs = useMemo(
    () =>
      pinnedIds
        .map((id) => documents.find((d) => d.id === id))
        .filter((d): d is NonNullable<typeof d> => d != null),
    [documents, pinnedIds],
  );

  const availableToPin = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents
      .filter((d) => !pinnedIds.includes(d.id))
      .filter((d) => !q || d.title.toLowerCase().includes(q))
      .slice(0, 8);
  }, [documents, pinnedIds, query]);

  const pinDoc = (id: string) => {
    setPinnedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setPickerOpen(false);
    setQuery("");
  };

  const unpinDoc = (id: string) => {
    setPinnedIds((prev) => prev.filter((item) => item !== id));
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-500">
            <PushPin className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Pinned Documents</h3>
            <p className="text-[11px] text-muted-foreground">
              One-click access to your core reference materials
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setPickerOpen((prev) => !prev)}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Pin document
        </button>
      </div>

      {pickerOpen && (
        <div className="mb-3 rounded-lg border border-border bg-background/80 p-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search library to pin..."
            aria-label="Search documents to pin"
            className="mb-2 w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {availableToPin.length === 0 ? (
            <p className="text-xs text-muted-foreground">No matching unpinned documents.</p>
          ) : (
            <div className="max-h-40 overflow-y-auto divide-y divide-border">
              {availableToPin.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => pinDoc(doc.id)}
                  className="flex w-full items-center justify-between gap-2 py-1.5 px-1 text-left text-xs text-foreground hover:bg-accent rounded"
                >
                  <span className="truncate">{doc.title}</span>
                  <span className="shrink-0 text-[10px] text-primary font-medium">Pin</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {pinnedDocs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No pinned documents yet. Click &ldquo;Pin document&rdquo; to keep key reads handy.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {pinnedDocs.map((doc) => (
            <div
              key={doc.id}
              className="group flex items-center justify-between gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 transition-colors hover:bg-accent"
            >
              <button
                type="button"
                onClick={() => onOpenDocument(doc.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <BookOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="truncate text-xs font-medium text-foreground group-hover:text-primary">
                  {doc.title}
                </span>
              </button>
              <button
                type="button"
                onClick={() => unpinDoc(doc.id)}
                aria-label={`Unpin ${doc.title}`}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
