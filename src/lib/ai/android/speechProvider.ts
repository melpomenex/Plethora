import { OnDeviceAiError } from "../onDeviceAI";
import { unavailableDescriptor } from "../capabilities/types";
import type { PlatformCapabilityDescriptor } from "../capabilities/types";
import type { SpeechProvider, TranscribeAudioRequest, Transcript } from "../capabilities/speech";
import { invokeAndroidPlugin, isAndroidAiPluginPlatform } from "./bridge";
import { useSettingsStore } from "../../../stores/settingsStore";

const PLUGIN = "plethora-android-speech";

/**
 * Persist the recording to app-private storage before STT.
 * Live recognition is best-effort and must not replace this path.
 */
export function requirePersistedSpeechSource(sourceUri: string): string {
  const trimmed = sourceUri.trim();
  if (!trimmed) {
    throw new OnDeviceAiError("invalid_argument", "Speech source must be a persisted file URI.");
  }
  return trimmed;
}

export function userPrefersAndroidSpeech(): boolean {
  return useSettingsStore.getState().settings.audioTranscription.preferAndroidSpeech === true;
}

export class AndroidSpeechProvider implements SpeechProvider {
  readonly id = "android-mlkit-speech";

  async getCapability(): Promise<PlatformCapabilityDescriptor> {
    if (!isAndroidAiPluginPlatform() || !userPrefersAndroidSpeech()) {
      return unavailableDescriptor("speech.transcribe", "platform_unsupported");
    }
    try {
      return await invokeAndroidPlugin<PlatformCapabilityDescriptor>(PLUGIN, "speech_status");
    } catch {
      return unavailableDescriptor("speech.transcribe", "platform_unsupported");
    }
  }

  async transcribeAudio(req: TranscribeAudioRequest): Promise<Transcript> {
    const sourceUri = requirePersistedSpeechSource(req.sourceUri);
    if (!userPrefersAndroidSpeech()) {
      throw new OnDeviceAiError(
        "feature_unavailable",
        "Android speech is off; the configured transcription provider is used instead."
      );
    }
    return invokeAndroidPlugin<Transcript>(PLUGIN, "transcribe_audio", {
      request: { sourceUri, language: req.language },
    });
  }
}

export function getAndroidSpeechProvider(): SpeechProvider {
  return new AndroidSpeechProvider();
}
