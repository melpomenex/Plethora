import { isLocalNemotronInstalled } from "../../api/transcription";
import { getTranscriptionProfiles } from "../../api/transcription";
import { isTauri } from "../../lib/tauri";
import {
  LOGICAL_STT_MODELS,
  LOGICAL_STT_MODEL_KEYS,
  TRANSCRIPTION_PROVIDER_IDS,
} from "./config";
import { canRunLocalNemotron } from "./DeviceCapabilityService";
import type { TranscriptionCapabilities, TranscriptionModel } from "./types";

const WHISPER_CAPABILITIES: TranscriptionCapabilities = {
  fileTranscription: true,
  streaming: false,
  pseudoStreaming: false,
  segmentTimestamps: true,
  wordTimestamps: false,
  diarization: false,
  languageDetection: false,
  customVocabulary: false,
  offline: true,
  supportedLanguages: "auto",
};

const NEMOTRON_CAPABILITIES: TranscriptionCapabilities = {
  ...WHISPER_CAPABILITIES,
  streaming: false,
};

/** List installed local ASR models for settings pickers and LocalTranscriptionProvider. */
export async function listLocalSttModels(): Promise<TranscriptionModel[]> {
  const models: TranscriptionModel[] = [];

  if (isTauri() && canRunLocalNemotron()) {
    const nemotronInstalled = await isLocalNemotronInstalled();
    const nemotron = LOGICAL_STT_MODELS[LOGICAL_STT_MODEL_KEYS.NEMOTRON];
    models.push({
      id: LOGICAL_STT_MODEL_KEYS.NEMOTRON,
      providerId: TRANSCRIPTION_PROVIDER_IDS.LOCAL_NEMOTRON,
      displayName: nemotron.displayName,
      local: true,
      installed: nemotronInstalled,
      sizeBytes: 778_043_392,
      capabilities: NEMOTRON_CAPABILITIES,
    });
  }

  try {
    const profiles = await getTranscriptionProfiles();
    for (const profile of profiles.filter((p) => p.installed)) {
      models.push({
        id: profile.id,
        providerId: TRANSCRIPTION_PROVIDER_IDS.LOCAL_WHISPER,
        displayName: profile.name || profile.id,
        local: true,
        installed: true,
        capabilities: WHISPER_CAPABILITIES,
      });
    }
  } catch {
    /* desktop-only */
  }

  return models;
}
