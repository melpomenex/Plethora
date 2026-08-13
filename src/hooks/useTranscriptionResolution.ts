import { useSettingsStore } from "../stores/settingsStore";
import { useTranscriptionStore } from "../stores/useTranscriptionStore";
import { isNativeMobile } from "../lib/tauri";
import { resolveTranscription } from "../lib/transcriptionProvider";

export function useTranscriptionResolution() {
  const audioSettings = useSettingsStore((state) => state.settings.audioTranscription);
  const profiles = useTranscriptionStore((state) => state.profiles);
  return resolveTranscription(
    audioSettings,
    profiles,
    isNativeMobile() ? "native-mobile" : "desktop",
  );
}
