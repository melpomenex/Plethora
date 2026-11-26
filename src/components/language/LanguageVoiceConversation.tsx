import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatsCircle, Microphone, PencilSimple, Play, Stop, WarningCircle } from "@phosphor-icons/react";
import { useLanguageProfileStore } from "../../stores/languageProfileStore";
import { useI18n } from "../../lib/i18n";
import { isAnyAiAvailable } from "../../lib/ai/provider";
import { buildLearnerContext, createProductionLanguageTutorService, type TutorResponse } from "../../lib/languageTutor";
import { createConfiguredShadowingProviders, type ShadowingRecognitionProvider } from "../../lib/languageShadowing";
import { cn } from "../../utils/cn";

interface VoiceTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  corrected?: boolean;
}

const LANG_TO_BCP47: Record<string, string> = {
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  ja: "ja-JP",
  zh: "zh-CN",
  ko: "ko-KR",
  ar: "ar-SA",
  pt: "pt-PT",
  it: "it-IT",
  nl: "nl-NL",
  ru: "ru-RU",
  en: "en-US",
};

/**
 * Turn-based spoken AI conversation. Strictly gated: it only activates when a
 * real speech-recognition provider AND an AI tutor provider are configured.
 * Without them it reports unavailable and never simulates voice with text-only
 * UI. Supports transcript review, optional correction, and playback speed.
 */
export function LanguageVoiceConversation() {
  const { t } = useI18n();
  const activeProfile = useLanguageProfileStore((state) => state.activeProfile);
  const profileId = activeProfile?.id ?? null;

  const [providers, setProviders] = useState<readonly ShadowingRecognitionProvider[]>([]);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [cloudConsent, setCloudConsent] = useState(false);
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [recording, setRecording] = useState(false);
  const [micStatus, setMicStatus] = useState<"idle" | "requesting" | "recording" | "processing" | "denied" | "unavailable">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptDraft, setTranscriptDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const turnsRef = useRef<VoiceTurn[]>([]);
  const cloudConsentRef = useRef(cloudConsent);

  turnsRef.current = turns;
  cloudConsentRef.current = cloudConsent;

  const tutorService = useMemo(() => createProductionLanguageTutorService(), []);

  useEffect(() => {
    let current = true;
    setProviders(createConfiguredShadowingProviders());
    void isAnyAiAvailable("prompt").then((available) => {
      if (current) setAiAvailable(available);
    });
    return () => {
      current = false;
    };
  }, []);

  const sttAvailable = providers.length > 0;
  const available = profileId !== null && sttAvailable && aiAvailable;

  const speak = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !window.speechSynthesis || !activeProfile) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = LANG_TO_BCP47[activeProfile.targetLanguage] ?? activeProfile.targetLanguage;
      utterance.rate = speed;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    },
    [activeProfile, speed],
  );

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
  }, []);

  const addAssistantTurn = useCallback(
    (response: TutorResponse) => {
      const turn: VoiceTurn = {
        id: `assistant:${Date.now()}`,
        role: "assistant",
        text: response.text,
        createdAt: Date.now(),
      };
      setTurns((prev) => [...prev, turn]);
      speak(response.text);
    },
    [speak],
  );

  const sendText = useCallback(
    async (text: string) => {
      if (!profileId || !activeProfile || !text.trim() || busy) return;
      const userTurn: VoiceTurn = {
        id: `user:${Date.now()}`,
        role: "user",
        text: text.trim(),
        createdAt: Date.now(),
      };
      setTurns((prev) => [...prev, userTurn]);
      setBusy(true);
      setError(null);
      try {
        const context = buildLearnerContext({
          profile: {
            id: activeProfile.id,
            targetLanguage: activeProfile.targetLanguage,
            baseLanguage: activeProfile.baseLanguage,
            proficiency: activeProfile.proficiency,
          },
          lexicon: [],
        });
        const response = await tutorService.respond({
          profileId,
          mode: "conversation",
          message: text.trim(),
          context,
          privacy: cloudConsentRef.current ? "allow-cloud" : "local-only",
          allowCloud: cloudConsentRef.current,
          cloudConsent: cloudConsentRef.current,
        });
        addAssistantTurn(response);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [profileId, activeProfile, busy, tutorService, addAssistantTurn],
  );

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicStatus("unavailable");
      setError(t("languageLearning.voice.micUnavailable"));
      return;
    }
    setMicStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      if (typeof MediaRecorder === "undefined") {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setMicStatus("unavailable");
        setError(t("languageLearning.voice.recorderUnavailable"));
        return;
      }
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorderRef.current = recorder;
      recorder.start();
      setMicStatus("recording");
      setRecording(true);
    } catch {
      setMicStatus("denied");
      setError(t("languageLearning.voice.micDenied"));
    }
  }, [t]);

  const stopRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRecording(false);
    if (!recorder) return;
    setMicStatus("processing");
    try {
      const audio = await new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: "audio/webm" }));
        recorder.stop();
      });
      const provider = providers[0];
      if (!provider || !activeProfile) return;
      if (provider.route === "cloud" && !cloudConsentRef.current) {
        setError(t("languageLearning.voice.cloudConsent"));
        return;
      }
      const recognition = await provider.recognize(
        {
          attemptId: `voice:${Date.now()}`,
          profileId: activeProfile.id,
          languageTag: activeProfile.targetLanguage,
          audio,
          privacy: cloudConsentRef.current ? "allow-cloud" : "local-only",
        },
      );
      if (recognition.text?.trim()) {
        setTranscriptDraft(recognition.text.trim());
      } else {
        setError(t("languageLearning.voice.noTranscript"));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMicStatus("idle");
    }
  }, [providers, activeProfile, t]);

  const saveCorrection = useCallback((turnId: string) => {
    setTurns((prev) =>
      prev.map((turn) =>
        turn.id === turnId ? { ...turn, text: transcriptDraft.trim() || turn.text, corrected: true } : turn,
      ),
    );
    setEditingId(null);
    setTranscriptDraft("");
  }, [transcriptDraft]);

  const clearSession = useCallback(() => {
    setTurns([]);
    setError(null);
    stopSpeaking();
  }, [stopSpeaking]);

  if (!available) {
    return (
      <div className="rounded-xl bg-card p-4 ring-1 ring-inset ring-border">
        <div className="flex items-center gap-2">
          <ChatsCircle className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">{t("languageLearning.voice.unavailable")}</span>
        </div>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {!profileId ? <li>• {t("languageLearning.voice.reasonProfile")}</li> : null}
          {!sttAvailable ? <li>• {t("languageLearning.voice.reasonStt")}</li> : null}
          {!aiAvailable ? <li>• {t("languageLearning.voice.reasonAi")}</li> : null}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">{t("languageLearning.voice.noSimulation")}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-inset ring-border">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ChatsCircle className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">{t("languageLearning.voice.title")}</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {t("languageLearning.voice.speed")}
            <input
              type="range"
              min={0.6}
              max={1.6}
              step={0.1}
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
              className="w-24 accent-primary"
            />
            <span className="w-8 text-right text-foreground">{speed.toFixed(1)}×</span>
          </label>
          {turns.length > 0 ? (
            <button type="button" onClick={clearSession} className="text-xs text-muted-foreground hover:text-foreground">
              {t("languageLearning.voice.clear")}
            </button>
          ) : null}
        </div>
      </div>

      {turns.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("languageLearning.voice.intro")}</p>
      ) : (
        <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
          {turns.map((turn) => (
            <li
              key={turn.id}
              className={cn(
                "rounded-lg p-3 text-sm leading-relaxed ring-1 ring-inset",
                turn.role === "user"
                  ? "bg-surface-container-low text-foreground ring-border"
                  : "bg-secondary-container text-on-secondary-container ring-primary/30",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {turn.role === "user" ? t("languageLearning.voice.you") : t("languageLearning.voice.tutor")}
                  {turn.corrected ? ` · ${t("languageLearning.voice.corrected")}` : ""}
                </span>
                <div className="flex items-center gap-1">
                  {turn.role === "user" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(turn.id);
                        setTranscriptDraft(turn.text);
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-surface-container hover:text-foreground"
                      aria-label={t("languageLearning.voice.edit")}
                    >
                      <PencilSimple className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => speak(turn.text)}
                      className="rounded p-1 text-muted-foreground hover:bg-surface-container hover:text-foreground"
                      aria-label={t("languageLearning.voice.replay")}
                    >
                      <Play className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {editingId === turn.id ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={transcriptDraft}
                    onChange={(event) => setTranscriptDraft(event.target.value)}
                    rows={2}
                    className="w-full rounded-lg bg-surface-container p-2 text-sm text-foreground ring-1 ring-inset ring-border md-focus-ring focus-visible:ring-primary"
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setEditingId(null)} className="text-xs text-muted-foreground hover:text-foreground">
                      {t("common.cancel")}
                    </button>
                    <button type="button" onClick={() => saveCorrection(turn.id)} className="md-focus-ring text-xs font-medium text-primary hover:underline">
                      {t("languageLearning.voice.saveCorrection")}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 whitespace-pre-wrap">{turn.text}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-destructive">
          <WarningCircle className="h-4 w-4" />
          {error}
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {transcriptDraft && micStatus === "idle" ? (
          <div className="rounded-lg bg-surface-container-low p-2 ring-1 ring-inset ring-border">
            <textarea
              value={transcriptDraft}
              onChange={(event) => setTranscriptDraft(event.target.value)}
              rows={2}
              placeholder={t("languageLearning.voice.transcriptPlaceholder")}
              className="md-focus-ring w-full resize-none rounded-lg p-2 text-sm text-foreground"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-1">
              <span className="text-[10px] text-muted-foreground">{t("languageLearning.voice.correctTranscript")}</span>
              <button
                type="button"
                disabled={busy || !transcriptDraft.trim()}
                onClick={() => {
                  const text = transcriptDraft;
                  setTranscriptDraft("");
                  void sendText(text);
                }}
                className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground md-state md-focus-ring disabled:opacity-40"
              >
                {busy ? t("languageLearning.voice.sending") : t("languageLearning.voice.send")}
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={micStatus === "processing" || micStatus === "requesting" || busy || (providers[0]?.route === "cloud" && !cloudConsent)}
            onClick={recording ? () => void stopRecording() : () => void startRecording()}
            className={cn(
              "md-state md-focus-ring inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition-colors disabled:opacity-40",
              recording
                ? "bg-destructive text-destructive-foreground"
                : "bg-primary text-primary-foreground",
            )}
          >
            {recording ? <Stop className="h-4 w-4" /> : <Microphone className="h-4 w-4" />}
            {recording ? t("languageLearning.voice.stop") : t("languageLearning.voice.speak")}
          </button>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={cloudConsent}
              onChange={(event) => setCloudConsent(event.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            {t("languageLearning.voice.cloudConsent")}
          </label>

          <button
            type="button"
            onClick={stopSpeaking}
            className="rounded-full bg-surface-container px-4 py-2 text-xs font-medium text-foreground ring-1 ring-inset ring-border hover:bg-surface-container-highest"
          >
            {t("languageLearning.voice.stopAudio")}
          </button>
        </div>
      </div>
    </div>
  );
}
