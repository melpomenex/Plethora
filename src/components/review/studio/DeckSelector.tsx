/**
 * DeckSelector — dropdown for choosing (or creating) the deck generated cards
 * are filed into. Moved verbatim out of `FlashcardStudioModal.tsx` so it can be
 * rendered inline (desktop) or inside a bottom sheet (mobile).
 */

import { useEffect, useRef, useState } from "react";
import { CaretDown, Check, FolderOpen, Plus, X } from "@phosphor-icons/react";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../utils";

export interface DeckSelectorProps {
  decks: { id: string; name: string; tagFilters: string[] }[];
  selectedId: string | null;
  suggestedName?: string;
  onSelect: (id: string | null) => void;
  onCreateDeck: (name: string) => string | null;
}

export function DeckSelector({
  decks,
  selectedId,
  suggestedName,
  onSelect,
  onCreateDeck,
}: DeckSelectorProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedDeck = decks.find((d) => d.id === selectedId);
  const defaultDeckName = suggestedName?.trim() || "";

  useEffect(() => {
    if (isOpen && isCreating) {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen, isCreating]);

  const beginCreate = () => {
    setIsCreating(true);
    setNewDeckName(defaultDeckName);
  };

  const cancelCreate = () => {
    setIsCreating(false);
    setNewDeckName("");
  };

  const submitCreate = () => {
    const name = newDeckName.trim() || defaultDeckName || t("flashcardStudio.untitledDeck");
    const deckId = onCreateDeck(name);
    if (!deckId) return;
    onSelect(deckId);
    setIsCreating(false);
    setNewDeckName("");
    setIsOpen(false);
  };

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
        <FolderOpen className="w-4 h-4" />
        <span className="max-w-[120px] truncate">
          {selectedDeck?.name || t("flashcardStudio.selectDeck")}
        </span>
        <CaretDown className={cn("w-3.5 h-3.5 transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="border-b border-border p-2">
            {isCreating ? (
              <div className="space-y-2">
                <input
                  ref={inputRef}
                  value={newDeckName}
                  onChange={(e) => setNewDeckName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitCreate();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      cancelCreate();
                    }
                  }}
                  placeholder={t("flashcardStudio.deckNamePlaceholder")}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={cancelCreate}
                    className="rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {t("flashcardStudio.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={submitCreate}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {t("flashcardStudio.createDeck")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={beginCreate}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-primary/10"
              >
                <Plus className="h-4 w-4" />
                <span>{t("flashcardStudio.newDeck")}</span>
              </button>
            )}
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
                {t("flashcardStudio.noDeck")}
              </span>
            </button>
            {decks.length === 0 && !isCreating && (
              <div className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                {t("flashcardStudio.noDecksHint")}
              </div>
            )}
            {decks.map((deck) => (
              <button
                key={deck.id}
                onClick={() => {
                  onSelect(deck.id);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full px-4 py-2.5 text-sm text-left transition-colors",
                  selectedId === deck.id ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
                )}
              >
                <div className="font-medium">{deck.name}</div>
                {deck.tagFilters.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {deck.tagFilters.slice(0, 3).map((tag) => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-muted rounded-full">
                        {tag}
                      </span>
                    ))}
                    {deck.tagFilters.length > 3 && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded-full">
                        +{deck.tagFilters.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Flat, always-expanded deck list (including inline creation) for use inside a
 * mobile bottom sheet, where the dropdown affordance is redundant.
 */
export function DeckSheetList({
  decks,
  selectedId,
  suggestedName,
  onSelect,
  onCreateDeck,
}: DeckSelectorProps) {
  const { t } = useI18n();
  const [isCreating, setIsCreating] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const defaultDeckName = suggestedName?.trim() || "";

  useEffect(() => {
    if (isCreating) {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isCreating]);

  const submitCreate = () => {
    const name = newDeckName.trim() || defaultDeckName || t("flashcardStudio.untitledDeck");
    const deckId = onCreateDeck(name);
    if (!deckId) return;
    onSelect(deckId);
    setIsCreating(false);
    setNewDeckName("");
  };

  return (
    <div>
      <div className="border-b border-border px-4 pb-3">
        {isCreating ? (
          <div className="space-y-2">
            <input
              ref={inputRef}
              value={newDeckName}
              onChange={(e) => setNewDeckName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitCreate();
                }
                if (e.key === "Escape") {
                  // Cancel creation without letting the sheet's own Escape
                  // handler close the whole sheet.
                  e.preventDefault();
                  e.stopPropagation();
                  setIsCreating(false);
                  setNewDeckName("");
                }
              }}
              placeholder={t("flashcardStudio.deckNamePlaceholder")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base text-foreground outline-none focus:ring-2 focus:ring-primary/40"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsCreating(false);
                  setNewDeckName("");
                }}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground active:bg-muted"
              >
                {t("flashcardStudio.cancel")}
              </button>
              <button
                type="button"
                onClick={submitCreate}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
              >
                <Check className="h-4 w-4" />
                {t("flashcardStudio.createDeck")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setIsCreating(true);
              setNewDeckName(defaultDeckName);
            }}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left text-[15px] font-medium text-primary min-h-[48px] active:bg-primary/10"
          >
            <Plus className="h-4 w-4" />
            <span>{t("flashcardStudio.newDeck")}</span>
          </button>
        )}
      </div>
      <button
        onClick={() => onSelect(null)}
        className={cn(
          "w-full px-4 py-3 text-left text-[15px] min-h-[48px] flex items-center gap-3 transition-colors",
          !selectedId ? "bg-primary/10 text-primary" : "active:bg-muted"
        )}
      >
        <X className="w-4 h-4 flex-shrink-0" />
        {t("flashcardStudio.noDeck")}
      </button>
      {decks.length === 0 && !isCreating && (
        <div className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {t("flashcardStudio.noDecksHint")}
        </div>
      )}
      {decks.map((deck) => (
        <button
          key={deck.id}
          onClick={() => onSelect(deck.id)}
          className={cn(
            "w-full px-4 py-3 text-left min-h-[48px] transition-colors",
            selectedId === deck.id ? "bg-primary/10 text-primary" : "active:bg-muted"
          )}
        >
          <div className="flex items-center gap-3 text-[15px] font-medium">
            <FolderOpen className="w-4 h-4 flex-shrink-0 opacity-60" />
            {deck.name}
          </div>
          {deck.tagFilters.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1 pl-7">
              {deck.tagFilters.slice(0, 3).map((tag) => (
                <span key={tag} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                  {tag}
                </span>
              ))}
              {deck.tagFilters.length > 3 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                  +{deck.tagFilters.length - 3}
                </span>
              )}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
