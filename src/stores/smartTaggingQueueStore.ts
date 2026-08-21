/**
 * Smart Tagging Queue Store — Asynchronous background dispatcher and worker.
 *
 * Bounded concurrency (maximum 2 concurrent tagging jobs) to protect CPU,
 * memory, mobile battery, and AI provider rate limits.
 */

import { create } from "zustand";
import * as documentsApi from "../api/documents";
import { runSmartTagging } from "../lib/ai/tasks/definitions/smartTaggingTask";
import { classifyDocumentBaseline } from "../lib/smartTagging/baseline";
import { normalizeForComparison } from "../lib/smartTagging/normalization";
import { publishItemTagsUpdated } from "../lib/tagEditing/itemTagEvents";
import type { Document, SmartTagDetail } from "../types/document";
import { useDocumentStore } from "./documentStore";
import { useSettingsStore } from "./settingsStore";

const MAX_CONCURRENT_JOBS = 2;

export interface TaggingJob {
  documentId: string;
  forceRetag?: boolean;
  status: "queued" | "processing" | "completed" | "failed";
  enqueuedAt: number;
}

interface SmartTaggingQueueState {
  queue: TaggingJob[];
  activeJobsCount: number;
  enqueue: (documentId: string, options?: { forceRetag?: boolean }) => void;
  enqueueBatch: (documentIds: string[], options?: { forceRetag?: boolean }) => void;
  isProcessing: (documentId: string) => boolean;
}

export const useSmartTaggingQueueStore = create<SmartTaggingQueueState>((set, get) => {
  function pumpQueue() {
    const state = get();
    if (state.activeJobsCount >= MAX_CONCURRENT_JOBS) return;

    const nextJobIdx = state.queue.findIndex((j) => j.status === "queued");
    if (nextJobIdx === -1) return;

    const job = state.queue[nextJobIdx];
    const updatedQueue = [...state.queue];
    updatedQueue[nextJobIdx] = { ...job, status: "processing" };

    set({
      queue: updatedQueue,
      activeJobsCount: state.activeJobsCount + 1,
    });

    // Execute job asynchronously
    executeTaggingJob(job)
      .finally(() => {
        set((curr) => ({
          queue: curr.queue.filter((j) => j.documentId !== job.documentId),
          activeJobsCount: Math.max(0, curr.activeJobsCount - 1),
        }));
        // Pump next job in queue
        pumpQueue();
      });
  }

  return {
    queue: [],
    activeJobsCount: 0,

    enqueue: (documentId: string, options?: { forceRetag?: boolean }) => {
      if (!documentId) return;
      const existing = get().queue.find((j) => j.documentId === documentId);
      if (existing && existing.status !== "failed") {
        return;
      }

      set((state) => ({
        queue: [
          ...state.queue.filter((j) => j.documentId !== documentId),
          {
            documentId,
            forceRetag: options?.forceRetag,
            status: "queued",
            enqueuedAt: Date.now(),
          },
        ],
      }));

      // Trigger pump
      setTimeout(pumpQueue, 0);
    },

    enqueueBatch: (documentIds: string[], options?: { forceRetag?: boolean }) => {
      if (!documentIds || documentIds.length === 0) return;
      const existingSet = new Set(get().queue.map((j) => j.documentId));

      const newJobs: TaggingJob[] = [];
      for (const id of documentIds) {
        if (!id || existingSet.has(id)) continue;
        newJobs.push({
          documentId: id,
          forceRetag: options?.forceRetag,
          status: "queued",
          enqueuedAt: Date.now(),
        });
      }

      if (newJobs.length === 0) return;

      set((state) => ({
        queue: [...state.queue, ...newJobs],
      }));

      setTimeout(pumpQueue, 0);
    },

    isProcessing: (documentId: string) => {
      const job = get().queue.find((j) => j.documentId === documentId);
      return job ? job.status === "processing" || job.status === "queued" : false;
    },
  };
});

/**
 * Execute a single background tagging job for a document.
 */
async function executeTaggingJob(job: TaggingJob): Promise<void> {
  try {
    const doc = await documentsApi.getDocument(job.documentId);
    if (!doc || doc.isAiExcluded || doc.isDismissed) {
      return;
    }

    const settings = useSettingsStore.getState().settings.documents.smartTagging ?? {
      enabled: true,
      mode: "automatic",
      maxTagsPerDocument: 6,
      preferExistingTags: true,
    };

    if (!settings.enabled && !job.forceRetag) {
      return;
    }

    // 1. Gather existing library tags with item counts
    const allDocs = useDocumentStore.getState().documents;
    const tagCountMap = new Map<string, number>();
    for (const d of allDocs) {
      for (const t of d.tags || []) {
        tagCountMap.set(t, (tagCountMap.get(t) || 0) + 1);
      }
    }
    const existingLibraryTagsList = Array.from(tagCountMap.entries()).map(([name, itemCount]) => ({
      name,
      itemCount,
    }));

    // 2. Identify manual tags vs previous auto-tags vs dismissed tags
    const existingDetails: SmartTagDetail[] = doc.metadata?.smartTagDetails ? [...doc.metadata.smartTagDetails] : [];
    const dismissedTags: string[] = existingDetails
      .filter((d) => d.dismissed)
      .map((d) => d.tag);

    // If no smartTagDetails exist yet, any existing tags are considered manual tags
    const manualTags: string[] = [];
    for (const tag of doc.tags || []) {
      const detail = existingDetails.find((d) => d.tag.toLowerCase() === tag.toLowerCase());
      if (!detail || detail.provenance === "manual" || !job.forceRetag) {
        manualTags.push(tag);
      }
    }

    const maxTags = settings.maxTagsPerDocument || 6;

    // 3. Run tagging (Tier 2 LLM with Tier 1 baseline fallback)
    const content = doc.content || "";
    const result = await runSmartTagging({
      title: doc.title,
      author: doc.metadata?.author,
      category: doc.category,
      fileType: doc.fileType,
      content,
      existingLibraryTagsList,
      candidateExistingTags: existingLibraryTagsList.map((t) => t.name),
      manualTags,
      dismissedTags,
      maxTagsPerDocument: maxTags,
    });

    const smartDetails = result.tagDetails;

    // 4. Merge details
    const mergedDetails: SmartTagDetail[] = [];
    const seenNorms = new Set<string>();

    // Retain manual tags in details
    for (const tag of manualTags) {
      const norm = normalizeForComparison(tag);
      if (!seenNorms.has(norm)) {
        seenNorms.add(norm);
        const existingDet = existingDetails.find((d) => normalizeForComparison(d.tag) === norm);
        mergedDetails.push(
          existingDet || {
            tag,
            provenance: "manual",
            confidence: 1.0,
            reason: "User assigned",
            assignedAt: new Date().toISOString(),
          }
        );
      }
    }

    // Add smart tags
    for (const det of smartDetails) {
      const norm = normalizeForComparison(det.tag);
      if (!seenNorms.has(norm)) {
        seenNorms.add(norm);
        mergedDetails.push(det);
      }
    }

    // Preserve dismissed flags
    for (const det of existingDetails) {
      if (det.dismissed) {
        const norm = normalizeForComparison(det.tag);
        if (!seenNorms.has(norm)) {
          seenNorms.add(norm);
          mergedDetails.push(det);
        }
      }
    }

    // 5. Build final tag list
    let nextTags = [...doc.tags || []];
    if (settings.mode === "automatic" || job.forceRetag) {
      const autoTagsToAdd = smartDetails.map((d) => d.tag);
      const tagSet = new Set<string>();
      for (const t of manualTags) tagSet.add(t);
      for (const t of autoTagsToAdd) {
        if (!dismissedTags.some((dt) => normalizeForComparison(dt) === normalizeForComparison(t))) {
          tagSet.add(t);
        }
      }
      nextTags = Array.from(tagSet);
    }

    const updatedMetadata = {
      ...(doc.metadata || {}),
      smartTagDetails: mergedDetails,
    };

    const updatedDoc: Document = {
      ...doc,
      tags: nextTags,
      metadata: updatedMetadata,
    };

    // 6. Persist to database & update UI store
    await documentsApi.updateDocument(doc.id, updatedDoc);

    // Update in-memory document store
    useDocumentStore.setState((state) => ({
      documents: state.documents.map((d) => (d.id === doc.id ? updatedDoc : d)),
      currentDocument:
        state.currentDocument?.id === doc.id ? updatedDoc : state.currentDocument,
    }));

    // Publish reactive update event
    publishItemTagsUpdated({
      target: { type: "document", id: doc.id },
      tags: nextTags,
    });
  } catch (err) {
    console.warn(`[SmartTaggingQueue] Failed to process document ${job.documentId}:`, err);
  }
}
