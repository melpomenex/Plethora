/**
 * Audio Editions API
 * 
 * Manages first-class Audio Edition manifests, semantic section generation,
 * source-to-audio anchor lookup, and voice audition preview.
 */

import { invokeCommand, isTauri } from "../lib/tauri";
import type {
  AudioEdition,
  AudioEditionSection,
  AudioEditionAnchor,
  AudioEditionStatus,
  SectionGenerationStatus,
  AudioEditionSettings,
} from "../types/audioEdition";
import { getAdapter } from "./tts/registry";

// In-memory fallback for browser / mock mode
const browserEditionStore = new Map<string, AudioEdition>();
const browserSectionStore = new Map<string, AudioEditionSection[]>();
const browserAnchorStore = new Map<string, AudioEditionAnchor[]>();

export async function createAudioEdition(
  edition: AudioEdition,
  sections: AudioEditionSection[] = []
): Promise<AudioEdition> {
  if (!isTauri()) {
    browserEditionStore.set(edition.id, { ...edition, sections });
    browserSectionStore.set(edition.id, [...sections]);
    return { ...edition, sections };
  }

  return await invokeCommand<AudioEdition>("create_audio_edition", {
    edition: {
      ...edition,
      generationSettings: typeof edition.generationSettings === "object" && edition.generationSettings !== null
        ? JSON.stringify(edition.generationSettings)
        : edition.generationSettings,
    },
    sections,
  });
}

export async function getAudioEdition(id: string): Promise<AudioEdition | null> {
  if (!isTauri()) {
    const ed = browserEditionStore.get(id);
    if (!ed) return null;
    return { ...ed, sections: browserSectionStore.get(id) || [] };
  }

  return await invokeCommand<AudioEdition | null>("get_audio_edition", { id });
}

export async function getAudioEditionByDocument(documentId: string): Promise<AudioEdition | null> {
  if (!isTauri()) {
    for (const ed of browserEditionStore.values()) {
      if (ed.sourceDocumentId === documentId) {
        return { ...ed, sections: browserSectionStore.get(ed.id) || [] };
      }
    }
    return null;
  }

  return await invokeCommand<AudioEdition | null>("get_audio_edition_by_document", {
    documentId,
  });
}

export async function listAudioEditions(): Promise<AudioEdition[]> {
  if (!isTauri()) {
    return Array.from(browserEditionStore.values()).map(ed => ({
      ...ed,
      sections: browserSectionStore.get(ed.id) || [],
    }));
  }

  return await invokeCommand<AudioEdition[]>("list_audio_editions");
}

export async function updateAudioEditionStatus(
  id: string,
  status: AudioEditionStatus,
  totalDurationSec?: number
): Promise<void> {
  if (!isTauri()) {
    const ed = browserEditionStore.get(id);
    if (ed) {
      ed.status = status;
      if (totalDurationSec !== undefined) ed.totalDurationSec = totalDurationSec;
      ed.updatedAt = Date.now();
    }
    return;
  }

  await invokeCommand<void>("update_audio_edition_status", {
    id,
    status,
    totalDurationSec,
  });
}

export async function deleteAudioEdition(id: string): Promise<void> {
  if (!isTauri()) {
    browserEditionStore.delete(id);
    browserSectionStore.delete(id);
    return;
  }

  await invokeCommand<void>("delete_audio_edition", { id });
}

export async function getAudioEditionSection(id: string): Promise<AudioEditionSection | null> {
  if (!isTauri()) {
    for (const sections of browserSectionStore.values()) {
      const found = sections.find(s => s.id === id);
      if (found) return found;
    }
    return null;
  }

  return await invokeCommand<AudioEditionSection | null>("get_audio_edition_section", { id });
}

export async function getAudioEditionSections(editionId: string): Promise<AudioEditionSection[]> {
  if (!isTauri()) {
    return browserSectionStore.get(editionId) || [];
  }

  return await invokeCommand<AudioEditionSection[]>("get_audio_edition_sections", {
    editionId,
  });
}

export async function updateAudioEditionSectionStatus(
  id: string,
  generationStatus: SectionGenerationStatus,
  audioFilePath?: string,
  durationSec?: number,
  failureReason?: string
): Promise<void> {
  if (!isTauri()) {
    for (const sections of browserSectionStore.values()) {
      const found = sections.find(s => s.id === id);
      if (found) {
        found.generationStatus = generationStatus;
        if (audioFilePath) found.audioFilePath = audioFilePath;
        if (durationSec !== undefined && durationSec > 0) found.durationSec = durationSec;
        if (failureReason !== undefined) found.failureReason = failureReason;
        found.updatedAt = Date.now();
      }
    }
    return;
  }

  await invokeCommand<void>("update_audio_edition_section_status", {
    id,
    generationStatus,
    audioFilePath,
    durationSec,
    failureReason,
  });
}

export async function saveAudioEditionAnchors(
  sectionId: string,
  anchors: AudioEditionAnchor[]
): Promise<void> {
  if (!isTauri()) {
    browserAnchorStore.set(sectionId, anchors);
    return;
  }

  await invokeCommand<void>("save_audio_edition_anchors", {
    sectionId,
    anchors,
  });
}

export async function getAudioEditionAnchors(sectionId: string): Promise<AudioEditionAnchor[]> {
  if (!isTauri()) {
    return browserAnchorStore.get(sectionId) || [];
  }

  return await invokeCommand<AudioEditionAnchor[]>("get_audio_edition_anchors", {
    sectionId,
  });
}

export async function getAnchorsForEdition(editionId: string): Promise<AudioEditionAnchor[]> {
  if (!isTauri()) {
    const sections = browserSectionStore.get(editionId) || [];
    const allAnchors: AudioEditionAnchor[] = [];
    for (const s of sections) {
      const anchors = browserAnchorStore.get(s.id) || [];
      allAnchors.push(...anchors);
    }
    return allAnchors;
  }

  return await invokeCommand<AudioEditionAnchor[]>("get_anchors_for_edition", {
    editionId,
  });
}

export async function findAnchorByAudioTime(
  sectionId: string,
  timestampSec: number
): Promise<AudioEditionAnchor | null> {
  if (!isTauri()) {
    const anchors = browserAnchorStore.get(sectionId) || [];
    return anchors.find(a => timestampSec >= a.audioStartSec && timestampSec <= a.audioEndSec) || null;
  }

  return await invokeCommand<AudioEditionAnchor | null>("find_anchor_by_audio_time", {
    sectionId,
    timestampSec,
  });
}

export async function findAnchorBySource(
  editionId: string,
  sourceAnchor: string
): Promise<AudioEditionAnchor | null> {
  if (!isTauri()) {
    const sections = browserSectionStore.get(editionId) || [];
    for (const s of sections) {
      const anchors = browserAnchorStore.get(s.id) || [];
      const found = anchors.find(a => 
        a.sourceStartAnchor === sourceAnchor ||
        a.sourceEndAnchor === sourceAnchor ||
        (sourceAnchor >= a.sourceStartAnchor && sourceAnchor <= a.sourceEndAnchor)
      );
      if (found) return found;
    }
    return null;
  }

  return await invokeCommand<AudioEditionAnchor | null>("find_anchor_by_source", {
    editionId,
    sourceAnchor,
  });
}

/**
 * Audition a short voice preview directly from sample text.
 * Synthesizes 3-5 seconds of speech using the requested provider & voice.
 */
export async function auditionVoicePreview(
  text: string,
  providerId: string,
  modelId: string,
  voiceId: string,
  settings?: AudioEditionSettings
): Promise<Blob> {
  const adapter = getAdapter(providerId);
  if (!adapter) {
    throw new Error(`TTS provider adapter '${providerId}' is not registered or supported.`);
  }

  const sample = text.trim().slice(0, 200) || "This is an audition of the selected voice for your audio edition.";
  const result = await adapter.synthesize(
    {
      settings: {} as any,
      tts: {} as any,
      config: {} as any,
    },
    {
      text: sample,
      voice: voiceId,
      model: modelId,
      speed: settings?.speed || 1.0,
      responseFormat: (settings?.responseFormat as "mp3" | "opus" | "aac" | "wav") || "mp3",
    }
  );

  if (result.audioData) {
    return new Blob([result.audioData], { type: result.mimeType || "audio/mp3" });
  }
  if (result.audioUrl) {
    const res = await fetch(result.audioUrl);
    return await res.blob();
  }
  throw new Error("No audio returned from provider audition.");
}
