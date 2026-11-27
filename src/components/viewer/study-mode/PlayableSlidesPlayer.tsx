import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaretLeft,
  CaretRight,
  CloudCheck,
  Exam,
  LinkSimple,
  Pause,
  Play,
  PresentationChart,
} from "@phosphor-icons/react";
import { useSettingsStore } from "../../../stores/settingsStore";
import {
  loadCachedStudyMedia,
  saveCachedStudyMedia,
} from "../../../lib/study-plans/studyMode/studyMediaCache";
import { synthesizeStudySegment } from "../../../lib/study-plans/studyMode/studyTtsBridge";
import type { StudyModeArtifact } from "../../../types/studyMode";

export interface PlayableSlidesPlayerProps {
  artifact: StudyModeArtifact;
  scopeKey: string;
  sourceRevision: string;
  isOffline?: boolean;
  onJumpToCitation: (quote?: string) => void;
  onPracticeSlide: (slideObjective: string) => void;
}

interface SlideItem {
  title: string;
  objective: string;
  bullets: string[];
  narration: string;
  citations: Array<{ sourceId?: string; quote?: string }>;
}

export const PlayableSlidesPlayer: React.FC<PlayableSlidesPlayerProps> = ({
  artifact,
  scopeKey,
  sourceRevision,
  isOffline = false,
  onJumpToCitation,
  onPracticeSlide,
}) => {
  const settings = useSettingsStore((s) => s.settings);

  const slides: SlideItem[] = useMemo(() => {
    const raw = artifact.payload.slides;
    if (!Array.isArray(raw)) return [];
    return raw.map((item, idx) => {
      const obj = (item ?? {}) as Record<string, unknown>;
      return {
        title: String(obj.title ?? `Slide ${idx + 1}`),
        objective: String(obj.objective ?? ""),
        bullets: Array.isArray(obj.bullets) ? obj.bullets.map(String) : [],
        narration: String(obj.narration ?? ""),
        citations: Array.isArray(obj.citations)
          ? (obj.citations as Array<{ sourceId?: string; quote?: string }>)
          : [],
      };
    });
  }, [artifact.payload.slides]);

  const cachedManifest = useMemo(
    () => loadCachedStudyMedia(artifact.id, sourceRevision),
    [artifact.id, sourceRevision]
  );

  const [slideIndex, setSlideIndex] = useState<number>(
    cachedManifest ? Math.min(cachedManifest.lastPositionIndex, Math.max(0, slides.length - 1)) : 0
  );
  const [isNarrating, setIsNarrating] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [isCachedOffline, setIsCachedOffline] = useState(Boolean(cachedManifest));

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stopNarration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopNarration();
  }, [stopNarration]);

  const goToSlide = useCallback(
    (nextIdx: number) => {
      const clamped = Math.max(0, Math.min(slides.length - 1, nextIdx));
      setSlideIndex(clamped);
      const existing = loadCachedStudyMedia(artifact.id, sourceRevision);
      saveCachedStudyMedia({
        artifactId: artifact.id,
        kind: "slides",
        scopeKey,
        sourceRevision,
        lastPositionIndex: clamped,
        segments: existing?.segments ?? [],
        cachedAt: existing?.cachedAt ?? new Date().toISOString(),
      });
    },
    [artifact.id, scopeKey, slides.length, sourceRevision]
  );

  useEffect(() => {
    if (!isNarrating || slides.length === 0) {
      stopNarration();
      return;
    }
    const current = slides[slideIndex];
    if (!current) {
      setIsNarrating(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    void (async () => {
      const synthesized = await synthesizeStudySegment({
        artifactId: artifact.id,
        kind: "slides",
        scopeKey,
        sourceRevision,
        index: slideIndex,
        text: current.narration || current.bullets.join(". "),
        settings,
        isOffline,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;
      setIsCachedOffline(
        synthesized.fromCache ||
          synthesized.source === "tts_cache" ||
          synthesized.source === "tts_provider"
      );

      const handleFinish = () => {
        if (autoAdvance && slideIndex + 1 < slides.length) {
          goToSlide(slideIndex + 1);
        } else {
          setIsNarrating(false);
        }
      };

      if (synthesized.audioUrl && typeof Audio !== "undefined") {
        const audio = new Audio(synthesized.audioUrl);
        audioRef.current = audio;
        audio.onended = handleFinish;
        audio.onerror = handleFinish;
        audio.play().catch(() => {
          timerRef.current = setTimeout(handleFinish, Math.max(1500, synthesized.durationSec * 1000));
        });
      } else if (
        synthesized.source === "speech_synthesis" &&
        typeof window !== "undefined" &&
        typeof window.speechSynthesis !== "undefined" &&
        typeof SpeechSynthesisUtterance !== "undefined"
      ) {
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(
            current.narration || current.bullets.join(". ")
          );
          utterance.onend = () => {
            if (!controller.signal.aborted) handleFinish();
          };
          utterance.onerror = () => {
            if (!controller.signal.aborted) handleFinish();
          };
          window.speechSynthesis.speak(utterance);
        } catch {
          timerRef.current = setTimeout(handleFinish, Math.max(1500, synthesized.durationSec * 1000));
        }
      } else {
        timerRef.current = setTimeout(handleFinish, Math.max(1500, synthesized.durationSec * 1000));
      }
    })();

    return () => stopNarration();
  }, [
    artifact.id,
    autoAdvance,
    goToSlide,
    isNarrating,
    isOffline,
    scopeKey,
    settings,
    slideIndex,
    slides,
    sourceRevision,
    stopNarration,
  ]);

  if (slides.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
        No slides available in this deck.
      </div>
    );
  }

  const currentSlide = slides[slideIndex];

  return (
    <div
      data-testid="playable-slides-player"
      className="rounded-lg border border-border bg-card p-4 space-y-3 text-xs"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") goToSlide(slideIndex + 1);
        else if (e.key === "ArrowLeft") goToSlide(slideIndex - 1);
      }}
    >
      {/* Top Deck Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <PresentationChart className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
          <span>
            Slide {slideIndex + 1} of {slides.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="slides-cache-status"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[11px]"
          >
            <CloudCheck className="w-3 h-3" aria-hidden="true" />
            {isCachedOffline ? "Cached for offline" : "Ready"}
          </span>
          <button
            type="button"
            disabled={slideIndex === 0}
            onClick={() => goToSlide(slideIndex - 1)}
            aria-label="Previous slide"
            className="inline-flex items-center gap-0.5 px-2 py-1 rounded border border-border disabled:opacity-40 hover:bg-muted"
          >
            <CaretLeft className="w-3.5 h-3.5" aria-hidden="true" />
            Prev
          </button>
          <button
            type="button"
            disabled={slideIndex >= slides.length - 1}
            onClick={() => goToSlide(slideIndex + 1)}
            aria-label="Next slide"
            className="inline-flex items-center gap-0.5 px-2 py-1 rounded border border-border disabled:opacity-40 hover:bg-muted"
          >
            Next
            <CaretRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Deterministic Visual Slide Canvas */}
      <div className="rounded-lg border border-border bg-background p-4 space-y-3">
        {currentSlide.objective && (
          <div className="text-[11px] uppercase tracking-wide font-medium text-primary">
            Objective: {currentSlide.objective}
          </div>
        )}
        <h4 className="text-base font-semibold text-foreground">{currentSlide.title}</h4>

        {/* Structured Explanatory Visual Steps */}
        {currentSlide.bullets.length > 0 && (
          <div className="grid grid-cols-1 gap-2">
            {currentSlide.bullets.map((bullet, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2.5 rounded-md border border-border/70 bg-card/60 px-3 py-2"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary text-[11px] font-semibold shrink-0">
                  {idx + 1}
                </span>
                <span className="leading-relaxed text-foreground">{bullet}</span>
              </div>
            ))}
          </div>
        )}

        {/* Source Citations */}
        {currentSlide.citations.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {currentSlide.citations.map((cit, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onJumpToCitation(cit.quote)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-primary/10 text-primary hover:bg-primary/20"
              >
                <LinkSimple className="w-3 h-3" aria-hidden="true" />
                <span>Source citation {i + 1}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Synchronized Narration Bar */}
      <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setIsNarrating((v) => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90"
          >
            {isNarrating ? (
              <>
                <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                Pause Narration
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" aria-hidden="true" />
                Play Narration
              </>
            )}
          </button>

          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={autoAdvance}
                onChange={(e) => setAutoAdvance(e.target.checked)}
              />
              <span>Auto-advance</span>
            </label>
            <button
              type="button"
              onClick={() => onPracticeSlide(currentSlide.objective || currentSlide.title)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-background hover:bg-muted font-medium"
            >
              <Exam className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
              Check Understanding
            </button>
          </div>
        </div>

        <p className="text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Narration:</strong> {currentSlide.narration}
        </p>
      </div>
    </div>
  );
};
