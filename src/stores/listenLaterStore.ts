/**
 * Listen Later Queue Store & Auto-Advancing Audio Playlist
 * 
 * Manages an ordered queue of readable documents/articles for continuous playback
 * with lazy vs. immediate synthesis scheduling.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Document } from "../types/document";
import { useAudioEditionGenerationStore } from "./audioEditionGenerationStore";
import { getAudioEditionByDocument, createAudioEdition } from "../api/audioEditions";
import { extractArticleSemanticSections, stripHtmlTags } from "../utils/sectionIndex";

export interface ListenLaterItem {
  id: string;
  documentId: string;
  title: string;
  author?: string;
  fileType: string;
  characterCount: number;
  durationSec: number;
  editionId?: string;
  isSynthesized: boolean;
  addedAt: number;
}

export type SynthesisSchedulerMode = "lazy" | "immediate";

interface ListenLaterState {
  queue: ListenLaterItem[];
  currentIndex: number;
  isPlaying: boolean;
  schedulerMode: SynthesisSchedulerMode;

  // Actions
  addItem: (doc: Document) => Promise<void>;
  removeItem: (id: string) => void;
  clearQueue: () => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  setCurrentIndex: (index: number) => void;
  nextTrack: () => void;
  prevTrack: () => void;
  setPlaying: (playing: boolean) => void;
  setSchedulerMode: (mode: SynthesisSchedulerMode) => void;
  ensureItemSynthesized: (item: ListenLaterItem) => Promise<string | undefined>;
}

export const useListenLaterStore = create<ListenLaterState>()(
  persist(
    (set, get) => ({
      queue: [],
      currentIndex: 0,
      isPlaying: false,
      schedulerMode: "lazy",

      addItem: async (doc: Document) => {
        const existing = get().queue.find((item) => item.documentId === doc.id);
        if (existing) return;

        const rawContent = doc.content || "";
        const charCount = rawContent.length;
        const estDuration = Math.max(10, Math.ceil(charCount / 15));

        const newItem: ListenLaterItem = {
          id: `ll-${doc.id}-${Date.now()}`,
          documentId: doc.id,
          title: doc.title || "Untitled Document",
          author: doc.metadata?.author,
          fileType: doc.fileType,
          characterCount: charCount,
          durationSec: estDuration,
          isSynthesized: false,
          addedAt: Date.now(),
        };

        set((state) => ({
          queue: [...state.queue, newItem],
        }));

        if (get().schedulerMode === "immediate") {
          void get().ensureItemSynthesized(newItem);
        }
      },

      removeItem: (id: string) => {
        set((state) => {
          const filtered = state.queue.filter((item) => item.id !== id);
          const nextIndex = Math.min(state.currentIndex, Math.max(0, filtered.length - 1));
          return {
            queue: filtered,
            currentIndex: nextIndex,
          };
        });
      },

      clearQueue: () => {
        set({ queue: [], currentIndex: 0, isPlaying: false });
      },

      reorderQueue: (fromIndex: number, toIndex: number) => {
        set((state) => {
          const next = [...state.queue];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved);
          return { queue: next };
        });
      },

      setCurrentIndex: (index: number) => {
        const len = get().queue.length;
        if (index >= 0 && index < len) {
          set({ currentIndex: index });
          const item = get().queue[index];
          if (item) {
            void get().ensureItemSynthesized(item);
          }
        }
      },

      nextTrack: () => {
        const { queue, currentIndex } = get();
        if (currentIndex < queue.length - 1) {
          get().setCurrentIndex(currentIndex + 1);
        } else {
          set({ isPlaying: false });
        }
      },

      prevTrack: () => {
        const { currentIndex } = get();
        if (currentIndex > 0) {
          get().setCurrentIndex(currentIndex - 1);
        }
      },

      setPlaying: (playing: boolean) => {
        set({ isPlaying: playing });
      },

      setSchedulerMode: (mode: SynthesisSchedulerMode) => {
        set({ schedulerMode: mode });
        if (mode === "immediate") {
          // Trigger immediate synthesis for all unsynthesized queued items
          get().queue.forEach((item) => {
            if (!item.isSynthesized) {
              void get().ensureItemSynthesized(item);
            }
          });
        }
      },

      ensureItemSynthesized: async (item: ListenLaterItem): Promise<string | undefined> => {
        try {
          const existingEd = await getAudioEditionByDocument(item.documentId);
          if (existingEd) {
            set((state) => ({
              queue: state.queue.map((q) =>
                q.id === item.id ? { ...q, editionId: existingEd.id, isSynthesized: existingEd.status === "ready" } : q
              ),
            }));
            return existingEd.id;
          }

          // Create new edition for the item
          const sections = extractArticleSemanticSections(item.title);
          const editionId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `ed-${Date.now()}`;
          const audioSections = sections.map((s, idx) => ({
            id: `sec-${editionId}-${idx}`,
            editionId,
            sectionIndex: idx,
            title: s.title,
            characterCount: s.characterCount,
            audioMimeType: "audio/mp3",
            durationSec: 0,
            generationStatus: "queued" as const,
            retryCount: 0,
            cacheKey: `k-${editionId}-${idx}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }));

          const newEd = await createAudioEdition(
            {
              id: editionId,
              sourceDocumentId: item.documentId,
              sourceRevisionHash: `rev-${Date.now()}`,
              provider: "pocket",
              model: "default",
              voice: "alba",
              totalDurationSec: item.durationSec,
              status: "draft",
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            audioSections
          );

          set((state) => ({
            queue: state.queue.map((q) =>
              q.id === item.id ? { ...q, editionId: newEd.id } : q
            ),
          }));

          const textMap: Record<string, string> = {};
          audioSections.forEach((s, idx) => {
            textMap[s.id] = sections[idx]?.content || s.title;
          });

          await useAudioEditionGenerationStore.getState().startJob(editionId, textMap);
          return editionId;
        } catch (err) {
          console.warn("Failed to synthesize listen-later item:", err);
          return undefined;
        }
      },
    }),
    {
      name: "plethora-listen-later-store",
      partialize: (state) => ({
        queue: state.queue,
        currentIndex: state.currentIndex,
        schedulerMode: state.schedulerMode,
      }),
    }
  )
);
