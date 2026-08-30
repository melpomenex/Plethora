import { useEffect, useMemo, useState } from "react";
import { Lock, Microphone, Sparkle } from "@phosphor-icons/react";
import { TranscriptionMode } from "../../services/transcription";
import {
  LOGICAL_STT_MODELS,
  resolveTranscriptionMode,
} from "../../services/transcription/config";
import type { SttProviderCategory } from "../../services/transcription/types";
import { useSettingsStore } from "../../stores/settingsStore";
import { cn } from "../../utils";
import { useI18n } from "../../lib/i18n";

const MODE_OPTIONS: Array<{
  value: TranscriptionMode;
  title: string;
  description: string;
}> = [
  {
    value: TranscriptionMode.Auto,
    title: "Automatic",
    description: "Fast, accurate, and cost-efficient.",
  },
  {
    value: TranscriptionMode.Enhanced,
    title: "Enhanced Accuracy",
    description: "Best for difficult audio and technical material.",
  },
  {
    value: TranscriptionMode.Offline,
    title: "Offline",
    description: "Process entirely on this device.",
  },
];

export interface TranscribeAudioDialogProps {
  open: boolean;
  title?: string;
  onCancel: () => void;
  onConfirm: (options: {
    mode: TranscriptionMode;
    language: string;
    sttProvider: SttProviderCategory;
    sttModel: string;
  }) => void;
  isSubmitting?: boolean;
}

export function TranscribeAudioDialog({
  open,
  title = "Transcribe Audio",
  onCancel,
  onConfirm,
  isSubmitting = false,
}: TranscribeAudioDialogProps) {
  const { t } = useI18n();
  const { settings, updateSettings } = useSettingsStore();
  const audio = settings.audioTranscription;
  const [mode, setMode] = useState<TranscriptionMode>(() => resolveTranscriptionMode(audio));
  const [sttProvider, setSttProvider] = useState<SttProviderCategory>(
    () => audio.sttProvider ?? "automatic",
  );
  const [sttModel, setSttModel] = useState(audio.sttModel ?? "automatic");
  const [language, setLanguage] = useState(audio.language || "auto");

  useEffect(() => {
    if (!open) return;
    setMode(resolveTranscriptionMode(useSettingsStore.getState().settings.audioTranscription));
    const latest = useSettingsStore.getState().settings.audioTranscription;
    setSttProvider(latest.sttProvider ?? "automatic");
    setSttModel(latest.sttModel ?? "automatic");
    setLanguage(latest.language || "auto");
  }, [open]);

  const privacyLabel = useMemo(() => {
    if (mode === TranscriptionMode.Offline || sttProvider === "local") {
      return "Audio will not leave this device.";
    }
    return "Audio may be sent to your configured cloud transcription provider.";
  }, [mode, sttProvider]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transcribe-audio-title"
        className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Microphone className="h-5 w-5" />
          </div>
          <div>
            <h2 id="transcribe-audio-title" className="text-lg font-semibold text-foreground">
              {title}
            </h2>
            <p className="text-xs text-muted-foreground">Choose how Plethora should transcribe this recording.</p>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-foreground">Mode</legend>
          {MODE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors",
                mode === option.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40",
              )}
            >
              <input
                type="radio"
                name="transcription-mode"
                className="mt-1"
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
              />
              <span>
                <span className="block text-sm font-medium text-foreground">{option.title}</span>
                <span className="block text-xs text-muted-foreground">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">Provider</span>
            <select
              value={sttProvider}
              onChange={(event) => setSttProvider(event.target.value as SttProviderCategory)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="automatic">Automatic</option>
              <option value="local">Local</option>
              <option value="openrouter">OpenRouter</option>
              <option value="premium">Premium</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">Model</span>
            <select
              value={sttModel}
              onChange={(event) => setSttModel(event.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="automatic">Automatic (Recommended)</option>
              {Object.values(LOGICAL_STT_MODELS).map((model) => (
                <option key={model.key} value={model.key}>
                  {model.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 space-y-2">
          <label htmlFor="transcribe-language" className="text-sm font-medium text-foreground">
            Language
          </label>
          <select
            id="transcribe-language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="auto">Auto Detect</option>
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="zh">Chinese</option>
            <option value="ja">Japanese</option>
          </select>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{privacyLabel}</p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/50"
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              updateSettings({
                audioTranscription: {
                  ...audio,
                  mode,
                  sttProvider,
                  sttModel,
                  language,
                },
              });
              onConfirm({ mode, language, sttProvider, sttModel });
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {isSubmitting ? <Sparkle className="h-4 w-4 animate-pulse" /> : null}
            Transcribe
          </button>
        </div>
      </div>
    </div>
  );
}
