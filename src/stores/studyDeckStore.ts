import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Document } from "../types/document";
import type { StudyDeck } from "../types/study-decks";
import { generateId } from "../utils/id";
import { getDeckTagCandidates, normalizeTagList } from "../utils/studyDecks";

interface StudyDeckState {
  decks: StudyDeck[];
  activeDeckIds: string[];
  toggleDeckSelection: (deckId: string | null) => void;
  clearDeckSelection: () => void;
  addDeck: (
    name: string,
    tagFilters?: string[],
    documentId?: string,
    filterType?: "all" | "tags" | "cram" | "difficulty",
    difficultyFilters?: number[],
    stateFilters?: string[]
  ) => string;
  updateDeck: (deckId: string, updates: Partial<StudyDeck>) => void;
  removeDeck: (deckId: string) => void;
  seedFromDocuments: (documents: Document[]) => void;
  ensureDecksExist: (deckNames: string[]) => string[];
}

type StudyDeckFilterType = NonNullable<StudyDeck["filterType"]>;

export function resolveStudyDeckFilterType(
  tagFilters: string[],
  documentId?: string,
  filterType?: StudyDeckFilterType,
): StudyDeckFilterType {
  if (filterType) return filterType;
  if (documentId) return "all";
  return tagFilters.length > 0 ? "tags" : "all";
}

export function migrateStudyDeckState(persisted: unknown, version: number): Record<string, unknown> {
  const state = (persisted && typeof persisted === "object" ? persisted : {}) as Record<string, unknown>;
  if (version < 2) {
    // Migrate activeDeckId (string | null) → activeDeckIds (string[])
    const oldId = state.activeDeckId as string | null | undefined;
    state.activeDeckIds = oldId ? [oldId] : [];
    delete state.activeDeckId;
    delete state.setActiveDeckId;
  }
  if (version < 3 && Array.isArray(state.decks)) {
    // `addDeck` historically defaulted every unbound tag deck to "all".
    // Those decks ignored their filters and matched the entire card library.
    state.decks = state.decks.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      const deck = value as Record<string, unknown>;
      const hasTags = Array.isArray(deck.tagFilters) && deck.tagFilters.some(
        (tag) => typeof tag === "string" && tag.trim().length > 0,
      );
      if (!deck.documentId && hasTags && deck.filterType === "all") {
        return { ...deck, filterType: "tags" };
      }
      return deck;
    });
  }
  return state;
}

export const useStudyDeckStore = create<StudyDeckState>()(
  persist(
    (set, get) => ({
      decks: [],
      activeDeckIds: [],

      toggleDeckSelection: (deckId) => {
        set((state) => {
          if (deckId === null) return { activeDeckIds: [] };
          const ids = state.activeDeckIds;
          return ids.includes(deckId)
            ? { activeDeckIds: ids.filter((id) => id !== deckId) }
            : { activeDeckIds: [...ids, deckId] };
        });
      },

      clearDeckSelection: () => {
        set({ activeDeckIds: [] });
      },

      addDeck: (
        name,
        tagFilters = [],
        documentId,
        filterType,
        difficultyFilters = [],
        stateFilters = []
      ) => {
        const trimmed = name.trim() || "Untitled Deck";
        const normalizedTags = normalizeTagList(tagFilters);
        const resolvedFilterType = resolveStudyDeckFilterType(normalizedTags, documentId, filterType);
        // Dedup: if a deck with the same name already exists, just merge tags or update settings
        const existing = get().decks.find((d) => d.name.toLowerCase() === trimmed.toLowerCase());
        if (existing) {
          const mergedTags = normalizeTagList([...existing.tagFilters, ...normalizedTags]);
          const inheritedFilterType = filterType ?? (
            existing.filterType === "all" && !existing.documentId && mergedTags.length > 0
              ? undefined
              : existing.filterType
          );
          const existingFilterType = resolveStudyDeckFilterType(
            mergedTags,
            documentId ?? existing.documentId,
            inheritedFilterType,
          );
          get().updateDeck(existing.id, {
            tagFilters: mergedTags,
            ...(documentId && { documentId }),
            filterType: existingFilterType,
            difficultyFilters,
            stateFilters,
          });
          return existing.id;
        }
        const now = new Date().toISOString();
        const deck: StudyDeck = {
          id: generateId(),
          name: trimmed,
          tagFilters: normalizedTags,
          ...(documentId && { documentId }),
          filterType: resolvedFilterType,
          difficultyFilters,
          stateFilters,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({ decks: [...state.decks, deck] }));
        return deck.id;
      },

      updateDeck: (deckId, updates) => {
        set((state) => ({
          decks: state.decks.map((deck) =>
            deck.id === deckId
              ? {
                  ...deck,
                  ...updates,
                  tagFilters: updates.tagFilters
                    ? normalizeTagList(updates.tagFilters)
                    : deck.tagFilters,
                  updatedAt: new Date().toISOString(),
                }
              : deck
          ),
        }));
      },

      removeDeck: (deckId) => {
        set((state) => {
          const nextDecks = state.decks.filter((deck) => deck.id !== deckId);
          const nextActiveIds = state.activeDeckIds.filter((id) => id !== deckId);
          return { decks: nextDecks, activeDeckIds: nextActiveIds };
        });
      },

      ensureDecksExist: (deckNames) => {
        const createdOrMatchedIds: string[] = [];
        for (const deckName of deckNames) {
          const state = get();
          const existing = state.decks.find(
            (deck) => deck.name.trim().toLowerCase() === deckName.trim().toLowerCase()
          );
          if (existing) {
            // Repair legacy auto-created decks that accidentally used the
            // all-library filter while retaining the same stable id. Preserve
            // intentionally configured smart/document decks on name collision.
            if (!existing.documentId && (existing.filterType === "all" || existing.filterType === "tags")) {
              get().addDeck(deckName, [deckName], undefined, "tags");
            }
            createdOrMatchedIds.push(existing.id);
            continue;
          }
          get().addDeck(deckName, [deckName], undefined, "tags");
          const updatedState = get();
          const created = updatedState.decks.find(
            (deck) => deck.name.trim().toLowerCase() === deckName.trim().toLowerCase()
          );
          if (created) {
            createdOrMatchedIds.push(created.id);
          }
        }
        return createdOrMatchedIds;
      },

      seedFromDocuments: (documents) => {
        const { decks } = get();
        if (decks.length > 0) return;

        const tagCandidates = new Set<string>();
        documents.forEach((doc) => {
          const tags = Array.isArray(doc.tags) ? doc.tags : [];
          if (tags.length === 0) return;
          if (!tags.some((tag) => tag.toLowerCase() === "anki-import" || tag.toLowerCase() === "study-json-import")) return;
          getDeckTagCandidates(tags).forEach((tag) => tagCandidates.add(tag));
        });

        if (tagCandidates.size === 0) return;

        const now = new Date().toISOString();
        const seeded = Array.from(tagCandidates).map((tag) => ({
          id: generateId(),
          name: tag,
          tagFilters: normalizeTagList([tag]),
          filterType: "tags" as const,
          createdAt: now,
          updatedAt: now,
        }));

        set({ decks: seeded });
      },
    }),
    {
      name: "incrementum-study-decks",
      version: 3,
      migrate: migrateStudyDeckState,
    }
  )
);
