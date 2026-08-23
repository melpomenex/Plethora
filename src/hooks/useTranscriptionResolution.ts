import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { useTranscriptionStore } from "../stores/useTranscriptionStore";
import { isNativeMobile } from "../lib/tauri";
import { resolveTranscription } from "../lib/transcriptionProvider";
import { isAppleSpeechReady } from "../lib/ai/apple/speech";
import { isAndroidSttReady } from "../lib/ai/android/androidStt";

export function useTranscriptionResolution() {
  const audioSettings = useSettingsStore((state) => state.settings.audioTranscription);
  const profiles = useTranscriptionStore((state) => state.profiles);
  const [appleReady, setAppleReady] = useState(false);
  const [androidSttReady, setAndroidSttReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void isAppleSpeechReady()
      .then((ready) => {
        if (!cancelled) setAppleReady(ready);
      })
      .catch(() => {
        if (!cancelled) setAppleReady(false);
      });
    void isAndroidSttReady()
      .then((ready) => {
        if (!cancelled) setAndroidSttReady(ready);
      })
      .catch(() => {
        if (!cancelled) setAndroidSttReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return resolveTranscription(
    audioSettings,
    profiles,
    isNativeMobile() ? "native-mobile" : "desktop",
    { appleReady, androidSttReady },
  );
}
