import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { useTranscriptionStore } from "../stores/useTranscriptionStore";
import { isNativeMobile } from "../lib/tauri";
import { resolveTranscription } from "../lib/transcriptionProvider";
import { isAppleSpeechReady } from "../lib/ai/apple/speech";

export function useTranscriptionResolution() {
  const audioSettings = useSettingsStore((state) => state.settings.audioTranscription);
  const profiles = useTranscriptionStore((state) => state.profiles);
  const [appleReady, setAppleReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void isAppleSpeechReady()
      .then((ready) => {
        if (!cancelled) setAppleReady(ready);
      })
      .catch(() => {
        if (!cancelled) setAppleReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return resolveTranscription(
    audioSettings,
    profiles,
    isNativeMobile() ? "native-mobile" : "desktop",
    { appleReady },
  );
}
