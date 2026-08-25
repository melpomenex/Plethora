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
import { cloudTtsRequiresConsent, isPaidTtsProvider, requestPaidConsent } from "../utils/aiBillingConsent";
import { getOwnedObjectUrlBytes, revokeOwnedObjectUrl } from "../diagnostics/ownedObjectUrl";

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

// ---------------------------------------------------------------------------
// Bounded section-audio LRU (eliminate-long-running-memory-growth task 5.2)
//
// Previously a module-global Map with no cap, no revoke-on-replace (retrying
// a section orphaned the old URL's Blob), and no cleanup on edition
// deletion/cancellation — an N-section edition pinned N blob URLs for the
// whole session (incident finding 2). Now: LRU with documented count + byte
// caps, revoke on evict/replace, and explicit revoke on edition deletion,
// job cancellation, and source-document deletion. Ownership: entries are
// owned as "edition-section" + section id; nothing is revoked under an
// actively-playing section (the working set keeps touched entries recent).
// ---------------------------------------------------------------------------

/** Documented cap: at most 24 sections' URLs live at once. */
export const SECTION_AUDIO_CACHE_MAX_ENTRIES = 24;
/** Documented cap: at most 192 MB of synthesized section audio live at once. */
export const SECTION_AUDIO_CACHE_MAX_BYTES = 192 * 1024 * 1024;

/** Section id -> live blob URL (LRU order = Map insertion order). */
export const sectionAudioBlobCache = new Map<string, string>();
const sectionAudioByteEstimates = new Map<string, number>();

function sectionAudioTotalBytes(): number {
  let total = 0;
  for (const bytes of sectionAudioByteEstimates.values()) total += bytes;
  return total;
}

function evictOldestSectionAudio(): void {
  const oldest = sectionAudioBlobCache.keys().next().value as string | undefined;
  if (oldest !== undefined) revokeSectionAudioUrl(oldest);
}

function enforceSectionAudioBounds(): void {
  while (sectionAudioBlobCache.size > SECTION_AUDIO_CACHE_MAX_ENTRIES) {
    evictOldestSectionAudio();
  }
  // Keep at least one entry regardless of byte pressure (a single section
  // larger than the cap must not evict itself out from under playback).
  while (sectionAudioBlobCache.size > 1 && sectionAudioTotalBytes() > SECTION_AUDIO_CACHE_MAX_BYTES) {
    evictOldestSectionAudio();
  }
}

/** Record/replace one section's URL; the replaced URL is revoked (fixes the
 *  retry orphan). `bytes` falls back to the owned-URL registry estimate. */
export function setSectionAudioUrl(sectionId: string, url: string, bytes?: number): void {
  const previous = sectionAudioBlobCache.get(sectionId);
  if (previous && previous !== url) {
    revokeOwnedObjectUrl(previous);
  }
  sectionAudioBlobCache.delete(sectionId);
  sectionAudioBlobCache.set(sectionId, url);
  sectionAudioByteEstimates.set(sectionId, Math.max(bytes ?? 0, getOwnedObjectUrlBytes(url)));
  enforceSectionAudioBounds();
}

/** LRU-touching read: the least recently used entry is the eviction victim. */
export function getSectionAudioUrl(sectionId: string): string | undefined {
  const url = sectionAudioBlobCache.get(sectionId);
  if (url === undefined) return undefined;
  sectionAudioBlobCache.delete(sectionId);
  sectionAudioBlobCache.set(sectionId, url);
  const bytes = sectionAudioByteEstimates.get(sectionId) ?? 0;
  sectionAudioByteEstimates.delete(sectionId);
  sectionAudioByteEstimates.set(sectionId, bytes);
  return url;
}

/** Revoke one section's URL (removes it from the cache). */
export function revokeSectionAudioUrl(sectionId: string): void {
  const url = sectionAudioBlobCache.get(sectionId);
  sectionAudioBlobCache.delete(sectionId);
  sectionAudioByteEstimates.delete(sectionId);
  if (url) revokeOwnedObjectUrl(url);
}

/** Revoke many sections' URLs (edition deletion / job cancellation). */
export function revokeSectionAudioUrls(sectionIds: Iterable<string>): number {
  let revoked = 0;
  for (const sectionId of sectionIds) {
    if (sectionAudioBlobCache.has(sectionId)) {
      revokeSectionAudioUrl(sectionId);
      revoked += 1;
    }
  }
  return revoked;
}

/**
 * Bounded diagnostics view of the section-audio cache (task 3.5): entry
 * count plus byte estimates. No payload access, no content.
 */
export function getSectionAudioBlobCacheStats(): { entries: number; bytes: number } {
  return { entries: sectionAudioBlobCache.size, bytes: sectionAudioTotalBytes() };
}

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

        const providerId = edition.provider || "pocket";
        const adapter = getAdapter(providerId);

        // Paid/cloud gate (ai-billing-safety #14): never start a billable
        // audio-edition synthesis without consent. A denial leaves the job
        // untouched (no request is sent); the dialog surfaces the opt-in.
        const settings = useSettingsStore.getState().settings;
        if (isPaidTtsProvider(providerId) && cloudTtsRequiresConsent(providerId, settings)) {
          const granted = await requestPaidConsent({
            kind: "tts",
            provider: providerId,
            model: edition.model,
            label: adapter.label,
          });
          if (!granted) return;
        }

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

          // Global dictionary as the base layer, per-edition overrides merged
          // on top (task 3.7): dictionary edits in Settings affect newly
          // generated editions without per-edition re-entry.
          const mergedPronunciationDictionary: Record<string, string> = {
            ...(settings.tts?.pronunciationDictionary ?? {}),
            ...(parsedSettings.pronunciationDictionary ?? {}),
          };

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
              mergedPronunciationDictionary
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
                  // Bounded, revoke-on-replace LRU entry (task 5.2).
                  setSectionAudioUrl(section.id, res.audioUrl, res.audioData?.byteLength);
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
        // Revoke the edition's live section URLs (task 5.2): a cancelled job
        // must not leave synthesized blobs pinned for the session.
        try {
          const sections = await getAudioEditionSections(editionId);
          revokeSectionAudioUrls(sections.map((s) => s.id));
        } catch {
          /* edition already gone — nothing to revoke */
        }
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
