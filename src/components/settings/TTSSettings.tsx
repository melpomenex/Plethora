import { useEffect, useMemo, useRef, useState } from "react";
import { getCacheSize, clearAudioCache, updateMaxCacheSize, bytesToMiB } from "../../utils/ttsCache";

function DownloadedSpeechSection() {
  const [info, setInfo] = useState<{ totalSize: number; maxSize: number; entryCount: number } | null>(null);
  const [maxSel, setMaxSel] = useState("500");
  useEffect(() => {
    let cancelled = false;
    const load = async () => { const s = await getCacheSize(); if (!cancelled) setInfo(s); };
    void load();
    const id = setInterval(load, 10000);
    const onVis = () => { if (document.visibilityState==="visible") void load(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("storage", load);
    return () => { cancelled=true; clearInterval(id); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("storage", load); };
  }, []);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Plethora stores generated speech on this device so replaying the same passages does not require another TTS request.</p>
      <p className="text-sm">{info ? `${bytesToMiB(info.totalSize)} MB · ${info.entryCount} segments of ${bytesToMiB(info.maxSize)} MB` : "Loading…"}</p>
      <div className="flex flex-wrap gap-2">
        <select value={maxSel} onChange={(e)=>setMaxSel(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1 text-sm">
          <option value="250">250 MB</option><option value="500">500 MB</option><option value="1000">1 GB</option><option value="2000">2 GB</option><option value="999999">Unlimited</option>
        </select>
        <button onClick={() => { void updateMaxCacheSize(Number(maxSel)).then(()=>getCacheSize().then(setInfo)); }} className="rounded-lg border border-border px-3 py-1 text-sm">Manage</button>
        <button onClick={async()=>{ if(confirm("This removes all cached speech. Next playback will regenerate via your provider.")){ await clearAudioCache(); setInfo(await getCacheSize()); } }} className="rounded-lg border border-destructive/40 px-3 py-1 text-sm text-destructive">Clear cached speech</button>
      </div>
    </div>
  );
}
import {
  ArrowsClockwise,
  CaretDown,
  Check,
  CircleNotch,
  Coins,
  Copy,
  Download,
  FloppyDisk,
  MagnifyingGlass,
  Microphone,
  Play,
  Plus,
  SpeakerHigh,
  Trash,
  WarningCircle,
  WifiHigh,
  WifiSlash,
} from "@phosphor-icons/react";
import { cloneVoice, generateSpeech, TTSServiceError } from "../../api/tts";
import { checkPocketTTSAvailable } from "../../api/pocketTts";
import { getAdapter, listAdapters } from "../../api/tts/registry";
import { resolveProviderKey, describeBorrowedSource } from "../../api/tts/auth";
import type { TTSModelInfo, TTSVoiceInfo, TTSProviderId } from "../../api/tts/types";
import { getCatalog } from "../../api/tts/catalog";
import { useSettingsStore } from "../../stores/settingsStore";
import { NumericInput } from "../common";
import { Switch } from "../common/Switch";
import { AndroidTtsModelManager } from "./AndroidTtsModelManager";
import {
  FAL_LANGUAGES,
  createDefaultTTSSettings,
  getVoicesForProvider,
  validateTTSConfiguration,
  type TTSPreset,
  type TTSVoiceProfile,
  type TTSProvider,
  getProviderSettings,
} from "../../utils/ttsSettings";
import { cn } from "../../utils";
import { isTauri, isNativeMobile } from "../../lib/tauri";
import { playChime } from "../../utils/audioFeedback";
import type { StudyAction } from "../../types/audioEdition";
import { isPaidTtsProvider } from "../../utils/aiBillingConsent";

/** User-facing labels for every implemented StudyAction (task 4.5). */
const STUDY_ACTION_OPTIONS: Array<{ value: StudyAction; label: string }> = [
  { value: "save_recent_extract", label: "Save Recent Extract" },
  { value: "bookmark", label: "Bookmark" },
  { value: "replay_recent_passage", label: "Replay Recent Passage" },
  { value: "mark_interesting", label: "Mark Interesting (#interesting)" },
  { value: "mark_confusing", label: "Mark Confusing (#needs-explanation)" },
  { value: "ask_plethora", label: "Ask Plethora (deferred)" },
  { value: "skip_forward", label: "Skip Forward (+30 s)" },
  { value: "skip_backward", label: "Skip Backward (−15 s)" },
  { value: "next_chapter", label: "Next Chapter/Section" },
  { value: "previous_chapter", label: "Previous Chapter/Section" },
  { value: "none", label: "Do Nothing" },
];
import {
  useSystemVoices,
  resolveSystemVoice,
  SYSTEM_VOICE_SELECT_CAP,
} from "../../hooks/useSystemVoices";
import { useI18n } from "../../lib/i18n";
import VoiceBrowser from "./VoiceBrowser";
import ModelBrowser from "./ModelBrowser";
import { HuggingFaceModelManager } from "./HuggingFaceModelManager";

const MAX_SAMPLE_FILE_SIZE_MB = 12;
const MAX_SAMPLE_DURATION_SECONDS = 45;
const ACCEPTED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
  "audio/mp4",
  "audio/x-m4a",
];

type LifecycleState = "idle" | "uploading" | "cloning" | "generating" | "success" | "error";

function makeCustomPreset(input: {
  name: string;
  prompt: string;
  temperature: number;
  topP: number;
  topK: number;
  repetitionPenalty: number;
  maxNewTokens: number;
}): TTSPreset {
  return {
    id: `custom-${Date.now()}`,
    name: input.name,
    description: "User preset",
    prompt: input.prompt,
    temperature: input.temperature,
    topP: input.topP,
    topK: input.topK,
    repetitionPenalty: input.repetitionPenalty,
    maxNewTokens: input.maxNewTokens,
    readonly: false,
  };
}

async function getAudioDuration(file: File): Promise<number> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve();
      audio.onerror = () => reject(new Error("Failed to read audio metadata."));
    });

    if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
      throw new Error("Invalid audio duration.");
    }

    return audio.duration;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof TTSServiceError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected error while processing TTS request.";
}

interface SystemVoicePickerProps {
  voices: TTSVoiceProfile[];
  defaultVoiceId: string;
  previewingId: string | null;
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
  onStopPreview: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  showAll: boolean;
  onToggleShowAll: () => void;
}

/**
 * Voice picker for the System (device) TTS provider. Unlike the card grid
 * used for cloud providers, this handles the case where a platform exposes
 * a very large number of voices (Linux speech-dispatcher can list 300+):
 *  - a search box filters by name/locale
 *  - results are capped (SYSTEM_VOICE_SELECT_CAP) with a "show all" toggle
 *  - the list is rendered inside a fixed-height scroll container so the page
 *    never has to lay out hundreds of cards at once
 *  - each row has a Preview button to audition the voice — device voices vary
 *    wildly in quality, so hearing them is the only reliable way to choose
 */
function SystemVoicePicker({
  voices,
  defaultVoiceId,
  previewingId,
  onSelect,
  onPreview,
  onStopPreview,
  search,
  onSearchChange,
  showAll,
  onToggleShowAll,
}: SystemVoicePickerProps) {
  const { t } = useI18n();
  const query = search.trim().toLowerCase();
  const filtered = query ? voices.filter((v) => v.name.toLowerCase().includes(query)) : voices;
  const capped = showAll ? filtered : filtered.slice(0, SYSTEM_VOICE_SELECT_CAP);
  const hiddenCount = filtered.length - capped.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t("settings.ttsSystemVoiceSearch")}
            className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-sm"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {t("settings.ttsSystemVoiceCount", { count: filtered.length })}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("settings.ttsSystemNoVoices")}</p>
      ) : (
        <div className="max-h-80 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2">
          {capped.map((voice) => {
            const isDefault = voice.id === defaultVoiceId;
            const isPreviewing = previewingId === voice.id;
            return (
              <div
                key={voice.id}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-md border px-3 py-2",
                  isDefault
                    ? "border-primary/40 bg-primary/5"
                    : "border-transparent hover:bg-muted/40"
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{voice.name}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => (isPreviewing ? onStopPreview() : onPreview(voice.id))}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                    title={t("settings.ttsSystemPreview")}
                  >
                    {isPreviewing ? (
                      <CircleNotch className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    {isPreviewing ? t("settings.ttsSystemStop") : t("settings.ttsSystemPreview")}
                  </button>
                  <button
                    onClick={() => onSelect(voice.id)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs",
                      isDefault ? "border-primary bg-primary/10 text-primary" : "border-border"
                    )}
                  >
                    {isDefault ? t("settings.ttsDefault") : t("settings.ttsSetDefault")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hiddenCount > 0 && (
        <button
          onClick={onToggleShowAll}
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <CaretDown className={cn("h-3.5 w-3.5 transition-transform", showAll && "rotate-180")} />
          {showAll
            ? t("settings.ttsSystemShowFewer")
            : t("settings.ttsSystemShowAll", { count: hiddenCount })}
        </button>
      )}
    </div>
  );
}

export function TTSSettings() {
  const { t } = useI18n();
  const { settings, updateSettings } = useSettingsStore();
  const tts = settings.tts ?? createDefaultTTSSettings();

  const activeProviderConfig = getProviderSettings(tts, String(tts.provider));
  const [apiKeyInput, setApiKeyInput] = useState(activeProviderConfig.apiKey);
  const [proxyUrlInput, setProxyUrlInput] = useState(activeProviderConfig.proxyUrl);
  const [modelIdInput, setModelIdInput] = useState(activeProviderConfig.modelId);
  const [cloneModelIdInput, setCloneModelIdInput] = useState(activeProviderConfig.cloneModelId);
  const [groqModelIdInput, setGroqModelIdInput] = useState(activeProviderConfig.modelId);
  const [showVoiceBrowser, setShowVoiceBrowser] = useState(false);
  const [showModelBrowser, setShowModelBrowser] = useState(false);
  const [browserModels, setBrowserModels] = useState<TTSModelInfo[]>([]);
  const [browserVoices, setBrowserVoices] = useState<TTSVoiceInfo[]>([]);
  const [browserOffline, setBrowserOffline] = useState(false);
  const browserAudioRef = useRef<HTMLAudioElement | null>(null);
  const credentialInputRef = useRef<HTMLInputElement | null>(null);

  const [voiceName, setVoiceName] = useState("");
  const [voiceSampleText, setVoiceSampleText] = useState("This is my voice cloning sample.");
  const [voiceSampleFile, setVoiceSampleFile] = useState<File | null>(null);
  const [voiceValidationError, setVoiceValidationError] = useState<string | null>(null);

  const [operationState, setOperationState] = useState<LifecycleState>("idle");
  const [operationMessage, setOperationMessage] = useState<string>("");
  const [generateText, setGenerateText] = useState(
    "Welcome to Plethora. This is your configured text to speech output."
  );
  const [overrideVoiceId, setOverrideVoiceId] = useState("default");
  const [overridePresetId, setOverridePresetId] = useState("default");
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string>("");

  const [customPresetForm, setCustomPresetForm] = useState({
    name: "",
    prompt: "",
    temperature: 0.9,
    topP: 1,
    topK: 50,
    repetitionPenalty: 1.05,
    maxNewTokens: 220,
  });

  // System TTS voice picker state: search filter + "show all beyond the cap".
  // Some platforms (Linux/KDE speech-dispatcher) expose hundreds of voices;
  // rendering every one as a card froze the tab.
  const [systemVoiceSearch, setSystemVoiceSearch] = useState("");
  const [showAllSystemVoices, setShowAllSystemVoices] = useState(false);
  const [systemPreviewingId, setSystemPreviewingId] = useState<string | null>(null);
  const [newPronunciationWord, setNewPronunciationWord] = useState("");
  const [newPronunciationReplacement, setNewPronunciationReplacement] = useState("");

  // Hands-Free Study Mode (task 4.5): every offered choice maps to an
  // implemented StudyAction; the store coerces invalid persisted values.
  const handsFree = settings.handsFreeStudy;
  const updateHandsFree = (updates: Partial<typeof handsFree>) =>
    updateSettings({
      ...settings,
      handsFreeStudy: { ...handsFree, ...updates },
    });

  useEffect(() => {
    const config = getProviderSettings(tts, String(tts.provider));
    setApiKeyInput(config.apiKey);
    setProxyUrlInput(config.proxyUrl);
    setModelIdInput(config.modelId);
    setCloneModelIdInput(config.cloneModelId);
    setGroqModelIdInput(config.modelId);
  }, [tts, tts.provider]);

  // Device speech-synthesis voices (System TTS provider). Declared early so the
  // providerVoices memo (below) and the system test path can reference it.
  const {
    available: systemTtsAvailable,
    profiles: systemVoices,
    voices: systemSynthVoices,
  } = useSystemVoices();

  const providerVoices = useMemo(() => {
    const persisted = getVoicesForProvider(tts);
    // System provider: device voices aren't persisted, so merge in the live
    // list from the WebView's speech engine.
    if (tts.provider === "system") {
      return systemVoices.length > 0 ? systemVoices : persisted;
    }
    return persisted;
  }, [tts, systemVoices]);
  const isGroqProvider = tts.provider === "groq";
  const activeAdapter = getAdapter(String(tts.provider));

  useEffect(() => {
    const resolved = resolveProviderKey(activeAdapter, settings);
    if (activeAdapter.auth.mode !== "none" && !resolved.key) {
      const timer = window.setTimeout(() => credentialInputRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [activeAdapter, settings, tts.provider]);

  useEffect(() => {
    let cancelled = false;
    const config = getProviderSettings(tts, String(tts.provider));
    const context = { settings, tts, config };
    const load = async () => {
      try {
        const catalog =
          activeAdapter.id === "openrouter"
            ? await getCatalog({
                apiKey: resolveProviderKey(activeAdapter, settings).key || undefined,
              })
            : null;
        const models = catalog?.models || (await activeAdapter.listModels(context));
        if (!cancelled) {
          setBrowserModels(models);
          setBrowserOffline(Boolean(catalog?.offline));
        }
        if (config.modelId) {
          const voices = await activeAdapter.listVoices(context, config.modelId);
          if (!cancelled) setBrowserVoices(voices);
        }
      } catch {
        if (!cancelled) {
          setBrowserModels([]);
          setBrowserVoices([]);
          setBrowserOffline(true);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeAdapter, settings, tts, tts.provider]);

  const defaultVoice = useMemo(
    () => providerVoices.find((voice) => voice.id === tts.defaultVoiceId),
    [providerVoices, tts.defaultVoiceId]
  );

  const defaultPreset = useMemo(
    () => tts.presets.find((preset) => preset.id === tts.defaultPresetId),
    [tts.presets, tts.defaultPresetId]
  );
  const ttsConfigValidation = useMemo(() => validateTTSConfiguration(tts), [tts]);

  const updateTTS = (updates: Partial<typeof tts>) => {
    const latestTts = useSettingsStore.getState().settings.tts ?? createDefaultTTSSettings();
    updateSettings({
      tts: {
        ...latestTts,
        ...updates,
      },
    });
  };

  const saveProviderSettings = () => {
    const latestTts = useSettingsStore.getState().settings.tts ?? createDefaultTTSSettings();
    const provider = String(latestTts.provider) as TTSProvider;
    const previous = getProviderSettings(latestTts, provider);
    const nextProviders = {
      ...latestTts.providers,
      [provider]: {
        ...previous,
        apiKey: apiKeyInput.trim(),
        proxyUrl: proxyUrlInput.trim(),
        modelId: (provider === "groq" ? groqModelIdInput : modelIdInput).trim() || previous.modelId,
        cloneModelId: cloneModelIdInput.trim() || previous.cloneModelId,
      },
    };
    updateTTS({
      providers: nextProviders,
      apiKey: apiKeyInput.trim(),
      proxyUrl: proxyUrlInput.trim(),
      modelId: modelIdInput.trim() || latestTts.modelId,
      cloneModelId: cloneModelIdInput.trim() || latestTts.cloneModelId,
      groqModelId: groqModelIdInput.trim() || latestTts.groqModelId,
    });
    setOperationState("success");
    setOperationMessage(t("settings.ttsProviderSettingsSaved"));
  };

  const resetTTSSettings = () => {
    updateSettings({ tts: createDefaultTTSSettings() });
    setOperationState("idle");
    setOperationMessage("");
    setGeneratedAudioUrl("");
  };

  const validateVoiceFile = async (file: File): Promise<string | null> => {
    if (!ACCEPTED_AUDIO_TYPES.includes(file.type)) {
      return t("settings.ttsUnsupportedAudioFormat");
    }

    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > MAX_SAMPLE_FILE_SIZE_MB) {
      return t("settings.ttsAudioSampleMaxSize", { max: MAX_SAMPLE_FILE_SIZE_MB });
    }

    try {
      const duration = await getAudioDuration(file);
      if (duration > MAX_SAMPLE_DURATION_SECONDS) {
        return t("settings.ttsAudioSampleMaxDuration", { max: MAX_SAMPLE_DURATION_SECONDS });
      }
    } catch {
      return t("settings.ttsAudioMetadataReadFailed");
    }

    return null;
  };

  const handleVoiceFileSelect = async (file: File | null) => {
    setVoiceSampleFile(file);
    if (!file) {
      setVoiceValidationError(null);
      return;
    }

    const validationError = await validateVoiceFile(file);
    setVoiceValidationError(validationError);
  };

  const handleCloneVoice = async () => {
    if (!voiceSampleFile) {
      setOperationState("error");
      setOperationMessage(t("settings.ttsSelectAudioSample"));
      return;
    }

    if (!voiceName.trim()) {
      setOperationState("error");
      setOperationMessage(t("settings.ttsVoiceNameRequired"));
      return;
    }

    if (voiceValidationError) {
      setOperationState("error");
      setOperationMessage(voiceValidationError);
      return;
    }

    setOperationState("uploading");
    setOperationMessage(t("settings.ttsUploadingSample"));

    try {
      setOperationState("cloning");
      setOperationMessage(t("settings.ttsCreatingClonedVoice"));
      const result = await cloneVoice(settings, {
        voiceName,
        sampleFile: voiceSampleFile,
        sampleText: voiceSampleText,
      });

      const mergedVoices: TTSVoiceProfile[] = [...tts.voiceProfiles, result.profile];

      updateTTS({
        voiceProfiles: mergedVoices,
        defaultVoiceId: tts.defaultVoiceId || result.profile.id,
      });

      setVoiceName("");
      setVoiceSampleText("This is my voice cloning sample.");
      setVoiceSampleFile(null);
      setVoiceValidationError(null);
      setOperationState("success");
      setOperationMessage(`Created cloned voice: ${result.profile.name}`);
    } catch (error) {
      setOperationState("error");
      setOperationMessage(getErrorMessage(error));
    }
  };

  const handleGenerateSpeech = async (textOverride?: string) => {
    const text = textOverride ?? generateText;
    if (!text.trim()) {
      setOperationState("error");
      setOperationMessage(t("settings.ttsEnterTextToGenerate"));
      return;
    }

    // System TTS has no audio URL — synthesize directly via the device engine.
    if (isSystemProvider) {
      if (!("speechSynthesis" in window)) {
        setOperationState("error");
        setOperationMessage(t("settings.ttsSystemNoVoices"));
        return;
      }
      const voiceId =
        overrideVoiceId && overrideVoiceId !== "default" ? overrideVoiceId : "system-default";
      void previewSystemVoice(voiceId, text);
      return;
    }

    setOperationState("generating");
    setOperationMessage(t("settings.ttsGeneratingSpeech"));

    try {
      const latestSettings = useSettingsStore.getState().settings;
      const runtimeSettings = isGroqProvider
        ? {
            ...latestSettings,
            tts: {
              ...latestSettings.tts,
              provider: "groq" as const,
              requestMode: "direct" as const,
              proxyUrl: "",
            },
          }
        : latestSettings;

      const result = await generateSpeech(runtimeSettings, {
        text,
        voiceId: overrideVoiceId === "default" ? undefined : overrideVoiceId,
        presetId: overridePresetId === "default" ? undefined : overridePresetId,
      });
      setGeneratedAudioUrl(result.audioUrl);
      setOperationState("success");
      setOperationMessage(t("settings.ttsGenerationSucceeded"));
    } catch (error) {
      setOperationState("error");
      setOperationMessage(getErrorMessage(error));
    }
  };

  const handleGroqTest = async () => {
    const testText = generateText.trim() || "This is a Groq TTS test in Plethora.";
    if (!generateText.trim()) {
      setGenerateText(testText);
    }
    await handleGenerateSpeech(testText);
  };

  const addCustomPreset = () => {
    if (!customPresetForm.name.trim()) {
      setOperationState("error");
      setOperationMessage(t("settings.ttsPresetNameRequired"));
      return;
    }

    const preset = makeCustomPreset({
      ...customPresetForm,
      name: customPresetForm.name.trim(),
      prompt: customPresetForm.prompt.trim(),
    });

    updateTTS({
      presets: [...tts.presets, preset],
      defaultPresetId: tts.defaultPresetId || preset.id,
    });

    setCustomPresetForm((prev) => ({ ...prev, name: "", prompt: "" }));
    setOperationState("success");
    setOperationMessage(`Added preset: ${preset.name}`);
  };

  const deletePreset = (presetId: string) => {
    const preset = tts.presets.find((item) => item.id === presetId);
    if (!preset || preset.readonly) return;

    const nextPresets = tts.presets.filter((item) => item.id !== presetId);
    const nextDefault =
      tts.defaultPresetId === presetId
        ? (nextPresets[0]?.id ?? createDefaultTTSSettings().defaultPresetId)
        : tts.defaultPresetId;

    updateTTS({ presets: nextPresets, defaultPresetId: nextDefault });
  };

  const removeClonedVoice = (voiceId: string) => {
    const voice = tts.voiceProfiles.find((item) => item.id === voiceId);
    if (!voice || voice.kind !== "cloned") return;

    const nextVoices = tts.voiceProfiles.filter((item) => item.id === voiceId);
    const fallbackVoiceId =
      nextVoices.find((item) => item.kind === "builtin")?.id ||
      createDefaultTTSSettings().defaultVoiceId;

    updateTTS({
      voiceProfiles: nextVoices,
      defaultVoiceId: tts.defaultVoiceId === voiceId ? fallbackVoiceId : tts.defaultVoiceId,
    });
  };

  /**
   * Speak a short sample using a specific system (device) voice via the Web
   * Speech API. Used both by the test-generation section (default voice) and
   * by the per-voice Preview button in the system voice picker.
   */
  const previewSystemVoice = (voiceId: string, sampleText?: string) => {
    if (!("speechSynthesis" in window)) {
      setOperationState("error");
      setOperationMessage(t("settings.ttsSystemNoVoices"));
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(
        sampleText ?? t("settings.ttsSystemPreviewSample")
      );
      const voice = resolveSystemVoice(voiceId, systemSynthVoices);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }
      const previewId = voiceId;
      setSystemPreviewingId(previewId);
      setOperationState("generating");
      setOperationMessage(t("settings.ttsGeneratingSpeech"));
      setGeneratedAudioUrl(null);
      const finish = (ok: boolean) => {
        setSystemPreviewingId((cur) => (cur === previewId ? null : cur));
        if (ok) {
          setOperationState("success");
          setOperationMessage(t("settings.ttsGenerationSucceeded"));
        } else {
          setOperationState("error");
          setOperationMessage(getErrorMessage(new Error("System TTS playback failed")));
        }
      };
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      setSystemPreviewingId(null);
      setOperationState("error");
      setOperationMessage(getErrorMessage(error));
    }
  };

  const setProvider = (provider: TTSProvider) => {
    const latestTts = useSettingsStore.getState().settings.tts ?? createDefaultTTSSettings();
    const voices = getVoicesForProvider(latestTts, provider);
    const config = getProviderSettings(latestTts, provider);
    updateTTS({
      provider,
      requestMode: config.requestMode,
      defaultVoiceId: config.voiceId || voices[0]?.id || latestTts.defaultVoiceId,
    });
  };

  const browserVoiceList = useMemo<TTSVoiceInfo[]>(
    () =>
      browserVoices.length > 0
        ? browserVoices
        : providerVoices.map((voice) => ({
            id: voice.voice || voice.id,
            name: voice.name,
            provider: String(voice.provider) as TTSProviderId,
            modelId: activeProviderConfig.modelId,
            vendor: activeAdapter.label,
            metadata: voice,
          })),
    [browserVoices, providerVoices, activeProviderConfig.modelId, activeAdapter.label]
  );

  const selectBrowserVoice = (voice: TTSVoiceInfo) => {
    const provider = String(tts.provider) as TTSProvider;
    const previous = getProviderSettings(tts, provider);
    const recents = [voice.id, ...tts.recents.filter((id) => id !== voice.id)].slice(0, 20);
    updateTTS({
      defaultVoiceId: voice.id,
      recents,
      providers: { ...tts.providers, [provider]: { ...previous, voiceId: voice.id } },
    });
    setShowVoiceBrowser(false);
  };

  const previewBrowserVoice = async (voice: TTSVoiceInfo, phrase: string) => {
    browserAudioRef.current?.pause();
    const previewSettings = {
      ...settings,
      tts: {
        ...tts,
        providers: {
          ...tts.providers,
          [tts.provider]: { ...getProviderSettings(tts, String(tts.provider)), voiceId: voice.id },
        },
      },
    };
    const result = await generateSpeech(previewSettings, { text: phrase, voiceId: voice.id });
    const audio = new Audio(result.audioUrl);
    browserAudioRef.current = audio;
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("Voice preview failed."));
      void audio.play().catch(reject);
    });
  };

  // Pocket TTS status
  const [pocketStatus, setPocketStatus] = useState<{
    available: boolean;
    downloading: boolean;
    downloadProgress: number;
    error?: string;
  }>({ available: false, downloading: false, downloadProgress: 0 });

  useEffect(() => {
    if (!isTauri()) {
      setPocketStatus({ available: false, downloading: false, downloadProgress: 0 });
      return;
    }

    checkPocketTTSAvailable().then((status) => {
      setPocketStatus({
        available: status.available,
        downloading: status.downloading,
        downloadProgress: status.download_progress ?? 0,
        error: status.error,
      });
    });
  }, []);

  const handleDownloadPocketTTS = async () => {
    if (!isTauri()) return;

    setPocketStatus((prev) => ({
      ...prev,
      downloading: true,
      downloadProgress: 0,
      error: undefined,
    }));

    try {
      // Pocket TTS downloads models automatically on first use
      // We trigger a short synthesis to force model download
      const { generatePocketSpeech } = await import("../../api/pocketTts");

      setPocketStatus((prev) => ({ ...prev, downloadProgress: 50 }));

      await generatePocketSpeech({
        text: "Download complete.",
        voice: "alba",
      });

      setPocketStatus({
        available: true,
        downloading: false,
        downloadProgress: 100,
        error: undefined,
      });
    } catch (error) {
      setPocketStatus((prev) => ({
        ...prev,
        downloading: false,
        error: error instanceof Error ? error.message : t("settings.ttsFailedInitPocketTts"),
      }));
    }
  };

  const isPocketProvider = tts.provider === "pocket";
  const isAndroidProvider = tts.provider === "android";
  // Pocket TTS bundles a desktop sidecar (no Android/iOS binary), so only offer
  // it on non-mobile Tauri builds. On mobile, show a note explaining why it's
  // unavailable and point users to System TTS instead.
  const showPocketOption = isTauri() && !isNativeMobile();
  // System TTS uses the WebView's speechSynthesis (device speech engine). Offer
  // it whenever the API is present — that covers mobile (Android native TTS,
  // free/offline) and desktop browsers. (systemTtsAvailable/systemVoices are
  // declared above, near the providerVoices memo.)
  const showSystemOption = systemTtsAvailable;
  const isSystemProvider = tts.provider === "system";

  return (
    <div className="space-y-8">
      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <SpeakerHigh className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h4 className="text-lg font-semibold text-foreground">{t("settings.ttsTitle")}</h4>
              <p className="text-sm text-muted-foreground">{t("settings.ttsDescription")}</p>
            </div>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={tts.enabled}
              onChange={(e) => updateTTS({ enabled: e.target.checked })}
            />
            <div className="h-6 w-11 rounded-full bg-muted peer-checked:bg-primary peer-focus:ring-2 peer-focus:ring-primary/30" />
            <div className="absolute left-[2px] top-[2px] h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 text-sm">
            <span className="font-medium text-foreground">{t("settings.ttsProvider")}</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {listAdapters()
                .filter((adapter) => {
                  // Pocket is desktop-only (shell sidecar); the native android
                  // provider is Android-only. Hide each where it can't run.
                  if (adapter.id === "pocket") return showPocketOption;
                  if (adapter.id === "android") return isNativeMobile();
                  return true;
                })
                .map((adapter) => {
                  const resolved = resolveProviderKey(adapter, settings);
                  const config = getProviderSettings(tts, adapter.id);
                  const ready =
                    adapter.auth.mode === "none" ||
                    Boolean(resolved.key) ||
                    (config.requestMode === "proxy" && Boolean(config.proxyUrl.trim()));
                  const selected = String(tts.provider) === adapter.id;
                  return (
                    <button
                      key={adapter.id}
                      type="button"
                      onClick={() => setProvider(adapter.id)}
                      className={cn(
                        "rounded-lg border p-2 text-left",
                        selected
                          ? "border-primary bg-primary/10"
                          : "border-border hover:bg-muted/50"
                      )}
                    >
                      <span className="block font-medium">{adapter.label}</span>
                      <span
                        className={cn(
                          "block text-xs",
                          ready ? "text-emerald-600" : "text-amber-600"
                        )}
                      >
                        {adapter.kind === "local"
                          ? "Available offline"
                          : ready
                            ? "Configured"
                            : "Needs an API key"}
                      </span>
                      {isPaidTtsProvider(adapter.id) && (
                        <span
                          title="This provider is an external paid API. Billable speech generation is only sent after you enable paid TTS."
                          className="mt-1 inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                        >
                          <Coins className="w-3 h-3" />
                          Paid API
                        </span>
                      )}
                      {resolved.source && (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          Using {describeBorrowedSource(resolved.source)}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
            {isSystemProvider && (
              <span className="block text-xs text-muted-foreground">
                {t("settings.ttsSystemDescription")}
              </span>
            )}
            {isSystemProvider && systemVoices.length === 0 && (
              <span className="block text-xs text-yellow-600">
                {t("settings.ttsSystemNoVoices")}
              </span>
            )}
            {!showPocketOption && isNativeMobile() && (
              <span className="block text-xs text-muted-foreground">
                {t("settings.ttsPocketRequiresDesktop")}
              </span>
            )}
          </div>

          {isGroqProvider ? (
            <div className="space-y-1 text-sm">
              <span className="font-medium text-foreground">{t("settings.ttsRequestMode")}</span>
              <div className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-foreground">
                {t("settings.ttsDirectToGroq")}
              </div>
            </div>
          ) : isPocketProvider ? (
            <div className="space-y-1 text-sm">
              <span className="font-medium text-foreground">{t("settings.ttsRequestMode")}</span>
              <div className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-foreground">
                {t("settings.ttsLocalOffline")}
              </div>
            </div>
          ) : (
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">{t("settings.ttsRequestMode")}</span>
              <select
                value={activeProviderConfig.requestMode}
                onChange={(e) =>
                  updateTTS({
                    requestMode: e.target.value as "direct" | "proxy",
                    providers: {
                      ...tts.providers,
                      [tts.provider]: {
                        ...activeProviderConfig,
                        requestMode: e.target.value as "direct" | "proxy",
                      },
                    },
                  })
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              >
                <option value="direct">{t("settings.ttsDirectToFal")}</option>
                <option value="proxy">{t("settings.ttsProxyServer")}</option>
              </select>
            </label>
          )}

          {isAndroidProvider && (
            <div className="space-y-2 text-sm md:col-span-2">
              <span className="font-medium text-foreground">{t("settings.ttsAndroidModels")}</span>
              <AndroidTtsModelManager
                activeModelId={activeProviderConfig.modelId}
                onSelectModel={(modelId) =>
                  updateTTS({
                    providers: {
                      ...tts.providers,
                      android: { ...activeProviderConfig, modelId },
                    },
                  })
                }
              />
            </div>
          )}

          {!isGroqProvider && !isPocketProvider && !isSystemProvider && !isAndroidProvider && (
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">{t("settings.ttsLanguage")}</span>
              <select
                value={activeProviderConfig.language}
                onChange={(e) =>
                  updateTTS({
                    language: e.target.value as typeof tts.language,
                    providers: {
                      ...tts.providers,
                      [tts.provider]: {
                        ...activeProviderConfig,
                        language: e.target.value as typeof tts.language,
                      },
                    },
                  })
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              >
                {FAL_LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
            </label>
          )}

          {isPocketProvider && (
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">{t("settings.ttsSpeed")}</span>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={activeProviderConfig.pocketSpeed ?? 1.0}
                onChange={(e) =>
                  updateTTS({
                    pocketSpeed: parseFloat(e.target.value),
                    providers: {
                      ...tts.providers,
                      pocket: { ...activeProviderConfig, pocketSpeed: parseFloat(e.target.value) },
                    },
                  })
                }
                className="w-full"
              />
              <span className="text-xs text-muted-foreground">
                {(activeProviderConfig.pocketSpeed ?? 1.0).toFixed(1)}x
              </span>
            </label>
          )}
        </div>

        {/* Pocket TTS Status Panel */}
        {isPocketProvider && (
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {pocketStatus.available ? (
                  <WifiSlash className="h-4 w-4 text-green-600" />
                ) : (
                  <WifiHigh className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="font-medium text-foreground">
                  {pocketStatus.available
                    ? t("settings.ttsPocketReady")
                    : pocketStatus.downloading
                      ? t("settings.ttsDownloadingModel")
                      : t("settings.ttsPocketNotInstalled")}
                </span>
              </div>
              {!pocketStatus.available && !pocketStatus.downloading && (
                <button
                  onClick={handleDownloadPocketTTS}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                >
                  <Download className="h-4 w-4" />
                  {t("settings.ttsDownload")}
                </button>
              )}
            </div>
            {pocketStatus.downloading && (
              <div className="mt-3">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${pocketStatus.downloadProgress}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("settings.ttsDownloaded", {
                    percent: pocketStatus.downloadProgress.toFixed(0),
                  })}
                </p>
              </div>
            )}
            {pocketStatus.error && (
              <div className="mt-2">
                <p className="text-xs text-destructive">{pocketStatus.error}</p>
                {pocketStatus.error.includes("not installed") && (
                  <code className="mt-1 block rounded bg-muted px-2 py-1 text-xs font-mono text-foreground">
                    uv tool install pocket-tts
                  </code>
                )}
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              {t("settings.ttsPocketOfflineNote")}
            </p>
          </div>
        )}

        {!ttsConfigValidation.valid && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {ttsConfigValidation.error}
          </div>
        )}

        {/* Paid/cloud indicator + explicit consent (ai-billing-safety #14) */}
        {isPaidTtsProvider(String(tts.provider)) && (
          <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <Coins className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span>
                {activeAdapter.label} is a paid cloud voice provider. Speech
                generation is blocked until you enable paid TTS below.
              </span>
            </p>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={tts.paidTtsEnabled === true}
                onChange={(e) => updateTTS({ paidTtsEnabled: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium text-foreground">
                  {t("paid.ttsEnabledLabel")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("paid.ttsEnabledDesc")}
                </span>
              </span>
            </label>
            {tts.paidTtsEnabled !== true && (
              <p className="text-xs text-muted-foreground">
                {t("paid.ttsDisabledHint", { label: activeAdapter.label })}
              </p>
            )}
          </div>
        )}

        {/* API Key section - not needed for Pocket TTS */}
        {!isPocketProvider && !isSystemProvider && (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">{activeAdapter.label} API key</span>
              <input
                ref={credentialInputRef}
                type="password"
                value={apiKeyInput}
                placeholder={
                  activeAdapter.auth.mode === "borrowed" ? "Optional override" : "API key"
                }
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
              <span className="text-xs text-muted-foreground">
                {activeAdapter.auth.mode === "borrowed"
                  ? "Leave empty to use the configured key from another provider entry."
                  : "Stored for this TTS provider only."}
              </span>
              {activeAdapter.auth.mode === "borrowed" &&
                (() => {
                  const source = resolveProviderKey(activeAdapter, settings).source;
                  return source ? (
                    <span className="block text-xs text-emerald-700">
                      Using {describeBorrowedSource(source)}
                      {apiKeyInput.trim() ? " (TTS key overrides it)" : ""}.
                    </span>
                  ) : null;
                })()}
            </label>

            {activeAdapter.id === "fal" && (
              <label className="space-y-1 text-sm">
                <span className="font-medium text-foreground">{t("settings.ttsProxyUrl")}</span>
                <input
                  type="text"
                  value={proxyUrlInput}
                  placeholder="https://your-proxy.example.com/tts"
                  onChange={(e) => setProxyUrlInput(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2"
                />
                <span className="text-xs text-muted-foreground">
                  {t("settings.ttsProxyUrlHint")}
                </span>
              </label>
            )}
          </div>
        )}

        {activeAdapter.canEnumerateModels &&
          activeAdapter.id !== "system" &&
          activeAdapter.id !== "pocket" && (
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="block text-sm font-medium">Model</span>
                  <span className="text-xs text-muted-foreground">
                    {activeProviderConfig.modelId || "No model selected"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowModelBrowser(true)}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                >
                  Browse models
                </button>
              </div>
              {activeAdapter.capabilities.supportsInstructions && (
                <label className="mt-3 block space-y-1 text-sm">
                  <span className="font-medium">Tone instructions</span>
                  <textarea
                    value={activeProviderConfig.instructions}
                    onChange={(event) =>
                      updateTTS({
                        providers: {
                          ...tts.providers,
                          [activeAdapter.id]: {
                            ...activeProviderConfig,
                            instructions: event.target.value,
                          },
                        },
                      })
                    }
                    rows={2}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2"
                    placeholder="Warm, calm, and conversational"
                  />
                </label>
              )}
              {activeAdapter.capabilities.supportsSpeed && (
                <label className="mt-3 block space-y-1 text-sm">
                  <span className="font-medium">
                    Speed{" "}
                    <span className="text-xs text-muted-foreground">
                      {activeProviderConfig.speed.toFixed(2)}×
                    </span>
                  </span>
                  <input
                    type="range"
                    min="0.25"
                    max="4"
                    step="0.05"
                    value={activeProviderConfig.speed}
                    onChange={(event) =>
                      updateTTS({
                        providers: {
                          ...tts.providers,
                          [activeAdapter.id]: {
                            ...activeProviderConfig,
                            speed: Number(event.target.value),
                          },
                        },
                      })
                    }
                    className="w-full"
                  />
                </label>
              )}
            </div>
          )}

        {activeAdapter.id === "openai-compatible" && (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Base URL</span>
              <input
                value={activeProviderConfig.baseUrl}
                onChange={(event) =>
                  updateTTS({
                    providers: {
                      ...tts.providers,
                      "openai-compatible": { ...activeProviderConfig, baseUrl: event.target.value },
                    },
                  })
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
                placeholder="https://example.local/v1"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Model id</span>
              <input
                value={activeProviderConfig.modelId}
                onChange={(event) =>
                  updateTTS({
                    providers: {
                      ...tts.providers,
                      "openai-compatible": { ...activeProviderConfig, modelId: event.target.value },
                    },
                  })
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
                placeholder="tts-1"
              />
            </label>
          </div>
        )}

        {/* Fal-specific model settings */}
        {tts.provider === "fal" && (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">{t("settings.ttsModelId")}</span>
              <input
                type="text"
                value={modelIdInput}
                onChange={(e) => setModelIdInput(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">{t("settings.ttsCloneModelId")}</span>
              <input
                type="text"
                value={cloneModelIdInput}
                onChange={(e) => setCloneModelIdInput(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>
          </div>
        )}

        {/* Groq-specific model settings */}
        {tts.provider === "groq" && (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">{t("settings.ttsGroqTtsModel")}</span>
              <select
                value={groqModelIdInput}
                onChange={(e) => setGroqModelIdInput(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              >
                <option value="playai-tts">playai-tts</option>
                <option value="playai-tts-arabic">playai-tts-arabic</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">{t("settings.ttsResponseFormat")}</span>
              <select
                value={activeProviderConfig.responseFormat}
                onChange={(e) =>
                  updateTTS({
                    groqResponseFormat: e.target.value as "wav" | "mp3",
                    providers: {
                      ...tts.providers,
                      groq: {
                        ...activeProviderConfig,
                        responseFormat: e.target.value as "wav" | "mp3",
                      },
                    },
                  })
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              >
                <option value="mp3">mp3</option>
                <option value="wav">wav</option>
              </select>
            </label>
          </div>
        )}

        {tts.provider === "groq" && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {t("settings.ttsGroqTierNote")}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={saveProviderSettings}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            <FloppyDisk className="h-4 w-4" />
            {t("settings.ttsSaveProviderSettings")}
          </button>
          <button
            onClick={resetTTSSettings}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm"
          >
            <ArrowsClockwise className="h-4 w-4" />
            {t("settings.ttsResetToDefaults")}
          </button>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-base font-semibold text-foreground">
              {t("settings.ttsVoiceProfiles")}
            </h4>
            <p className="text-sm text-muted-foreground">{t("settings.ttsVoiceProfilesDesc")}</p>
          </div>
        </div>

        {!isSystemProvider && (
          <button
            type="button"
            onClick={() => setShowVoiceBrowser(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm text-primary"
          >
            Browse voices{browserVoiceList.length > 0 ? ` (${browserVoiceList.length})` : ""}
          </button>
        )}

        {isSystemProvider ? (
          <SystemVoicePicker
            voices={providerVoices}
            defaultVoiceId={tts.defaultVoiceId}
            previewingId={systemPreviewingId}
            onSelect={(id) => updateTTS({ defaultVoiceId: id })}
            onPreview={(id) => previewSystemVoice(id)}
            onStopPreview={() => {
              if ("speechSynthesis" in window) window.speechSynthesis.cancel();
              setSystemPreviewingId(null);
            }}
            search={systemVoiceSearch}
            onSearchChange={setSystemVoiceSearch}
            showAll={showAllSystemVoices}
            onToggleShowAll={() => setShowAllSystemVoices((v) => !v)}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {providerVoices.map((voice) => (
              <div key={voice.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{voice.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {voice.kind === "builtin"
                        ? t("settings.ttsBuiltInVoice")
                        : t("settings.ttsClonedVoice")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateTTS({ defaultVoiceId: voice.id })}
                      className={cn(
                        "rounded-md border px-2 py-1 text-xs",
                        tts.defaultVoiceId === voice.id
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border"
                      )}
                    >
                      {tts.defaultVoiceId === voice.id
                        ? t("settings.ttsDefault")
                        : t("settings.ttsSetDefault")}
                    </button>
                    {voice.kind === "cloned" && tts.provider === "fal" && (
                      <button
                        onClick={() => removeClonedVoice(voice.id)}
                        className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {tts.provider === "fal" && (
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Microphone className="h-4 w-4 text-primary" />
              <h5 className="font-medium text-foreground">{t("settings.ttsCreateClonedVoice")}</h5>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium text-foreground">{t("settings.ttsVoiceName")}</span>
                <input
                  type="text"
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  placeholder="My Narration Voice"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2"
                />
              </label>

              <label className="space-y-1 text-sm">
                <span className="font-medium text-foreground">{t("settings.ttsAudioSample")}</span>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => handleVoiceFileSelect(e.target.files?.[0] ?? null)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2"
                />
              </label>
            </div>

            <label className="mt-3 block space-y-1 text-sm">
              <span className="font-medium text-foreground">
                {t("settings.ttsSampleTranscript")}
              </span>
              <textarea
                rows={2}
                value={voiceSampleText}
                onChange={(e) => setVoiceSampleText(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              />
            </label>

            {voiceValidationError && (
              <p className="mt-2 text-xs text-destructive">{voiceValidationError}</p>
            )}

            <button
              onClick={handleCloneVoice}
              disabled={operationState === "uploading" || operationState === "cloning"}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {operationState === "uploading" || operationState === "cloning" ? (
                <CircleNotch className="h-4 w-4 animate-spin" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {t("settings.ttsCloneVoice")}
            </button>
          </div>
        )}
      </section>

      {!isGroqProvider && !isSystemProvider && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <h4 className="text-base font-semibold text-foreground">{t("settings.ttsPresets")}</h4>
          <p className="text-sm text-muted-foreground">{t("settings.ttsPresetsDesc")}</p>

          <div className="grid gap-3">
            {tts.presets.map((preset) => (
              <div key={preset.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{preset.name}</p>
                    <p className="text-xs text-muted-foreground">{preset.description}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      temp {preset.temperature.toFixed(2)} • top_p {preset.topP.toFixed(2)} • top_k{" "}
                      {preset.topK}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateTTS({ defaultPresetId: preset.id })}
                      className={cn(
                        "rounded-md border px-2 py-1 text-xs",
                        tts.defaultPresetId === preset.id
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border"
                      )}
                    >
                      {tts.defaultPresetId === preset.id
                        ? t("settings.ttsDefault")
                        : t("settings.ttsSetDefault")}
                    </button>
                    {!preset.readonly && (
                      <button
                        onClick={() => deletePreset(preset.id)}
                        className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <h5 className="mb-2 font-medium text-foreground">{t("settings.ttsAddCustomPreset")}</h5>
            <div className="grid gap-3 md:grid-cols-2">
              <input
                type="text"
                value={customPresetForm.name}
                onChange={(e) => setCustomPresetForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={t("settings.ttsPresetNamePlaceholder")}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={customPresetForm.prompt}
                onChange={(e) =>
                  setCustomPresetForm((prev) => ({ ...prev, prompt: e.target.value }))
                }
                placeholder={t("settings.ttsPromptStylePlaceholder")}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <label className="text-xs">
                {t("settings.ttsTemperature")}
                <NumericInput
                  min={0.1}
                  max={2}
                  step={0.05}
                  value={customPresetForm.temperature}
                  onChange={(value) =>
                    setCustomPresetForm((prev) => ({ ...prev, temperature: value }))
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs">
                {t("settings.ttsTopP")}
                <NumericInput
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={customPresetForm.topP}
                  onChange={(value) => setCustomPresetForm((prev) => ({ ...prev, topP: value }))}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs">
                {t("settings.ttsMaxTokens")}
                <NumericInput
                  min={20}
                  max={1000}
                  step={10}
                  value={customPresetForm.maxNewTokens}
                  onChange={(value) =>
                    setCustomPresetForm((prev) => ({ ...prev, maxNewTokens: value }))
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            <button
              onClick={addCustomPreset}
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <Plus className="h-4 w-4" />
              {t("settings.ttsAddPreset")}
            </button>
          </div>
        </section>
      )}

      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <h4 className="text-base font-semibold text-foreground">
          {isGroqProvider ? t("settings.ttsTestGroqTts") : t("settings.ttsGenerateSpeech")}
        </h4>
        <p className="text-sm text-muted-foreground">
          {isGroqProvider ? t("settings.ttsTestGroqTtsDesc") : t("settings.ttsGenerateSpeechDesc")}
        </p>

        <textarea
          rows={3}
          value={generateText}
          onChange={(e) => setGenerateText(e.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2"
        />

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-foreground">{t("settings.ttsVoiceOverride")}</span>
            <select
              value={overrideVoiceId}
              onChange={(e) => setOverrideVoiceId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
            >
              <option value="default">
                {t("settings.ttsUseDefault", { name: defaultVoice?.name || "none" })}
              </option>
              {providerVoices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}
                </option>
              ))}
            </select>
          </label>

          {!isGroqProvider && (
            <label className="space-y-1 text-sm">
              <span className="font-medium text-foreground">{t("settings.ttsPresetOverride")}</span>
              <select
                value={overridePresetId}
                onChange={(e) => setOverridePresetId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2"
              >
                <option value="default">
                  {t("settings.ttsUseDefault", { name: defaultPreset?.name || "none" })}
                </option>
                {tts.presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void handleGenerateSpeech()}
            disabled={operationState === "generating"}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {operationState === "generating" ? (
              <CircleNotch className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {isGroqProvider ? t("settings.ttsGenerateGroqAudio") : t("settings.ttsGenerateAudio")}
          </button>

          {isGroqProvider && (
            <button
              onClick={() => void handleGroqTest()}
              disabled={operationState === "generating"}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-60"
            >
              <SpeakerHigh className="h-4 w-4" />
              {t("settings.ttsTestGroqTts")}
            </button>
          )}
        </div>

        {operationState === "error" && (
          <button
            onClick={() => void handleGenerateSpeech()}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
          >
            <ArrowsClockwise className="h-4 w-4" />
            {t("settings.ttsRetryGeneration")}
          </button>
        )}

        {generatedAudioUrl && <audio controls src={generatedAudioUrl} className="w-full" />}
      </section>

      {/* Pronunciation Dictionary Section */}
      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-base font-semibold text-foreground">
              Pronunciation Dictionary
            </h4>
            <p className="text-sm text-muted-foreground">
              Custom phonetic overrides for terms, acronyms, and names (e.g. "Episteme" → "eh-PISS-tuh-mee").
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {Object.entries(tts.pronunciationDictionary || {}).map(([word, replacement]) => (
            <div key={word} className="flex items-center gap-3 p-2.5 rounded-lg border border-border/80 bg-background/50">
              <span className="font-medium text-xs text-foreground min-w-[120px] truncate">{word}</span>
              <span className="text-muted-foreground text-xs">→</span>
              <span className="text-xs text-muted-foreground font-mono flex-1 truncate">{replacement}</span>
              <button
                type="button"
                onClick={() => {
                  const nextDict = { ...(tts.pronunciationDictionary || {}) };
                  delete nextDict[word];
                  updateTTS({ pronunciationDictionary: nextDict });
                }}
                className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors"
                aria-label={`Remove ${word}`}
              >
                <Trash className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {Object.keys(tts.pronunciationDictionary || {}).length === 0 && (
            <p className="text-xs text-muted-foreground italic py-1">No custom pronunciation rules defined yet.</p>
          )}
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-border/40">
          <input
            type="text"
            placeholder="Word / Term (e.g. SQLite)"
            value={newPronunciationWord}
            onChange={(e) => setNewPronunciationWord(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
          />
          <input
            type="text"
            placeholder="Spoken as (e.g. sequel-lite)"
            value={newPronunciationReplacement}
            onChange={(e) => setNewPronunciationReplacement(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
          />
          <button
            type="button"
            onClick={() => {
              const w = newPronunciationWord.trim();
              const r = newPronunciationReplacement.trim();
              if (!w || !r) return;
              updateTTS({
                pronunciationDictionary: {
                  ...(tts.pronunciationDictionary || {}),
                  [w]: r,
                },
              });
              setNewPronunciationWord("");
              setNewPronunciationReplacement("");
            }}
            disabled={!newPronunciationWord.trim() || !newPronunciationReplacement.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Rule
          </button>
        </div>
      </section>

      {/* Hands-Free Study Mode Section (openspec add-audio-editions-and-
          hands-free-study-mode, task 4.5) */}
      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 className="text-base font-semibold text-foreground">
              Hands-Free Study Mode
            </h4>
            <p className="text-sm text-muted-foreground">
              Capture extracts, bookmarks, and learning moments with ordinary
              headphone controls while listening — without looking at a screen.
            </p>
          </div>
          {/* Standard Plethora switch (shared component): 44×24px pill with an
              opaque white knob, `bg-muted`/`bg-primary` theme tokens, focus
              ring, and a ≥44px touch target. Replaces the old native
              `<button role="switch">` whose `bg-background` knob + translucent
              off-track collapsed into a malformed oversized circle under some
              themes (and which theme `button`/`[class*="rounded"]` custom CSS
              rules distorted). */}
          <Switch
            checked={handsFree.enabled}
            onCheckedChange={(next) => {
              updateHandsFree({ enabled: next });
              playChime(next ? "mode_study" : "mode_normal");
            }}
            aria-label="Enable Hands-Free Study Mode"
            touchTarget
          />
        </div>

        <p className="text-xs text-muted-foreground bg-muted/40 border border-border/50 rounded-lg px-3 py-2">
          Plethora responds to the media command your headphones send (such as
          Next or Previous). The physical gesture that produces that command
          depends on your headphones. Play/Pause is never remapped, and
          repeating Save Recent Extract within the extension window extends the
          same capture backward instead of creating a duplicate.
        </p>

        {/* Capture window */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-foreground">Capture window</span>
            <select
              value={String(handsFree.captureWindow)}
              onChange={(e) =>
                updateHandsFree({
                  captureWindow:
                    e.target.value === "smart" ? "smart" : (Number(e.target.value) as 15 | 30 | 60),
                })
              }
              className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
            >
              <option value="15">15 seconds</option>
              <option value="30">30 seconds</option>
              <option value="60">60 seconds</option>
              <option value="smart">Smart (snap to sentences &amp; paragraphs, ≤ 90 s)</option>
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium text-foreground">
              Repeat-extension window: {(handsFree.extensionWindowMs / 1000).toFixed(1)} s
            </span>
            <input
              type="range"
              min={500}
              max={5000}
              step={250}
              value={handsFree.extensionWindowMs}
              onChange={(e) => updateHandsFree({ extensionWindowMs: Number(e.target.value) })}
              className="w-full accent-primary"
              aria-label="Repeat extension window in milliseconds"
            />
            <span className="block text-[11px] text-muted-foreground">
              A repeated Save Extract within this window extends the same capture.
            </span>
          </label>
        </div>

        {/* Per-command mappings */}
        <div className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Study Mode command mappings
          </span>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["next", "Next"],
                ["previous", "Previous"],
                ["seekForward", "Seek Forward"],
                ["seekBackward", "Seek Backward"],
              ] as const
            ).map(([slot, label]) => (
              <label key={slot} className="space-y-1.5">
                <span className="text-xs font-medium text-foreground">{label}</span>
                <select
                  value={handsFree.mappings[slot]}
                  onChange={(e) =>
                    updateHandsFree({
                      mappings: { ...handsFree.mappings, [slot]: e.target.value as StudyAction },
                    })
                  }
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
                  aria-label={`Study Mode action for ${label}`}
                >
                  {STUDY_ACTION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>

        {/* Feedback controls */}
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-xs font-medium text-foreground">
            <input
              type="checkbox"
              checked={handsFree.chimeEnabled}
              onChange={(e) => updateHandsFree({ chimeEnabled: e.target.checked })}
              className="accent-primary"
            />
            Confirmation chimes
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium text-foreground">
              Chime volume: {Math.round(handsFree.chimeVolume * 100)}%
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(handsFree.chimeVolume * 100)}
              onChange={(e) => updateHandsFree({ chimeVolume: Number(e.target.value) / 100 })}
              className="w-full accent-primary"
              aria-label="Chime volume"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium text-foreground">
              Ducking: to {Math.round(handsFree.duckingRatio * 100)}% during chimes
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(handsFree.duckingRatio * 100)}
              onChange={(e) => updateHandsFree({ duckingRatio: Number(e.target.value) / 100 })}
              className="w-full accent-primary"
              aria-label="Ducking amount"
            />
          </label>
        </div>
      </section>

      {/* Local TTS models from Hugging Face (requirement #19). Desktop-only:
          the sherpa-onnx TTS runtime surface lives in the desktop build. */}
      {showPocketOption && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-base font-semibold text-foreground">
              Local TTS models (Hugging Face)
            </h4>
          </div>
          <p className="text-sm text-muted-foreground">
            Install sherpa-onnx ONNX TTS models from Hugging Face. Plethora checks hardware
            suitability and only offers models the sherpa runtime can load. The desktop sherpa
            sidecar in this build is speech-to-text only, so installed TTS models are registered
            and ready for a TTS-capable runtime; on Android the native sherpa TTS plugin is used.
          </p>
          <HuggingFaceModelManager mode="tts" />
        </section>
      )}

      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <h4 className="text-base font-semibold">Downloaded speech</h4>
        <DownloadedSpeechSection />
      </section>

      <section className="space-y-2 rounded-xl border border-border bg-card p-5">
        <label className="flex items-center justify-between">
          <span className="text-sm font-medium">Highlight words while reading aloud</span>
          <input type="checkbox" checked={tts.highlightSpokenWord ?? true} onChange={(e)=>updateTTS({ highlightSpokenWord: e.target.checked })} aria-pressed={tts.highlightSpokenWord ?? true} />
        </label>
        <p className="text-xs text-muted-foreground">Highlights the current word as Plethora reads the document aloud.</p>
      </section>

      {operationMessage && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
            operationState === "error"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-primary/30 bg-primary/10 text-foreground"
          )}
        >
          {operationState === "error" ? (
            <WarningCircle className="mt-0.5 h-4 w-4" />
          ) : operationState === "success" ? (
            <Check className="mt-0.5 h-4 w-4 text-primary" />
          ) : (
            <CircleNotch className="mt-0.5 h-4 w-4 animate-spin" />
          )}
          <span>{operationMessage}</span>
        </div>
      )}

      {showVoiceBrowser && (
        <VoiceBrowser
          voices={browserVoiceList}
          currentVoiceId={activeProviderConfig.voiceId || tts.defaultVoiceId}
          currentProvider={String(tts.provider)}
          favorites={tts.favorites}
          recents={tts.recents}
          offline={browserOffline}
          isBilled={activeAdapter.kind === "cloud"}
          onClose={() => setShowVoiceBrowser(false)}
          onSelect={selectBrowserVoice}
          onPreview={activeAdapter.kind === "cloud" ? previewBrowserVoice : undefined}
          onToggleFavorite={(voice) => {
            const key = voice.id;
            const favorites = tts.favorites.includes(key)
              ? tts.favorites.filter((id) => id !== key)
              : [key, ...tts.favorites].slice(0, 50);
            updateTTS({ favorites });
          }}
        />
      )}
      {showModelBrowser && (
        <ModelBrowser
          models={browserModels}
          currentModelId={activeProviderConfig.modelId}
          offline={browserOffline}
          onClose={() => setShowModelBrowser(false)}
          onSelect={(model) => {
            const provider = String(tts.provider) as TTSProvider;
            const previous = getProviderSettings(tts, provider);
            const nextVoice =
              model.supportedVoices === null ? previous.voiceId : model.supportedVoices[0] || "";
            updateTTS({
              providers: {
                ...tts.providers,
                [provider]: { ...previous, modelId: model.id, voiceId: nextVoice },
              },
              defaultVoiceId: nextVoice,
            });
            setModelIdInput(model.id);
            setShowModelBrowser(false);
          }}
          onRefresh={() => {
            const context = { settings, tts, config: activeProviderConfig };
            void activeAdapter
              .listModels(context)
              .then(setBrowserModels)
              .catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}
