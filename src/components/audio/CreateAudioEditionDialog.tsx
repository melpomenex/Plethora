import { LFM3_LANGUAGES } from "../../utils/lfm3Tts";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { createOwnedObjectUrl, revokeOwnedObjectUrl } from "../../diagnostics/ownedObjectUrl";
import {
  X,
  Play,
  Stop,
  Sliders,
  SpeakerHigh,
  Coins,
  Clock,
  BookOpen,
  WarningCircle,
  CircleNotch,
} from "@phosphor-icons/react";
import type { Document } from "../../types/document";
import type { AudioEdition } from "../../types/audioEdition";
import { useSettingsStore } from "../../stores/settingsStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useAudioEditionGenerationStore } from "../../stores/audioEditionGenerationStore";
import { createAudioEdition, auditionVoicePreview } from "../../api/audioEditions";
import { getDocument, updateDocument, updateDocumentContent } from "../../api/documents";
import { bulkUnsuspendItems } from "../../api/queue";
import { useToastStore, ToastType } from "../common/Toast";
import { AudiobooksTab } from "../tabs/TabRegistry";
import {
  extractArticleSemanticSections,
  extractEpubSemanticSections,
  extractPdfSemanticSections,
  stripHtmlTags,
  type AudioEditionSemanticSection,
} from "../../utils/sectionIndex";
import {
  extractPdfData,
  type PdfPageContent,
  type PdfOutlineItem,
} from "../../utils/pdfTextExtractor";
import { estimateAudioEditionCost, formatAudioDuration } from "../../utils/audioEditionEstimation";
import { getAdapter, listAdapters } from "../../api/tts/registry";
import {
  GROQ_BUILTIN_VOICES,
  FAL_BUILTIN_VOICES,
  getProviderSettings,
} from "../../utils/ttsSettings";
import { resolveProviderKey } from "../../api/tts/auth";
import { isPaidTtsProvider, requestPaidConsent } from "../../utils/aiBillingConsent";
import {
  CHATTERBOX_DEFAULT_VOICE,
  CHATTERBOX_PROVIDER_ID,
  checkChatterboxHealth,
} from "../../utils/chatterboxAudio";
import { t } from "../../lib/i18n";

export interface AvailableVoice {
  id: string;
  name: string;
  gender?: string;
  description?: string;
  isCustom?: boolean;
}

const POCKET_DEFAULT_VOICES: AvailableVoice[] = [
  { id: "alba", name: "Alba", gender: "Female", description: "Warm, natural cadence (Default)" },
  { id: "marius", name: "Marius", gender: "Male", description: "Clear, narrative tone" },
  { id: "javert", name: "Javert", gender: "Male", description: "Authoritative, deep" },
  { id: "jean", name: "Jean", gender: "Male", description: "Calm, steady narrator" },
  { id: "fantine", name: "Fantine", gender: "Female", description: "Gentle, expressive" },
  { id: "cosette", name: "Cosette", gender: "Female", description: "Bright, youthful" },
  { id: "eponine", name: "Eponine", gender: "Female", description: "Rich, conversational" },
  { id: "azelma", name: "Azelma", gender: "Female", description: "Crisp, dynamic" },
];

const OPENAI_DEFAULT_VOICES: AvailableVoice[] = [
  {
    id: "alloy",
    name: "Alloy",
    gender: "Neutral",
    description: "Balanced and versatile (Default)",
  },
  { id: "echo", name: "Echo", gender: "Male", description: "Deep and resonant" },
  { id: "fable", name: "Fable", gender: "Male", description: "British accent, expressive" },
  { id: "onyx", name: "Onyx", gender: "Male", description: "Warm, authoritative" },
  { id: "nova", name: "Nova", gender: "Female", description: "Energetic and bright" },
  { id: "shimmer", name: "Shimmer", gender: "Female", description: "Clear, emotional resonance" },
  { id: "ash", name: "Ash", gender: "Male", description: "Clear, calm narrative" },
  { id: "coral", name: "Coral", gender: "Female", description: "Warm and engaging" },
  { id: "sage", name: "Sage", gender: "Female", description: "Calm and composed" },
];

const ELEVENLABS_DEFAULT_VOICES: AvailableVoice[] = [
  {
    id: "21m00Tcm4TlvDq8ikWAM",
    name: "Rachel",
    gender: "Female",
    description: "Calm, studio narration (Default)",
  },
  {
    id: "pNInz6obpgDQGcFmaJgB",
    name: "Adam",
    gender: "Male",
    description: "Warm, deep audiobook narrator",
  },
  {
    id: "ErXwobaYiN019PkySvjV",
    name: "Antoni",
    gender: "Male",
    description: "Well-rounded, pleasant",
  },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", gender: "Male", description: "Crisp, clear" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", gender: "Female", description: "Strong, confident" },
  {
    id: "MF3mGyEYCl7XYWbV9V6O",
    name: "Elli",
    gender: "Female",
    description: "Young, clear narration",
  },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", gender: "Male", description: "Deep, conversational" },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam", gender: "Male", description: "Dynamic storytelling" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", gender: "Female", description: "Expressive" },
];

const KOKORO_DEFAULT_VOICES: AvailableVoice[] = [
  { id: "af_bella", name: "Bella", gender: "Female", description: "American, gentle (Default)" },
  { id: "af_sarah", name: "Sarah", gender: "Female", description: "American, clear" },
  { id: "af_nicole", name: "Nicole", gender: "Female", description: "American, conversational" },
  { id: "af_sky", name: "Sky", gender: "Female", description: "American, bright" },
  { id: "am_adam", name: "Adam", gender: "Male", description: "American, narrative" },
  { id: "am_michael", name: "Michael", gender: "Male", description: "American, articulate" },
  { id: "bf_emma", name: "Emma", gender: "Female", description: "British, polished" },
  { id: "bf_isabella", name: "Isabella", gender: "Female", description: "British, natural" },
  { id: "bm_george", name: "George", gender: "Male", description: "British, warm" },
  { id: "bm_lewis", name: "Lewis", gender: "Male", description: "British, deep" },
];

const CHATTERBOX_DEFAULT_VOICES: AvailableVoice[] = [
  {
    id: CHATTERBOX_DEFAULT_VOICE,
    name: "Default",
    gender: "Neutral",
    description: "Local Chatterbox voice",
  },
];

interface CreateAudioEditionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  document: Document;
  onCreated?: (editionId: string) => void;
}

export function CreateAudioEditionDialog({
  isOpen,
  onClose,
  document: doc,
  onCreated,
}: CreateAudioEditionDialogProps) {
  const settings = useSettingsStore((state) => state.settings);
  const fileAdapters = listAdapters().filter(
    (adapter) => adapter.capabilities.audioFormats.length > 0
  );
  const preferredProvider = fileAdapters.some((adapter) => adapter.id === settings.tts.provider)
    ? settings.tts.provider
    : "";
  const initialConfig = getProviderSettings(settings.tts, preferredProvider);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [provider, setProvider] = useState<string>(preferredProvider);
  const [model, setModel] = useState(preferredProvider ? initialConfig.modelId : "");
  const [voice, setVoice] = useState(preferredProvider ? initialConfig.voiceId : "");
  const [language, setLanguage] = useState(initialConfig.language);
  const [speed, setSpeed] = useState(initialConfig.speed);
  const [instructions, setInstructions] = useState(initialConfig.instructions);
  const activeAdapter = getAdapter(provider);
  const supportsSpeed =
    Boolean(provider) &&
    activeAdapter.capabilities.supportsSpeed &&
    provider !== CHATTERBOX_PROVIDER_ID;
  const supportsInstructions = Boolean(provider) && activeAdapter.capabilities.supportsInstructions;

  const isChatterboxPath = provider === CHATTERBOX_PROVIDER_ID;
  // Tracks whether the user hand-picked a Chatterbox voice: while untouched,
  // freshly enumerated voices upgrade the "default" fallback automatically.
  const chatterboxVoiceTouchedRef = useRef(false);

  // Audition preview state
  const [isAuditioning, setIsAuditioning] = useState(false);
  const [auditionError, setAuditionError] = useState<string | null>(null);
  const auditionControllerRef = useRef<AbortController | null>(null);
  const auditionAudioRef = useRef<HTMLAudioElement | null>(null);
  const auditionUrlRef = useRef<string | null>(null);

  // Submission state
  const [isCreating, setIsCreating] = useState(false);
  const [addToQueue, setAddToQueue] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Hydrated document state (library listings provide lightweight summaries with content: null)
  const [hydratedDoc, setHydratedDoc] = useState<Document>(doc);
  const [isLoadingDoc, setIsLoadingDoc] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // PDF-specific extracted data
  const [pageContents, setPageContents] = useState<PdfPageContent[]>([]);
  const [pdfOutline, setPdfOutline] = useState<PdfOutlineItem[]>([]);
  const [pdfProgress, setPdfProgress] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    if (!isOpen || !doc?.id) return;

    let cancelled = false;
    setLoadError(null);
    setPdfProgress(null);
    setPageContents([]);
    setPdfOutline([]);

    const hydrate = async () => {
      setIsLoadingDoc(true);
      try {
        let currentDoc = doc;
        if (!currentDoc.content || currentDoc.content.trim().length === 0) {
          const fullDoc = await getDocument(doc.id);
          if (cancelled) return;
          if (fullDoc) {
            currentDoc = fullDoc;
          }
        }

        // For PDF documents: extract pages and outline if text is missing or outline/pages needed
        if (currentDoc.fileType === "pdf" && currentDoc.filePath) {
          const isContentEmpty = !currentDoc.content || currentDoc.content.trim().length === 0;
          try {
            const extracted = await extractPdfData(currentDoc.filePath, {
              onProgress: (current, total) => {
                if (!cancelled) {
                  setPdfProgress({ current, total });
                }
              },
              isCancelled: () => cancelled,
            });

            if (cancelled) return;

            if (extracted.pageContents.length > 0) {
              setPageContents(extracted.pageContents);
              setPdfOutline(extracted.outline);

              if (extracted.fullText && isContentEmpty) {
                currentDoc = { ...currentDoc, content: extracted.fullText };
                updateDocumentContent(currentDoc.id, extracted.fullText).catch((err) => {
                  console.warn("Failed to persist extracted PDF text to document:", err);
                });
              }
            }
          } catch (pdfErr: any) {
            console.warn("Failed to extract PDF data:", pdfErr);
            if (isContentEmpty) {
              setLoadError(`Failed to extract PDF text: ${pdfErr?.message || "Unknown error"}`);
            }
          }
        }

        if (!cancelled) {
          setHydratedDoc(currentDoc);
        }
      } catch (err: any) {
        if (!cancelled) {
          console.warn("Failed to hydrate document for audio edition:", err);
          setHydratedDoc(doc);
          setLoadError(err?.message || "Failed to load document content.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingDoc(false);
          setPdfProgress(null);
        }
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [isOpen, doc.id, doc.filePath]);

  // Stop audition helper
  const stopAudition = () => {
    auditionControllerRef.current?.abort();
    auditionControllerRef.current = null;
    if (auditionAudioRef.current) {
      auditionAudioRef.current.pause();
      auditionAudioRef.current = null;
    }
    setIsAuditioning(false);
    revokeOwnedObjectUrl(auditionUrlRef.current);
    auditionUrlRef.current = null;
  };

  const handleProviderChange = (newProvider: string) => {
    stopAudition();
    const config = getProviderSettings(useSettingsStore.getState().settings.tts, newProvider);
    setProvider(newProvider);
    setModel(config.modelId);
    setVoice(config.voiceId);
    setLanguage(config.language);
    setSpeed(newProvider === "pocket" ? config.pocketSpeed : config.speed);
    setInstructions(config.instructions);
    setDynamicVoices([]);
    setAuditionError(null);
    chatterboxVoiceTouchedRef.current = false;
  };

  // Dynamic voices fetched from adapter if available (declared before the
  // provider handler: they read the latest enumeration).
  const [dynamicVoices, setDynamicVoices] = useState<AvailableVoice[]>([]);

  useEffect(() => {
    return () => {
      auditionControllerRef.current?.abort();
      auditionAudioRef.current?.pause();
      revokeOwnedObjectUrl(auditionUrlRef.current ?? "");
      auditionUrlRef.current = null;
    };
  }, []);

  // Snapshot the user's TTS choices when opening; edits belong to this edition.
  useEffect(() => {
    if (!isOpen) {
      stopAudition();
      return;
    }
    const tts = useSettingsStore.getState().settings.tts;
    const selected = listAdapters().find(
      (adapter) => adapter.id === tts.provider && adapter.capabilities.audioFormats.length > 0
    );
    const id = selected?.id ?? "";
    const config = getProviderSettings(tts, id);
    setProvider(id);
    setModel(id ? config.modelId : "");
    setVoice(id ? config.voiceId : "");
    setLanguage(config.language);
    setSpeed(id === "pocket" ? config.pocketSpeed : config.speed);
    setInstructions(config.instructions);
    setShowAdvanced(false);
    setDynamicVoices([]);
    setAuditionError(null);
  }, [isOpen, doc.id]);

  // Upgrade the Chatterbox fallback voice once enumeration lands, unless the
  // user already hand-picked a voice on this path.
  useEffect(() => {
    if (
      isChatterboxPath &&
      !chatterboxVoiceTouchedRef.current &&
      voice === CHATTERBOX_DEFAULT_VOICE &&
      dynamicVoices.length > 0 &&
      dynamicVoices[0].id !== voice
    ) {
      setVoice(dynamicVoices[0].id);
    }
  }, [isChatterboxPath, voice, dynamicVoices]);

  // Dynamic voice fetch effect (state declared above for handler access).
  useEffect(() => {
    let cancelled = false;
    const fetchAdapterVoices = async () => {
      try {
        if (!provider) return;
        const adapter = getAdapter(provider);
        const tts = settings.tts || ({} as any);
        const config = getProviderSettings(tts, provider);
        const resolvedKey = adapter?.auth ? resolveProviderKey(adapter, settings) : { key: "" };
        const voices = await adapter.listVoices(
          {
            settings,
            tts,
            config: { ...config, modelId: model },
            apiKey: resolvedKey.key || undefined,
            borrowedFrom: resolvedKey.source,
          },
          model
        );
        if (!cancelled && voices && voices.length > 0) {
          setDynamicVoices(
            voices.map((v) => ({
              id: v.id,
              name: v.name,
              gender: v.gender,
              description: v.vendor,
            }))
          );
        }
      } catch {
        // Fallback to built-in rosters
      }
    };
    void fetchAdapterVoices();
    return () => {
      cancelled = true;
    };
  }, [provider, model, settings]);

  const { savedVoiceProfiles, standardVoices, availableVoices } = useMemo(() => {
    const userProfiles = (settings.tts?.voiceProfiles || [])
      .filter(
        (p) => p.provider === provider && (p.voice || p.speakerEmbeddingUrl) && p.kind !== "builtin"
      )
      .map((p) => ({
        id: (p.voice || p.id)!,
        name: p.name,
        gender: "Custom",
        description: "Saved Profile",
        isCustom: true,
      }));

    let baseList: AvailableVoice[] = [];
    if (provider === "pocket") {
      baseList = POCKET_DEFAULT_VOICES;
    } else if (provider === "lfm3") {
      baseList = [
        { id: "female", name: "Female" },
        { id: "male", name: "Male" },
      ];
    } else if (provider === "openai") {
      baseList = OPENAI_DEFAULT_VOICES;
    } else if (provider === "elevenlabs") {
      baseList = ELEVENLABS_DEFAULT_VOICES;
    } else if (provider === "openrouter") {
      baseList = model.toLowerCase().includes("kokoro")
        ? KOKORO_DEFAULT_VOICES
        : OPENAI_DEFAULT_VOICES;
    } else if (provider === "system") {
      baseList = [{ id: "system-default", name: "System Default", gender: "Neutral" }];
    } else if (provider === "groq") {
      baseList = GROQ_BUILTIN_VOICES.map((id) => ({
        id,
        name: id,
        gender: "Neutral",
      }));
    } else if (provider === "fal") {
      baseList = FAL_BUILTIN_VOICES.map((id) => ({
        id,
        name: id.replace(/_/g, " "),
        gender: "Neutral",
      }));
    } else if (provider === CHATTERBOX_PROVIDER_ID) {
      baseList = CHATTERBOX_DEFAULT_VOICES;
    }

    const mergedStandard: AvailableVoice[] = [...baseList];
    for (const dv of dynamicVoices) {
      if (!mergedStandard.some((v) => v.id.toLowerCase() === dv.id.toLowerCase())) {
        mergedStandard.push(dv);
      }
    }

    const allVoices = [...userProfiles, ...mergedStandard];
    return {
      savedVoiceProfiles: userProfiles,
      standardVoices: mergedStandard,
      availableVoices: allVoices,
    };
  }, [provider, model, settings.tts?.voiceProfiles, dynamicVoices]);

  useEffect(() => {
    const namedVoice = availableVoices.find(
      (item) => item.name.toLowerCase() === voice.toLowerCase()
    );
    if (!availableVoices.some((item) => item.id === voice) && namedVoice) setVoice(namedVoice.id);
  }, [availableVoices, voice]);

  // Derive document sections & sample text
  const { sections, sampleText, totalChars } = useMemo(() => {
    const rawContent = hydratedDoc.content || "";
    let extracted: AudioEditionSemanticSection[] = [];

    if (hydratedDoc.fileType === "epub") {
      const toc = (hydratedDoc.metadata as any)?.toc || [];
      extracted = extractEpubSemanticSections(toc, undefined, {
        [hydratedDoc.filePath || ""]: rawContent,
      });
    } else if (hydratedDoc.fileType === "pdf") {
      const outline =
        (hydratedDoc.metadata as any)?.outline || (pdfOutline.length > 0 ? pdfOutline : []);
      extracted = extractPdfSemanticSections(
        outline,
        pageContents.length > 0 ? pageContents : undefined,
        rawContent
      );
    } else {
      extracted = extractArticleSemanticSections(rawContent);
    }

    // If structural section extraction produced nothing or only empty sections,
    // fallback to article/paragraph chunking on rawContent
    if (
      (extracted.length === 0 ||
        extracted.every((s) => !s.content || s.content.trim().length === 0)) &&
      rawContent.trim().length > 0
    ) {
      extracted = extractArticleSemanticSections(rawContent);
    }

    // Filter out completely empty sections so we don't synthesize blank text
    extracted = extracted.filter((s) => s.content && s.content.trim().length > 0);

    const sample = extracted[0]?.content?.slice(0, 300) || "";
    const count =
      extracted.reduce((acc, s) => acc + s.characterCount, 0) ||
      stripHtmlTags(rawContent).trim().length;

    return {
      sections: extracted,
      sampleText: sample,
      totalChars: count,
    };
  }, [hydratedDoc, pdfOutline, pageContents]);

  // Pre-flight estimation
  const estimation = useMemo(() => {
    return estimateAudioEditionCost({
      characterCount: totalChars,
      provider,
      model,
      speed,
    });
  }, [totalChars, provider, model, speed]);

  const playAuditionBlob = async (audioBlob: Blob) => {
    revokeOwnedObjectUrl(auditionUrlRef.current);
    const audioUrl = createOwnedObjectUrl(audioBlob, { owner: "edition-audition" });
    auditionUrlRef.current = audioUrl;
    const audio = new Audio(audioUrl);
    auditionAudioRef.current = audio;
    audio.onended = () => {
      setIsAuditioning(false);
      auditionAudioRef.current = null;
      revokeOwnedObjectUrl(audioUrl);
      if (auditionUrlRef.current === audioUrl) auditionUrlRef.current = null;
    };
    audio.onerror = () => {
      setIsAuditioning(false);
      setAuditionError("Failed to play audition audio.");
      revokeOwnedObjectUrl(audioUrl);
      if (auditionUrlRef.current === audioUrl) auditionUrlRef.current = null;
    };
    await audio.play();
  };

  const handleAudition = async () => {
    if (isAuditioning) {
      stopAudition();
      return;
    }

    setAuditionError(null);

    // Chatterbox pre-flight: fail fast with the recovery command instead of
    // hanging on an unreachable local service.
    if (isChatterboxPath) {
      const baseUrl = getProviderSettings(settings.tts, CHATTERBOX_PROVIDER_ID).baseUrl || "";
      const health = await checkChatterboxHealth(baseUrl);
      if (!health.ok) {
        setAuditionError(health.error || "Chatterbox service is unreachable.");
        return;
      }
    }

    setIsAuditioning(true);
    const controller = new AbortController();
    auditionControllerRef.current = controller;

    try {
      const audioBlob = await auditionVoicePreview(
        sampleText,
        provider,
        model,
        voice,
        {
          speed: supportsSpeed ? speed : undefined,
          instructions: supportsInstructions ? instructions : undefined,
          responseFormat: isChatterboxPath || provider === "lfm3" ? "wav" : undefined,
          language,
        },
        controller.signal
      );
      if (controller.signal.aborted) return;

      await playAuditionBlob(audioBlob);
    } catch (err: any) {
      if (controller.signal.aborted) return;
      console.warn("Audition error:", err);
      setAuditionError(err?.message || "Audition failed.");
      setIsAuditioning(false);
    }
  };

  const handleCreate = async () => {
    setIsCreating(true);
    setErrorMsg(null);

    try {
      if (totalChars === 0 || sections.length === 0) {
        setErrorMsg("Cannot create audio edition: document contains no readable text.");
        setIsCreating(false);
        return;
      }

      if (!provider || !activeAdapter.capabilities.audioFormats.length)
        throw new Error("Choose a narration provider that can create audio files.");
      // Paid/cloud gate (ai-billing-safety #14): never start a billable
      // audio-edition synthesis without explicit consent. The pre-flight
      // summary already discloses the provider/cost; this enforces the flag.
      if (isPaidTtsProvider(provider)) {
        const granted = await requestPaidConsent({
          kind: "tts",
          provider,
          model,
          label: activeAdapter.label,
        });
        if (!granted) {
          setErrorMsg(t("paid.audioEditionConsentRequired", { label: activeAdapter.label }));
          return;
        }
      }

      // Chatterbox pre-flight (same fail-fast contract as audition).
      if (isChatterboxPath) {
        const baseUrl = getProviderSettings(settings.tts, CHATTERBOX_PROVIDER_ID).baseUrl || "";
        const health = await checkChatterboxHealth(baseUrl);
        if (!health.ok) {
          setErrorMsg(health.error || "Chatterbox service is unreachable.");
          return;
        }
      }

      const editionId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `ed-${Date.now()}`;

      const audioSections = sections.map((s, idx) => ({
        id:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `sec-${Date.now()}-${idx}`,
        editionId,
        sectionIndex: s.sectionIndex,
        title: s.title,
        sourceSectionId: s.sourceSectionId || null,
        sourceStartAnchor: s.sourceStartAnchor || null,
        sourceEndAnchor: s.sourceEndAnchor || null,
        characterCount: s.characterCount,
        audioFilePath: null,
        audioMimeType: isChatterboxPath || provider === "lfm3" ? "audio/wav" : "audio/mp3",
        durationSec: 0,
        generationStatus: "queued" as const,
        failureReason: null,
        retryCount: 0,
        cacheKey: `ed-${doc.id}-${idx}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));

      const newEdition: AudioEdition = {
        id: editionId,
        sourceDocumentId: doc.id,
        sourceRevisionHash: hydratedDoc.contentHash || doc.contentHash || `rev-${Date.now()}`,
        provider,
        model,
        voice,
        qualityPreset: null,
        generationSettings: {
          language,
          responseFormat: provider === "lfm3" ? "wav" : undefined,
          speed: supportsSpeed ? speed : undefined,
          instructions: supportsInstructions ? instructions : undefined,
        },
        totalDurationSec: estimation.estimatedDurationSec,
        status: "draft",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sections: audioSections,
      };

      await createAudioEdition(newEdition, audioSections);

      // Build section text map
      const sectionTextMap: Record<string, string> = {};
      audioSections.forEach((s, idx) => {
        sectionTextMap[s.id] = sections[idx]?.content || "";
      });

      if (addToQueue) {
        try {
          await bulkUnsuspendItems([doc.id]);
          const fullDoc = await getDocument(doc.id);
          if (fullDoc) {
            await updateDocument(doc.id, { ...fullDoc, isArchived: false, isDismissed: false });
          }
        } catch (enqueueErr) {
          console.warn("[CreateAudioEditionDialog] Failed to enqueue document:", enqueueErr);
        }
      }

      // Start progressive synthesis job
      void useAudioEditionGenerationStore.getState().startJob(editionId, sectionTextMap);

      // Dispatch toast notification with quick jump to Audiobooks shelf
      useToastStore.getState().addToast({
        type: ToastType.Info,
        title: "Generating Audio Edition",
        message: `Started generating audio edition for "${doc.title || "Document"}".`,
        action: {
          label: "View Audiobooks",
          onClick: () => {
            useTabsStore.getState().addTab({
              title: "Audiobooks",
              icon: "🎧",
              type: "audiobook",
              content: AudiobooksTab,
              closable: true,
            });
          },
        },
      });

      onCreated?.(editionId);
      onClose();
    } catch (err: any) {
      console.error("Failed to create audio edition:", err);
      setErrorMsg(err?.message || "Failed to create audio edition.");
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isCreating) {
          onClose();
        }
      }}
    >
      <div
        className="bg-card text-card-foreground border border-border w-full max-w-xl rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh] my-auto animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-audio-edition-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4 border-b border-border bg-muted/30 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
              <SpeakerHigh size={22} weight="bold" />
            </div>
            <div className="min-w-0">
              <h2
                id="create-audio-edition-title"
                className="text-base sm:text-lg font-semibold leading-tight truncate"
              >
                Create Audio Edition
              </h2>
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{doc.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted transition-colors shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto min-h-0 space-y-5 sm:space-y-6 flex-1 text-sm overscroll-contain">
          {/* Document Hydration Loading Indicator */}
          {isLoadingDoc && (
            <div className="space-y-2 p-3.5 rounded-xl bg-primary/10 border border-primary/20 text-primary text-xs">
              <div className="flex items-center gap-2.5">
                <CircleNotch size={16} className="animate-spin shrink-0" />
                <span className="font-medium">
                  {pdfProgress && pdfProgress.total > 0
                    ? `Extracting PDF text and outline (page ${pdfProgress.current} of ${pdfProgress.total})...`
                    : "Reading document content and extracting sections..."}
                </span>
              </div>
              {pdfProgress && pdfProgress.total > 0 && (
                <div className="w-full bg-primary/20 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-primary h-1.5 rounded-full transition-all duration-150"
                    style={{
                      width: `${Math.min(100, Math.round((pdfProgress.current / pdfProgress.total) * 100))}%`,
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Empty Content Alert Banner */}
          {!isLoadingDoc && totalChars === 0 && (
            <div className="flex items-center gap-2 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs">
              <WarningCircle size={16} className="shrink-0" />
              <span>This document has no readable text content to generate an audio edition.</span>
            </div>
          )}

          {loadError && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-xs flex items-center gap-2">
              <WarningCircle size={16} className="shrink-0" />
              <span>{loadError}</span>
            </div>
          )}

          <section aria-labelledby="audio-edition-narration-title" className="space-y-4">
            <h3 id="audio-edition-narration-title" className="text-base font-semibold">
              Narration
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="min-w-0 space-y-1.5 text-sm">
                <span className="font-medium">Narration provider</span>
                <select
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="min-h-10 w-full rounded-lg border border-input bg-background px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <option value="" disabled>
                    Choose a provider
                  </option>
                  <optgroup label="On this device">
                    {fileAdapters
                      .filter((adapter) => adapter.kind === "local")
                      .map((adapter) => (
                        <option key={adapter.id} value={adapter.id}>
                          {adapter.label}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Cloud services">
                    {fileAdapters
                      .filter(
                        (adapter) =>
                          adapter.kind === "cloud" && adapter.id !== CHATTERBOX_PROVIDER_ID
                      )
                      .map((adapter) => (
                        <option key={adapter.id} value={adapter.id}>
                          {adapter.label}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Custom service">
                    <option value={CHATTERBOX_PROVIDER_ID}>Chatterbox / OpenAI-compatible</option>
                  </optgroup>
                </select>
              </label>
              <label className="min-w-0 space-y-1.5 text-sm">
                <span className="font-medium">Voice</span>
                <select
                  id="audio-edition-voice-select"
                  data-testid="voice-select"
                  value={voice}
                  disabled={!provider}
                  onChange={(e) => {
                    stopAudition();
                    chatterboxVoiceTouchedRef.current = true;
                    setVoice(e.target.value);
                  }}
                  className="min-h-10 w-full rounded-lg border border-input bg-background px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                >
                  {savedVoiceProfiles.length > 0 && (
                    <optgroup label="Saved voices">
                      {savedVoiceProfiles.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Available voices">
                    {!provider && (
                      <option value="" disabled>
                        Choose a voice
                      </option>
                    )}
                    {voice && !availableVoices.some((item) => item.id === voice) && (
                      <option value={voice}>Configured voice ({voice})</option>
                    )}
                    {standardVoices.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
            </div>
            <p className="text-sm text-muted-foreground">
              {!provider
                ? "Your current voice plays live and cannot create an audio file. Choose a narration provider."
                : activeAdapter.kind === "local"
                  ? "Runs on this device. No API key needed."
                  : provider === CHATTERBOX_PROVIDER_ID
                    ? "Uses your configured Chatterbox or OpenAI-compatible service."
                    : "Uses your provider settings. Cloud narration may incur charges."}
            </p>
            {provider === "lfm3" && (
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Language</span>
                <select
                  value={language}
                  onChange={(e) => {
                    stopAudition();
                    setLanguage(e.target.value);
                  }}
                  className="min-h-10 w-full rounded-lg border border-input bg-background px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {LFM3_LANGUAGES.map(([id, , label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">Try a short sample.</p>
              <button
                type="button"
                onClick={handleAudition}
                disabled={!provider || (!isAuditioning && (isLoadingDoc || totalChars === 0))}
                data-testid="audition-voice-button"
                className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
              >
                {isAuditioning ? (
                  <Stop size={16} weight="fill" />
                ) : (
                  <Play size={16} weight="fill" />
                )}
                {isAuditioning ? "Stop" : "Preview voice"}
              </button>
            </div>
            {auditionError && (
              <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
                <WarningCircle size={16} className="shrink-0" />
                {auditionError}
              </p>
            )}
            <button
              type="button"
              aria-expanded={showAdvanced}
              aria-controls="audio-edition-options"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Sliders size={16} />
              {showAdvanced ? "Fewer options" : "More options"}
            </button>
            {showAdvanced && (
              <div id="audio-edition-options" className="space-y-4 border-t border-border pt-4">
                <p className="break-words text-sm text-muted-foreground">
                  Model: {provider === "lfm3" ? "LFM3 Audio 2B" : model || "Choose a provider"}
                </p>
                {supportsSpeed ? (
                  <label className="block space-y-2 text-sm">
                    <span className="font-medium">Speed ({speed}x)</span>
                    <input
                      type="range"
                      min="0.75"
                      max="2.0"
                      step="0.05"
                      value={speed}
                      onChange={(e) => setSpeed(parseFloat(e.target.value))}
                      className="min-h-10 w-full"
                    />
                  </label>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This provider uses its natural speaking pace. You can adjust playback speed in
                    the player.
                  </p>
                )}
                {supportsInstructions && (
                  <label className="block space-y-1.5 text-sm">
                    <span className="font-medium">Voice instructions (optional)</span>
                    <input
                      type="text"
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      placeholder="For example, read in a calm, documentary tone."
                      className="min-h-10 w-full rounded-lg border border-input bg-background px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    />
                  </label>
                )}
              </div>
            )}
          </section>

          <label className="flex min-h-10 cursor-pointer items-start gap-3 border-t border-border py-3">
            <input
              type="checkbox"
              data-testid="add-to-queue-toggle"
              checked={addToQueue}
              onChange={(e) => setAddToQueue(e.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            />
            <span className="space-y-1 text-sm">
              <span className="block font-medium">Add to Queue</span>
              <span className="block text-xs text-muted-foreground">
                Include this document in your study queue.
              </span>
            </span>
          </label>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-xs flex items-center gap-2">
              <WarningCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Estimate and action stay visible while the document options scroll. */}
        <div className="shrink-0 space-y-3 border-t border-border bg-muted/30 px-4 py-3 sm:px-6 sm:py-4">
          <div
            role="group"
            aria-label="Edition estimate"
            className="flex flex-wrap items-start justify-between gap-3 text-sm"
          >
            <div className="flex items-center gap-2">
              <BookOpen size={16} className="shrink-0 text-muted-foreground" />
              <span>
                <span className="block font-medium">
                  {sections.length} {sections.length === 1 ? "chapter" : "chapters"}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {totalChars.toLocaleString()} characters
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Clock size={16} className="shrink-0 text-muted-foreground" />
              <span>
                <span className="block font-medium">
                  {formatAudioDuration(estimation.estimatedDurationSec)}
                </span>
                <span className="block text-xs text-muted-foreground">Estimated duration</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Coins size={16} className="shrink-0 text-muted-foreground" />
              <span>
                <span className="block font-medium">
                  {estimation.isFreeTier
                    ? "Free"
                    : `$${estimation.estimatedCostUsd.toFixed(2)} USD`}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {activeAdapter.kind === "local" ? "On this device" : "Estimated cost"}
                </span>
              </span>
            </div>
          </div>
          {isPaidTtsProvider(provider) && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <WarningCircle size={14} className="shrink-0" />
              <span>
                {settings.tts?.paidTtsEnabled !== true
                  ? t("paid.audioEditionPaidNotice", { label: activeAdapter.label })
                  : t("paid.audioEditionPaidEnabled", { label: activeAdapter.label })}
              </span>
            </p>
          )}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isCreating}
              className="min-h-10 px-4 py-2 text-sm font-medium rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!provider || isCreating || isLoadingDoc || totalChars === 0}
              className="flex min-h-10 items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
            >
              {isCreating ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                  <span>Creating Edition...</span>
                </>
              ) : (
                <>
                  <SpeakerHigh size={16} weight="bold" />
                  <span>Create Audio Edition</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
