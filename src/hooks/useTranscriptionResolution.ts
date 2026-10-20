import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { useTranscriptionStore } from "../stores/useTranscriptionStore";
import { isNativeMobile } from "../lib/tauri";
import {
  resolveSessionTranscriptionPlan,
  resolveTranscription,
} from "../lib/transcriptionProvider";
import type { SessionTranscriptionPlanResult } from "../services/transcription/types";
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

export function useSessionTranscriptionPlan(
  session: { id: string; origin?: string; assetId?: string; transcriptRevision?: number },
  documentPrivacy: { isLocalOnly: boolean; isAiExcluded: boolean }
) {
  const audioSettings = useSettingsStore((state) => state.settings.audioTranscription);
  const profiles = useTranscriptionStore((state) => state.profiles);
  const [planResult, setPlanResult] = useState<SessionTranscriptionPlanResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      isAppleSpeechReady().catch(() => false),
      isAndroidSttReady().catch(() => false),
    ]).then(([apple, android]) => {
      if (cancelled) return;
      void resolveSessionTranscriptionPlan({
        session,
        documentPrivacy,
        audioSettings,
        profiles,
        platform: isNativeMobile() ? "native-mobile" : "desktop",
        options: { appleReady: apple, androidSttReady: android },
      }).then((res) => {
        if (!cancelled) setPlanResult(res);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    session.id,
    session.origin,
    session.assetId,
    session.transcriptRevision,
    documentPrivacy.isLocalOnly,
    documentPrivacy.isAiExcluded,
    audioSettings,
    profiles,
  ]);

  return planResult;
}

