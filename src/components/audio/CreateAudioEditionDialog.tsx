import React, { useState, useEffect, useMemo, useRef } from "react";
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
} from "@phosphor-icons/react";
import type { Document } from "../../types/document";
import type { QualityPreset, AudioEdition } from "../../types/audioEdition";
import { useSettingsStore } from "../../stores/settingsStore";
import { useAudioEditionGenerationStore } from "../../stores/audioEditionGenerationStore";
import { createAudioEdition, auditionVoicePreview } from "../../api/audioEditions";
import {
  extractArticleSemanticSections,
  extractEpubSemanticSections,
  extractPdfSemanticSections,
  stripHtmlTags,
  type AudioEditionSemanticSection,
} from "../../utils/sectionIndex";
import {
  estimateAudioEditionCost,
  formatAudioDuration,
} from "../../utils/audioEditionEstimation";
import { getAdapter } from "../../api/tts/registry";
import { isPaidTtsProvider, requestPaidConsent } from "../../utils/aiBillingConsent";

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

  // Submission state
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync provider/model/voice when preset changes
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

  // Derive document sections & sample text
  const { sections, sampleText, totalChars } = useMemo(() => {
    const rawContent = doc.content || "";
    let extracted: AudioEditionSemanticSection[] = [];

    if (doc.fileType === "epub") {
      const toc = (doc.metadata as any)?.toc || [];
      extracted = extractEpubSemanticSections(toc, undefined, { [doc.filePath || ""]: rawContent });
    } else if (doc.fileType === "pdf") {
      const outline = (doc.metadata as any)?.outline || [];
      extracted = extractPdfSemanticSections(outline, undefined, rawContent);
    } else {
      extracted = extractArticleSemanticSections(rawContent);
    }

    if (extracted.length === 0) {
      const plain = stripHtmlTags(rawContent);
      extracted = [
        {
          id: "sec-0",
          sectionIndex: 0,
          title: doc.title || "Full Document",
          sourceStartAnchor: "0",
          characterCount: plain.length,
          content: plain,
          level: 1,
        },
      ];
    }

    const sample = extracted[0]?.content?.slice(0, 300) || doc.title || "Voice audition sample.";
    const count = extracted.reduce((acc, s) => acc + s.characterCount, 0) || rawContent.length;

    return {
      sections: extracted,
      sampleText: sample,
      totalChars: count,
    };
  }, [doc]);

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

      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      auditionAudioRef.current = audio;

      audio.onended = () => {
        setIsAuditioning(false);
        auditionAudioRef.current = null;
      };
      audio.onerror = () => {
        setIsAuditioning(false);
        setAuditionError("Failed to play audition audio.");
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
          setErrorMsg(`Paid TTS is disabled for ${activeAdapter.label}. Enable it in Settings → Voice & TTS to generate this edition.`);
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
        sourceRevisionHash: doc.contentHash || `rev-${Date.now()}`,
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
        sectionTextMap[s.id] = sections[idx]?.content || s.title;
      });

      // Start progressive synthesis job
      void useAudioEditionGenerationStore.getState().startJob(editionId, sectionTextMap);

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
          {/* Quality Tier Selector */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Quality & Voice Profile
            </label>
            <div className="grid grid-cols-3 gap-3">
              {/* Fast */}
              <button
                type="button"
                onClick={() => {
                  setQuality("fast");
                  setShowAdvanced(false);
                }}
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
                onClick={() => {
                  setQuality("natural");
                  setShowAdvanced(false);
                }}
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
                onClick={() => {
                  setQuality("best");
                  setShowAdvanced(false);
                }}
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

          {/* Voice Audition Preview Button */}
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-muted/40 border border-border/80">
            <div className="space-y-0.5">
              <span className="text-xs font-medium">Audition Document Voice</span>
              <p className="text-[11px] text-muted-foreground line-clamp-1">
                Preview first paragraph: “{sampleText.slice(0, 50)}...”
              </p>
            </div>
            <button
              type="button"
              onClick={handleAudition}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors shadow-sm"
            >
              {isAuditioning ? (
                <>
                  <Stop size={14} weight="fill" className="text-red-500" />
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
                      onChange={(e) => setProvider(e.target.value)}
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

          {/* Pre-Flight Summary Card */}
          <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pre-Flight Summary
            </span>            <div className="grid grid-cols-3 gap-3 pt-1">
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
                  This edition will be synthesized with {getAdapter(provider).label}, a paid
                  cloud API
                  {settings.tts?.paidTtsEnabled !== true
                    ? " — paid TTS is currently off, so you'll be asked to enable it before generation."
                    : "."}
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
            disabled={isCreating}
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
