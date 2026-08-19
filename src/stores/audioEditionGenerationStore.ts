/**
 * Audio Edition Progressive Generation Queue Store
 * 
 * Manages background synthesis jobs, per-section error isolation,
 * anchor generation, pause/resume, and retry operations.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  getAudioEdition,
  getAudioEditionSections,
  updateAudioEditionSectionStatus,
  updateAudioEditionStatus,
  saveAudioEditionAnchors,
} from "../api/audioEditions";
import { getAdapter } from "../api/tts/registry";
import { resolveProviderKey } from "../api/tts/auth";
import { useSettingsStore } from "./settingsStore";
import { computeSentenceAnchors } from "../utils/audioEditionAnchors";
import type { AudioEditionSettings } from "../types/audioEdition";

export interface GenerationJob {
  editionId: string;
  documentId: string;
  status: "idle" | "generating" | "paused" | "completed" | "error";
  totalSections: number;
  completedSections: number;
  failedSections: number;
  currentSectionId: string | null;
  progressPercent: number;
  error?: string | null;
  startedAt?: number;
  completedAt?: number;
}

interface AudioEditionGenerationState {
  jobs: Record<string, GenerationJob>;
  activeJobs: string[];
  isGlobalPaused: boolean;

  // Actions
  startJob: (editionId: string, sectionTextMap?: Record<string, string>) => Promise<void>;
  pauseJob: (editionId: string) => void;
  resumeJob: (editionId: string, sectionTextMap?: Record<string, string>) => Promise<void>;
  cancelJob: (editionId: string) => Promise<void>;
  retrySection: (editionId: string, sectionId: string, sectionText: string) => Promise<void>;
  retryFailedSections: (editionId: string, sectionTextMap?: Record<string, string>) => Promise<void>;
  getJob: (editionId: string) => GenerationJob | undefined;
}

// In-memory control flags for stopping running workers
const pausedJobIds = new Set<string>();
const cancelledJobIds = new Set<string>();

// Blob cache for browser / synthesized audio URLs
export const sectionAudioBlobCache = new Map<string, string>();

/**
 * Apply pronunciation dictionary substitutions to text before synthesis
 */
export function applyPronunciationDictionary(
  text: string,
  dictionary?: Record<string, string>
): string {
  if (!text || !dictionary || Object.keys(dictionary).length === 0) {
    return text;
  }

  let transformed = text;
  for (const [word, replacement] of Object.entries(dictionary)) {
    if (!word || !replacement) continue;
    try {
      // Word boundary match case-insensitively
      const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      transformed = transformed.replace(regex, replacement);
    } catch {
      // Fallback simple replace
      transformed = transformed.split(word).join(replacement);
    }
  }

  return transformed;
}

export const useAudioEditionGenerationStore = create<AudioEditionGenerationState>()(
  persist(
    (set, get) => ({
      jobs: {},
      activeJobs: [],
      isGlobalPaused: false,

      getJob: (editionId: string) => {
        return get().jobs[editionId];
      },

      startJob: async (editionId: string, sectionTextMap = {}) => {
        pausedJobIds.delete(editionId);
        cancelledJobIds.delete(editionId);

        const edition = await getAudioEdition(editionId);
        if (!edition) return;

        const sections = await getAudioEditionSections(editionId);
        if (sections.length === 0) return;

        const initialJob: GenerationJob = {
          editionId,
          documentId: edition.sourceDocumentId,
          status: "generating",
          totalSections: sections.length,
          completedSections: sections.filter((s) => s.generationStatus === "ready").length,
          failedSections: sections.filter((s) => s.generationStatus === "failed").length,
          currentSectionId: null,
          progressPercent: Math.round(
            (sections.filter((s) => s.generationStatus === "ready").length / sections.length) * 100
          ),
          startedAt: Date.now(),
        };

        set((state) => ({
          jobs: { ...state.jobs, [editionId]: initialJob },
          activeJobs: Array.from(new Set([...state.activeJobs, editionId])),
        }));

        await updateAudioEditionStatus(editionId, "generating");

        // Execute sequential section worker
        (async () => {
          const settings = useSettingsStore.getState().settings;
          const providerId = edition.provider || "pocket";
          const adapter = getAdapter(providerId);
          const resolvedKey = resolveProviderKey(adapter, settings);

          let parsedSettings: AudioEditionSettings = {};
          if (typeof edition.generationSettings === "string") {
            try {
              parsedSettings = JSON.parse(edition.generationSettings);
            } catch {
              /* ignore */
            }
          } else if (edition.generationSettings) {
            parsedSettings = edition.generationSettings;
          }

          for (const section of sections) {
            if (pausedJobIds.has(editionId) || cancelledJobIds.has(editionId)) {
              break;
            }

            // Skip already synthesized sections
            if (section.generationStatus === "ready") {
              continue;
            }

            set((state) => {
              const currentJob = state.jobs[editionId];
              if (!currentJob) return state;
              return {
                jobs: {
                  ...state.jobs,
                  [editionId]: {
                    ...currentJob,
                    currentSectionId: section.id,
                  },
                },
              };
            });

            await updateAudioEditionSectionStatus(section.id, "generating");

            const rawText = sectionTextMap[section.id] || section.title;
            const textToSynthesize = applyPronunciationDictionary(
              rawText,
              parsedSettings.pronunciationDictionary
            );

            try {
              let durationSec = 10;
              let audioFilePath = "";

              if (adapter) {
                const res = await adapter.synthesize(
                  {
                    settings,
                    tts: { ...settings.tts },
                    config: {
                      ...(settings.tts.providers[edition.provider as keyof typeof settings.tts.providers] || {}),
                      modelId: edition.model,
                      speed: parsedSettings.speed || 1.0,
                    } as any,
                    apiKey: resolvedKey.key || undefined,
                    borrowedFrom: resolvedKey.source,
                  },
                  {
                    text: textToSynthesize,
                    model: edition.model,
                    voice: edition.voice,
                    responseFormat: "mp3",
                    speed: parsedSettings.speed || 1.0,
                  }
                );

                if (res.audioUrl) {
                  audioFilePath = res.audioUrl;
                  sectionAudioBlobCache.set(section.id, res.audioUrl);
                }
                if (res.durationSec && res.durationSec > 0) {
                  durationSec = res.durationSec;
                } else {
                  // Fallback estimate ~15 chars/sec
                  durationSec = Math.max(2, Math.ceil(textToSynthesize.length / 15));
                }
              }

              // Compute and save anchors
              const anchors = computeSentenceAnchors(
                section.id,
                rawText,
                durationSec,
                section.sourceStartAnchor || "0"
              );
              if (anchors.length > 0) {
                await saveAudioEditionAnchors(section.id, anchors);
              }

              await updateAudioEditionSectionStatus(
                section.id,
                "ready",
                audioFilePath,
                durationSec
              );

              set((state) => {
                const currentJob = state.jobs[editionId];
                if (!currentJob) return state;
                const newCompleted = currentJob.completedSections + 1;
                return {
                  jobs: {
                    ...state.jobs,
                    [editionId]: {
                      ...currentJob,
                      completedSections: newCompleted,
                      progressPercent: Math.round((newCompleted / currentJob.totalSections) * 100),
                    },
                  },
                };
              });
            } catch (err: any) {
              console.error(`Section synthesis failed for section ${section.id}:`, err);
              await updateAudioEditionSectionStatus(
                section.id,
                "failed",
                undefined,
                undefined,
                err?.message || "Synthesis failed"
              );

              set((state) => {
                const currentJob = state.jobs[editionId];
                if (!currentJob) return state;
                return {
                  jobs: {
                    ...state.jobs,
                    [editionId]: {
                      ...currentJob,
                      failedSections: currentJob.failedSections + 1,
                    },
                  },
                };
              });
            }
          }

          // Finalize job status
          const updatedSections = await getAudioEditionSections(editionId);
          const totalDuration = updatedSections.reduce((acc, s) => acc + (s.durationSec || 0), 0);
          const allSuccess = updatedSections.every((s) => s.generationStatus === "ready");
          const anySuccess = updatedSections.some((s) => s.generationStatus === "ready");

          const finalStatus = allSuccess ? "ready" : anySuccess ? "generating" : "failed";
          await updateAudioEditionStatus(editionId, finalStatus, totalDuration);

          set((state) => {
            const currentJob = state.jobs[editionId];
            if (!currentJob) return state;
            return {
              jobs: {
                ...state.jobs,
                [editionId]: {
                  ...currentJob,
                  status: allSuccess ? "completed" : "error",
                  currentSectionId: null,
                  completedAt: Date.now(),
                },
              },
              activeJobs: state.activeJobs.filter((id) => id !== editionId),
            };
          });
        })();
      },

      pauseJob: (editionId: string) => {
        pausedJobIds.add(editionId);
        set((state) => {
          const currentJob = state.jobs[editionId];
          if (!currentJob) return state;
          return {
            jobs: {
              ...state.jobs,
              [editionId]: {
                ...currentJob,
                status: "paused",
              },
            },
            activeJobs: state.activeJobs.filter((id) => id !== editionId),
          };
        });
      },

      resumeJob: async (editionId: string, sectionTextMap = {}) => {
        pausedJobIds.delete(editionId);
        await get().startJob(editionId, sectionTextMap);
      },

      cancelJob: async (editionId: string) => {
        cancelledJobIds.add(editionId);
        pausedJobIds.delete(editionId);
        await updateAudioEditionStatus(editionId, "draft");

        set((state) => {
          const jobs = { ...state.jobs };
          delete jobs[editionId];
          return {
            jobs,
            activeJobs: state.activeJobs.filter((id) => id !== editionId),
          };
        });
      },

      retrySection: async (editionId: string, sectionId: string, sectionText: string) => {
        await updateAudioEditionSectionStatus(sectionId, "queued");
        await get().startJob(editionId, { [sectionId]: sectionText });
      },

      retryFailedSections: async (editionId: string, sectionTextMap = {}) => {
        const sections = await getAudioEditionSections(editionId);
        for (const s of sections) {
          if (s.generationStatus === "failed") {
            await updateAudioEditionSectionStatus(s.id, "queued");
          }
        }
        await get().startJob(editionId, sectionTextMap);
      },
    }),
    {
      name: "audio-edition-generation-store",
      partialize: (state) => ({
        jobs: state.jobs,
      }),
    }
  )
);
