/**
 * DocumentSelector — dropdown for choosing the document the Studio draws
 * context from. Moved verbatim out of `FlashcardStudioModal.tsx` so it can be
 * rendered inline (desktop) or inside a bottom sheet (mobile).
 */

import { useEffect, useRef, useState } from "react";
import { CaretDown, MagnifyingGlass, TextT, X } from "@phosphor-icons/react";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../utils";

export interface DocumentSelectorProps {
  documents: { id: string; title: string; content?: string }[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function DocumentSelector({ documents, selectedId, onSelect }: DocumentSelectorProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedDoc = documents.find((d) => d.id === selectedId);

  const filteredDocs = documents.filter((d) =>
    d.title.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && e.target instanceof Node && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all",
          selectedId
            ? "border-primary/30 bg-primary/5 text-foreground"
            : "border-border bg-background text-muted-foreground hover:text-foreground"
        )}
      >
        <TextT className="w-4 h-4" />
        <span className="max-w-[150px] truncate">
          {selectedDoc?.title || t("flashcardStudio.selectDocument")}
        </span>
        <CaretDown className={cn("w-3.5 h-3.5 transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-80 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="p-3 border-b border-border">
            <div className="relative">
              <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("flashcardStudio.searchDocuments")}
                className="w-full pl-9 pr-3 py-2 text-sm bg-muted/50 rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <button
              onClick={() => {
                onSelect(null);
                setIsOpen(false);
              }}
              className={cn(
                "w-full px-4 py-2.5 text-sm text-left transition-colors",
                !selectedId ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
              )}
            >
              <span className="flex items-center gap-2">
                <X className="w-4 h-4" />
                {t("flashcardStudio.noDocument")}
              </span>
            </button>
            {filteredDocs.map((doc) => (
              <button
                key={doc.id}
                onClick={() => {
                  onSelect(doc.id);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full px-4 py-2.5 text-sm text-left transition-colors",
                  selectedId === doc.id ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
                )}
              >
                <div className="font-medium truncate">{doc.title}</div>
              </button>
            ))}
            {filteredDocs.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t("flashcardStudio.noDocumentsFound")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Flat, always-expanded document list for use inside a mobile bottom sheet,
 * where the dropdown affordance is redundant (the sheet *is* the popover).
 */
export function DocumentSheetList({ documents, selectedId, onSelect }: DocumentSelectorProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");

  const filteredDocs = documents.filter((d) =>
    d.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div>
      <div className="px-4 pb-3">
        <div className="relative">
          <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("flashcardStudio.searchDocuments")}
            className="w-full pl-9 pr-3 py-2.5 text-base bg-muted/50 rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>
      <button
        onClick={() => onSelect(null)}
        className={cn(
          "w-full px-4 py-3 text-left text-[15px] min-h-[48px] flex items-center gap-3 transition-colors",
          !selectedId ? "bg-primary/10 text-primary" : "active:bg-muted"
        )}
      >
        <X className="w-4 h-4 flex-shrink-0" />
        {t("flashcardStudio.noDocument")}
      </button>
      {filteredDocs.map((doc) => (
        <button
          key={doc.id}
          onClick={() => onSelect(doc.id)}
          className={cn(
            "w-full px-4 py-3 text-left text-[15px] min-h-[48px] flex items-center gap-3 transition-colors",
            selectedId === doc.id ? "bg-primary/10 text-primary" : "active:bg-muted"
          )}
        >
          <TextT className="w-4 h-4 flex-shrink-0 opacity-60" />
          <span className="font-medium">{doc.title}</span>
        </button>
      ))}
      {filteredDocs.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {t("flashcardStudio.noDocumentsFound")}
        </div>
      )}
    </div>
  );
}
