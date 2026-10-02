import React, { useState, useEffect, useMemo, useRef } from "react";
import { createOwnedObjectUrl, revokeOwnedObjectUrl } from "../../diagnostics/ownedObjectUrl";
import {
  X,
  Play,
  Stop,
  Sparkle,
  Sliders,
  SpeakerHigh,
  Coins,
  Clock,
  BookOpen,
  WarningCircle,
  CheckCircle,
  Lightning,
  CircleNotch,
  User,
} from "@phosphor-icons/react";
import type { Document } from "../../types/document";
import type { QualityPreset, AudioEdition } from "../../types/audioEdition";
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
import {
  estimateAudioEditionCost,
  formatAudioDuration,
} from "../../utils/audioEditionEstimation";
import { getAdapter } from "../../api/tts/registry";
import {
  POCKET_BUILTIN_VOICES,
  GROQ_BUILTIN_VOICES,
  FAL_BUILTIN_VOICES,
  getProviderSettings,
} from "../../utils/ttsSettings";
import { resolveProviderKey } from "../../api/tts/auth";
import { isPaidTtsProvider, requestPaidConsent } from "../../utils/aiBillingConsent";
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
  { id: "alloy", name: "Alloy", gender: "Neutral", description: "Balanced and versatile (Default)" },
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
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", gender: "Female", description: "Calm, studio narration (Default)" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", gender: "Male", description: "Warm, deep audiobook narrator" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", gender: "Male", description: "Well-rounded, pleasant" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", gender: "Male", description: "Crisp, clear" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", gender: "Female", description: "Strong, confident" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", gender: "Female", description: "Young, clear narration" },
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
  const [quality, setQuality] = useState<QualityPreset>("natural");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Advanced overrides
  const [provider, setProvider] = useState<string>("openrouter");
  const [model, setModel] = useState<string>("openai/tts-1");
  const [voice, setVoice] = useState<string>("alloy");
  const [speed, setSpeed] = useState<number>(1.0);
  const [instructions, setInstructions] = useState<string>("");

  // Audition preview state
  const [isAuditioning, setIsAuditioning] = useState(false);
  const [auditionError, setAuditionError] = useState<string | null>(null);
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
    if (auditionAudioRef.current) {
      auditionAudioRef.current.pause();
      auditionAudioRef.current = null;
    }
    setIsAuditioning(false);
    revokeOwnedObjectUrl(auditionUrlRef.current);
    auditionUrlRef.current = null;
  };

  const handleQualityChange = (newQuality: QualityPreset) => {
    stopAudition();
    setQuality(newQuality);
    setShowAdvanced(false);
    if (newQuality === "fast") {
      setProvider("pocket");
      setModel("default");
      setVoice("alba");
    } else if (newQuality === "natural") {
      setProvider("openrouter");
      setModel("openai/tts-1");
      setVoice("alloy");
    } else if (newQuality === "best") {
      setProvider("elevenlabs");
      setModel("eleven_multilingual_v2");
      setVoice("21m00Tcm4TlvDq8ikWAM"); // Rachel
    }
  };

  const handleProviderChange = (newProvider: string) => {
    stopAudition();
    setProvider(newProvider);
    if (newProvider === "pocket") {
      setModel("default");
      setVoice("alba");
    } else if (newProvider === "openai") {
      setModel("gpt-4o-mini-tts");
      setVoice("alloy");
    } else if (newProvider === "openrouter") {
      setModel("openai/tts-1");
      setVoice("alloy");
    } else if (newProvider === "elevenlabs") {
      setModel("eleven_multilingual_v2");
      setVoice("21m00Tcm4TlvDq8ikWAM");
    } else if (newProvider === "system") {
      setModel("system");
      setVoice("system-default");
    } else if (newProvider === "groq") {
      setModel("playai-tts");
      setVoice("Fiora");
    } else if (newProvider === "fal") {
      setModel("fal-ai/qwen-3-tts/text-to-speech/1.7b");
      setVoice("Vivian");
    }
  };

  // Sync provider/model/voice when preset changes
  // Revoke the audition preview URL on dismiss (task 5.7).
  useEffect(() => {
    return () => {
      revokeOwnedObjectUrl(auditionUrlRef.current ?? "");
      auditionUrlRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (quality === "fast") {
      setProvider("pocket");
      setModel("default");
      setVoice("alba");
    } else if (quality === "natural") {
      setProvider("openrouter");
      setModel("openai/tts-1");
      setVoice("alloy");
    } else if (quality === "best") {
      setProvider("elevenlabs");
      setModel("eleven_multilingual_v2");
      setVoice("21m00Tcm4TlvDq8ikWAM"); // Rachel
    }
  }, [quality]);

  // Dynamic voices fetched from adapter if available
  const [dynamicVoices, setDynamicVoices] = useState<AvailableVoice[]>([]);

  useEffect(() => {
    let cancelled = false;
    const fetchAdapterVoices = async () => {
      try {
        const adapter = getAdapter(provider);
        if (!adapter) return;
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
      .filter((p) => p.provider === provider && p.voice && p.kind !== "builtin")
      .map((p) => ({
        id: p.voice!,
        name: p.name,
        gender: "Custom",
        description: "Saved Profile",
        isCustom: true,
      }));

    let baseList: AvailableVoice[] = [];
    if (provider === "pocket") {
      baseList = POCKET_DEFAULT_VOICES;
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

  const selectedVoiceDisplay = useMemo(() => {
    const found = availableVoices.find(
      (v) => v.id.toLowerCase() === voice.toLowerCase() || v.name.toLowerCase() === voice.toLowerCase()
    );
    return found ? found.name : voice;
  }, [availableVoices, voice]);

  // Derive document sections & sample text
  const { sections, sampleText, totalChars } = useMemo(() => {
    const rawContent = hydratedDoc.content || "";
    let extracted: AudioEditionSemanticSection[] = [];

    if (hydratedDoc.fileType === "epub") {
      const toc = (hydratedDoc.metadata as any)?.toc || [];
      extracted = extractEpubSemanticSections(toc, undefined, { [hydratedDoc.filePath || ""]: rawContent });
    } else if (hydratedDoc.fileType === "pdf") {
      const outline = (hydratedDoc.metadata as any)?.outline || (pdfOutline.length > 0 ? pdfOutline : []);
      extracted = extractPdfSemanticSections(outline, pageContents.length > 0 ? pageContents : undefined, rawContent);
    } else {
      extracted = extractArticleSemanticSections(rawContent);
    }

    // If structural section extraction produced nothing or only empty sections,
    // fallback to article/paragraph chunking on rawContent
    if (
      (extracted.length === 0 || extracted.every((s) => !s.content || s.content.trim().length === 0)) &&
      rawContent.trim().length > 0
    ) {
      extracted = extractArticleSemanticSections(rawContent);
    }

    // Filter out completely empty sections so we don't synthesize blank text
    extracted = extracted.filter((s) => s.content && s.content.trim().length > 0);

    const sample = extracted[0]?.content?.slice(0, 300) || "";
    const count = extracted.reduce((acc, s) => acc + s.characterCount, 0) || stripHtmlTags(rawContent).trim().length;

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

  const handleAudition = async () => {
    if (isAuditioning) {
      if (auditionAudioRef.current) {
        auditionAudioRef.current.pause();
        auditionAudioRef.current = null;
      }
      setIsAuditioning(false);
      return;
    }

    setAuditionError(null);
    setIsAuditioning(true);

    try {
      const audioBlob = await auditionVoicePreview(sampleText, provider, model, voice, {
        speed,
        instructions,
      });

      // Owned URL + revoke-on-replace/-end/-dismiss (task 5.7): the preview
      // URL previously lived for the rest of the session.
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
    } catch (err: any) {
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

      const activeAdapter = getAdapter(provider);
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

      const editionId = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `ed-${Date.now()}`;

      const audioSections = sections.map((s, idx) => ({
        id: typeof crypto !== "undefined" && crypto.randomUUID
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
        audioMimeType: "audio/mp3",
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
        qualityPreset: quality,
        generationSettings: {
          speed,
          instructions,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="bg-card text-card-foreground border border-border w-full max-w-xl rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-audio-edition-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <SpeakerHigh size={22} weight="bold" />
            </div>
            <div>
              <h2 id="create-audio-edition-title" className="text-lg font-semibold leading-tight">
                Create Audio Edition
              </h2>
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                {doc.title}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm">
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

          {/* Quality Tier Selector */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Quality & Voice Profile
            </label>
            <div className="grid grid-cols-3 gap-3">
              {/* Fast */}
              <button
                type="button"
                onClick={() => handleQualityChange("fast")}
                className={`flex flex-col items-start p-3.5 rounded-xl border text-left transition-all ${
                  quality === "fast" && !showAdvanced
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-sm"
                    : "border-border hover:border-muted-foreground/40 bg-card"
                }`}
              >
                <div className="flex items-center gap-1.5 text-primary font-medium text-xs mb-1">
                  <Lightning size={14} weight="fill" />
                  <span>Fast</span>
                </div>
                <span className="font-semibold text-sm">Pocket / Local</span>
                <span className="text-[11px] text-muted-foreground mt-1">
                  Free, on-device offline synthesis
                </span>
              </button>

              {/* Natural */}
              <button
                type="button"
                onClick={() => handleQualityChange("natural")}
                className={`flex flex-col items-start p-3.5 rounded-xl border text-left transition-all ${
                  quality === "natural" && !showAdvanced
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-sm"
                    : "border-border hover:border-muted-foreground/40 bg-card"
                }`}
              >
                <div className="flex items-center gap-1.5 text-emerald-500 font-medium text-xs mb-1">
                  <Sparkle size={14} weight="fill" />
                  <span>Natural</span>
                </div>
                <span className="font-semibold text-sm">OpenAI / Natural</span>
                <span className="text-[11px] text-muted-foreground mt-1">
                  Balanced cadence, realistic speech
                </span>
              </button>

              {/* Best */}
              <button
                type="button"
                onClick={() => handleQualityChange("best")}
                className={`flex flex-col items-start p-3.5 rounded-xl border text-left transition-all ${
                  quality === "best" && !showAdvanced
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-sm"
                    : "border-border hover:border-muted-foreground/40 bg-card"
                }`}
              >
                <div className="flex items-center gap-1.5 text-purple-500 font-medium text-xs mb-1">
                  <CheckCircle size={14} weight="fill" />
                  <span>Best</span>
                </div>
                <span className="font-semibold text-sm">ElevenLabs</span>
                <span className="text-[11px] text-muted-foreground mt-1">
                  Expressive audio, studio clarity
                </span>
              </button>
            </div>
          </div>

          {/* Voice Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="audio-edition-voice-select"
                className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Voice Selection
              </label>
              <span className="text-[11px] text-muted-foreground">
                {availableVoices.length} {availableVoices.length === 1 ? "voice" : "voices"} available
              </span>
            </div>
            <div className="relative">
              <select
                id="audio-edition-voice-select"
                data-testid="voice-select"
                value={voice}
                onChange={(e) => {
                  stopAudition();
                  setVoice(e.target.value);
                }}
                className="w-full bg-background border border-input rounded-xl px-3 py-2 text-sm font-medium text-foreground focus:ring-2 focus:ring-primary focus:outline-none transition-all cursor-pointer shadow-sm"
              >
                {savedVoiceProfiles.length > 0 && (
                  <optgroup label="Saved Voice Profiles">
                    {savedVoiceProfiles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} (Custom Profile)
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Available Voices">
                  {standardVoices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.gender || "Voice"}{v.description ? ` · ${v.description}` : ""})
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>

          {/* Voice Audition Preview Button */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/40 border border-border/80">
            <div className="space-y-0.5 min-w-0 pr-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium">Audition Document Voice</span>
                <span className="text-[11px] text-primary font-semibold truncate">
                  ({selectedVoiceDisplay})
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground line-clamp-1">
                Preview first paragraph: “{sampleText.slice(0, 50)}...”
              </p>
            </div>
            <button
              type="button"
              onClick={handleAudition}
              disabled={isAuditioning ? false : isLoadingDoc || totalChars === 0}
              data-testid="audition-voice-button"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors shadow-sm disabled:opacity-40 shrink-0"
            >
              {isAuditioning ? (
                <>
                  <Stop size={14} weight="fill" className="text-red-500 animate-pulse" />
                  <span>Stop</span>
                </>
              ) : (
                <>
                  <Play size={14} weight="fill" />
                  <span>Audition</span>
                </>
              )}
            </button>
          </div>
          {auditionError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <WarningCircle size={14} />
              {auditionError}
            </p>
          )}

          {/* Advanced Accordion */}
          <div className="border-t border-border/60 pt-4">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-medium transition-colors"
            >
              <Sliders size={14} />
              <span>{showAdvanced ? "Hide Advanced Settings" : "Show Advanced Settings (Provider, Speed, Voice)"}</span>
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-4 p-4 rounded-xl bg-muted/20 border border-border/60">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                      Provider
                    </label>
                    <select
                      value={provider}
                      onChange={(e) => handleProviderChange(e.target.value)}
                      className="w-full bg-background border border-input rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-primary"
                    >
                      <option value="pocket">Pocket TTS (Local)</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="elevenlabs">ElevenLabs</option>
                      <option value="openai">OpenAI</option>
                      <option value="system">System Default</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                      Voice Override
                    </label>
                    <select
                      value={voice}
                      data-testid="advanced-voice-select"
                      onChange={(e) => {
                        stopAudition();
                        setVoice(e.target.value);
                      }}
                      className="w-full bg-background border border-input rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-primary"
                    >
                      {availableVoices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} ({v.gender || "Voice"})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Speed ({speed}x)
                  </label>
                  <input
                    type="range"
                    min="0.75"
                    max="2.0"
                    step="0.05"
                    value={speed}
                    onChange={(e) => setSpeed(parseFloat(e.target.value))}
                    className="w-full mt-1.5"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-muted-foreground mb-1">
                    Custom Prompt / Voice Instructions (Optional)
                  </label>
                  <input
                    type="text"
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="e.g. Read in a calm, documentary narrator tone."
                    className="w-full bg-background border border-input rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Add to Queue Toggle */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/40 border border-border/80">
            <div className="space-y-0.5">
              <span className="text-xs font-medium">Add to Queue</span>
              <p className="text-[11px] text-muted-foreground">
                Place this document into your study Queue for audio-first review once ready.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                data-testid="add-to-queue-toggle"
                checked={addToQueue}
                onChange={(e) => setAddToQueue(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          {/* Pre-Flight Summary Card */}
          <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pre-Flight Summary
            </span>
            <div className="grid grid-cols-3 gap-3 pt-1">
              <div className="flex items-center gap-2">
                <BookOpen size={16} className="text-muted-foreground shrink-0" />
                <div>
                  <div className="text-xs font-semibold">{sections.length} Chapters</div>
                  <div className="text-[11px] text-muted-foreground">{totalChars.toLocaleString()} chars</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Clock size={16} className="text-muted-foreground shrink-0" />
                <div>
                  <div className="text-xs font-semibold">{formatAudioDuration(estimation.estimatedDurationSec)}</div>
                  <div className="text-[11px] text-muted-foreground">Est. Duration</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Coins size={16} className="text-muted-foreground shrink-0" />
                <div>
                  <div className="text-xs font-semibold">
                    {estimation.isFreeTier ? "Free" : `$${estimation.estimatedCostUsd.toFixed(2)} USD`}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {estimation.isFreeTier ? "Local on-device" : "Estimated Cost"}
                  </div>
                </div>
              </div>
            </div>
            {isPaidTtsProvider(provider) && (
              <p className="flex items-start gap-1.5 pt-2 text-[11px] text-amber-600 dark:text-amber-400">
                <WarningCircle size={13} className="shrink-0 mt-0.5" />
                <span>
                  {settings.tts?.paidTtsEnabled !== true
                    ? t("paid.audioEditionPaidNotice", { label: getAdapter(provider).label })
                    : t("paid.audioEditionPaidEnabled", { label: getAdapter(provider).label })}
                </span>
              </p>
            )}
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-xs flex items-center gap-2">
              <WarningCircle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-muted/30">
          <button
            type="button"
            onClick={onClose}
            disabled={isCreating}
            className="px-4 py-2 text-xs font-medium rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={isCreating || isLoadingDoc || totalChars === 0}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
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
  );
}
