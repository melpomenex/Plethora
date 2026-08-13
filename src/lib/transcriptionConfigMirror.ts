import { invokeCommand, isTauri } from "./tauri";
import { useSettingsStore } from "../stores/settingsStore";

type AudioSettings = ReturnType<typeof useSettingsStore.getState>["settings"]["audioTranscription"];

function mirroredConfig(settings: AudioSettings) {
  return {
    provider: settings.provider,
    preferred_model_id: settings.preferredModelId ?? null,
    language: settings.language,
  };
}

async function writeMirror(settings: AudioSettings): Promise<void> {
  if (!isTauri()) return;
  try {
    await invokeCommand("set_transcription_config", { config: mirroredConfig(settings) });
  } catch (error) {
    console.warn("Failed to mirror transcription settings:", error);
  }
}

export function startTranscriptionConfigMirror(): () => void {
  if (!isTauri()) return () => {};

  let previous = useSettingsStore.getState().settings.audioTranscription;
  void writeMirror(previous);
  return useSettingsStore.subscribe((state) => {
    const next = state.settings.audioTranscription;
    if (next === previous) return;
    previous = next;
    void writeMirror(next);
  });
}
