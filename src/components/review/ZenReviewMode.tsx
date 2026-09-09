/**
 * Zen Review Mode
 *
 * Absolute minimal UI for distraction-free review sessions.
 * Philosophy: Only the card text exists. Everything else is invisible.
 *
 * Features:
 * - No visible buttons, progress bars, or headers
 * - Keyboard grading (1-4 / 0-5 for six-grade schedulers, Space)
 * - Touch grading after reveal: the same H-pattern 6-grade joystick
 *   (six-grade schedulers) or 4-direction swipe (FSRS/Classic) as the regular review
 * - Subtle algorithm metadata (10px monospace, bottom-right)
 * - Context Peek: Hold Alt to see source document context
 * - Instant card transitions (no animations)
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useReviewStore, type ReviewSessionItem } from "../../stores/reviewStore";
import { formatInterval } from "../../api/review";
import { cn } from "../../utils";
import { renderAnkiHtmlWithLatex } from "../../utils/ankiLatex";
import { parseAdaptiveState, adaptiveRetrievability } from "../../lib/adaptiveScheduler";
import { parsePrecisionState, precisionRetrievability } from "../../lib/precisionScheduler";
import { useI18n } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { normalizeSchedulerId } from "../../lib/schedulerIdentity";
import { normalizeClozeSyntax } from "../../utils/cloze";
import { useSwipeGesture } from "../../hooks/useSwipeGesture";
import { useHapticFeedback } from "../../hooks/useHapticFeedback";
import {
  SixGradeRatingControl,
  useIsTouchRating,
} from "./SixGradeRatingControl";
import {
  gradeToRating,
  useRatingSchema,
  type ReviewRating,
  type SixGrade,
} from "../../lib/rating-grades";
import { Trash, X } from "@phosphor-icons/react";
import { AlgorithmArenaDecision } from "./AlgorithmArenaDecision";
import { getCardSourceContext } from "../../api/review";
import { useToast } from "../common/Toast";
import { useTabsStore } from "../../stores/tabsStore";
import { openCardSource } from "../../utils/cardSourceNavigation";

interface ZenReviewModeProps {
  onExit: () => void;
  onRequestDelete: () => void;
  isDeleting?: boolean;
}

// Minimal card display - just the content
function ZenCard({ 
  item, 
  showAnswer,
  onShowAnswer,
  t,
}: { 
  item: ReviewSessionItem; 
  showAnswer: boolean;
  onShowAnswer: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const card = item as any;

  // Render cloze text by parsing [[cN::content]] markers
  const renderQuestion = () => {
    const originalClozeText = card.cloze_text;
    let clozeText = card.cloze_text;
    if (clozeText) {
      clozeText = normalizeClozeSyntax(clozeText);
      clozeText = clozeText.replace(/\{\{c(\d+)::(.+?)(?:::(.+?))?\}\}/g, (match, num, content, hint) => {
        return hint ? `[[c${num}::${content}::${hint}]]` : `[[c${num}::${content}]]`;
      });
    }

    // Range-based cloze rendering (preferred when ranges are available)
    if (originalClozeText && card.cloze_ranges && card.cloze_ranges.length > 0) {
      const text = originalClozeText as string;
      const ranges = card.cloze_ranges as [number, number][];
      let lastIndex = 0;
      const parts: React.ReactNode[] = [];

      ranges.forEach(([start, end], index) => {
        if (start > lastIndex) {
          parts.push(
            <span
              key={`text-${index}`}
              dangerouslySetInnerHTML={{ __html: renderAnkiHtmlWithLatex(text.slice(lastIndex, start)) }}
            />
          );
        }
        const clozeContent = text.slice(start, end);
        if (showAnswer) {
          parts.push(
            <span
              key={`cloze-${index}`}
              className="bg-primary/20 px-1 rounded font-semibold"
              dangerouslySetInnerHTML={{ __html: renderAnkiHtmlWithLatex(clozeContent) }}
            />
          );
        } else {
          parts.push(
            <span key={`cloze-${index}`} className="bg-muted px-2 py-0.5 rounded text-foreground font-bold border border-border/50">
              [...]
            </span>
          );
        }
        lastIndex = end;
      });

      if (lastIndex < text.length) {
        parts.push(
          <span
            key="text-end"
            dangerouslySetInnerHTML={{ __html: renderAnkiHtmlWithLatex(text.slice(lastIndex)) }}
          />
        );
      }

      return (
        <div
          className={cn(
            "prose prose-xl dark:prose-invert max-w-none transition-opacity duration-75",
            showAnswer && "opacity-60"
          )}
        >
          {parts}
        </div>
      );
    }

    // Fallback: regex-based cloze rendering for [[cN::content]] markers
    if (clozeText && /\[\[c\d+::/.test(clozeText)) {
      const parts = clozeText.split(/\[\[c(\d+)::(.*?)\]\]/g);
      return (
        <div
          className={cn(
            "prose prose-xl dark:prose-invert max-w-none transition-opacity duration-75",
            showAnswer && "opacity-60"
          )}
        >
          {parts.map((part: string, idx: number) => {
            if (idx % 3 === 1) return null; // Skip the cloze number
            if (idx % 3 === 2) {
              if (showAnswer) {
                return (
                  <span
                    key={idx}
                    className="bg-primary/20 px-1 rounded font-semibold"
                    dangerouslySetInnerHTML={{ __html: renderAnkiHtmlWithLatex(part) }}
                  />
                );
              }
              return (
                <span key={idx} className="bg-muted px-2 py-0.5 rounded text-foreground font-bold border border-border/50">
                  [...]
                </span>
              );
            }
            return <span key={idx} dangerouslySetInnerHTML={{ __html: renderAnkiHtmlWithLatex(part) }} />;
          })}
        </div>
      );
    }
    return (
      <div
        className={cn(
          "prose prose-xl dark:prose-invert max-w-none transition-opacity duration-75",
          showAnswer && "opacity-60"
        )}
        dangerouslySetInnerHTML={{
          __html: renderAnkiHtmlWithLatex(card.question || card.cloze_text || t("zenReview.noQuestion"))
        }}
      />
    );
  };

  return (
    <div className="max-w-2xl mx-auto text-center">
      {/* Question */}
      {renderQuestion()}
      
      {/* Answer reveal */}
      {!showAnswer ? (
        <button
          onClick={onShowAnswer}
          className="mt-12 text-sm text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors tracking-widest uppercase"
        >
          {t("zenReview.pressSpaceToReveal")}
        </button>
      ) : card.item_type === "Cloze" ? null : (
        <div className="mt-8 pt-8 border-t border-border/20">
          <div 
            className="prose prose-lg dark:prose-invert max-w-none text-foreground/80"
            dangerouslySetInnerHTML={{ 
              __html: renderAnkiHtmlWithLatex(card.answer || t("zenReview.noAnswer")) 
            }}
          />
        </div>
      )}
    </div>
  );
}

// Subtle algorithm metadata display
function AlgorithmMetadata({
  stability,
  difficulty,
  retrievability,
  interval
}: {
  stability?: number;
  difficulty?: number;
  retrievability?: number;
  interval?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!stability && !difficulty && !retrievability) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 text-right select-none"
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      {isExpanded ? (
        <div className="text-[11px] font-mono text-muted-foreground/40 space-y-0.5 bg-background/80 backdrop-blur-sm px-3 py-2 rounded">
          <div>S: {stability?.toFixed(1) || "-"}d</div>
          <div>R: {retrievability ? `${(retrievability * 100).toFixed(0)}%` : "-"}</div>
          <div>D: {difficulty?.toFixed(1) || "-"}</div>
          <div>I: {interval ? formatInterval(interval) : "-"}</div>
        </div>
      ) : (
        <div className="text-[10px] font-mono text-muted-foreground/30">
          S:{stability?.toFixed(0) || "-"}d R:{retrievability ? `${(retrievability * 100).toFixed(0)}` : "-"}%
        </div>
      )}
    </div>
  );
}

// Context Peek - shows source context when Alt is held. Context resolves from
// the card's real provenance (document title + extract snippet via the same
// command the review strip uses) and is rendered as TEXT — source excerpts are
// untrusted content and must never be interpreted as HTML.
function ContextPeek({ 
  item,
  isVisible,
  t,
}: { 
  item: ReviewSessionItem | null;
  isVisible: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const [peek, setPeek] = useState<{ title: string; snippet: string } | null>(null);

  useEffect(() => {
    if (!isVisible || !item) return;
    let cancelled = false;
    setPeek(null);
    getCardSourceContext(item.id)
      .then((context) => {
        if (!cancelled && context) {
          const snippet = context.extract_snippet || context.source_url || "";
          if (snippet) setPeek({ title: context.document_title, snippet });
        }
      })
      .catch(() => {
        // Best-effort: an unresolvable source simply shows nothing.
      });
    return () => {
      cancelled = true;
    };
  }, [isVisible, item]);

  if (!item || !isVisible || !peek) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-8 pointer-events-none">
      <div className="absolute inset-0 bg-background/95 backdrop-blur-sm" />
      <div className="relative max-w-3xl max-h-[70vh] overflow-auto bg-card border border-border/50 rounded-lg p-6 shadow-2xl">
        <div className="text-xs font-mono text-muted-foreground/60 mb-3 uppercase tracking-wider">
          {peek.title}
        </div>
        <div className="prose prose-sm dark:prose-invert text-foreground/80 whitespace-pre-wrap">
          {peek.snippet}
        </div>
        <div className="mt-4 text-xs text-muted-foreground/40 text-center">
          {t("zenReview.releaseAlt")}
        </div>
      </div>
    </div>
  );
}

// Session timer - subtle fade when inactive
function SessionTimer({ startTime, isVisible }: { startTime: number; isVisible: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);
  
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  
  return (
    <div 
      className={cn(
        "fixed top-4 left-1/2 -translate-x-1/2 text-xs font-mono text-muted-foreground/30 transition-all duration-300 pointer-events-none",
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
      )}
    >
      {minutes.toString().padStart(2, "0")}:{seconds.toString().padStart(2, "0")}
    </div>
  );
}

export function ZenReviewMode({ onExit, onRequestDelete, isDeleting = false }: ZenReviewModeProps) {
  const { t } = useI18n();
  const toast = useToast();
  const {
    currentCard,
    queue,
    isLoading,
    isAnswerShown,
    isSubmitting,
    error,
    currentIndex,
    previewIntervals,
    pendingArenaReview,
    showAnswer,
    submitRating,
    sessionStartTime,
    cancelArenaDecision,
  } = useReviewStore(
    // Explicit property selector: a bare useReviewStore() re-renders this
    // component on every unrelated store write (timers, previews, arena state).
    useShallow((state) => ({
      currentCard: state.currentCard,
      queue: state.queue,
      isLoading: state.isLoading,
      isAnswerShown: state.isAnswerShown,
      isSubmitting: state.isSubmitting,
      error: state.error,
      currentIndex: state.currentIndex,
      previewIntervals: state.previewIntervals,
      pendingArenaReview: state.pendingArenaReview,
      showAnswer: state.showAnswer,
      submitRating: state.submitRating,
      sessionStartTime: state.sessionStartTime,
      cancelArenaDecision: state.cancelArenaDecision,
    }))
  );

  const [contextPeekVisible, setContextPeekVisible] = useState(false);
  const [justRated, setJustRated] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettingsStore();

  // Touch grading: six-grade schedulers get the 6-grade H-pattern
  // joystick; four-grade schedulers (and desktop) keep the classic 4-direction
  // swipe. The scale is declared by the shared rating schema.
  const ratingSchema = useRatingSchema();
  const useNativeGrades = ratingSchema.type === "six-grade";
  const isTouch = useIsTouchRating();
  const useJoystick = useNativeGrades && isTouch;
  const haptic = useHapticFeedback();

  // Controls visibility state
  const [areControlsVisible, setAreControlsVisible] = useState(true);
  const fadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetControlsTimeout = useCallback(() => {
    setAreControlsVisible(true);
    if (fadeTimeoutRef.current) {
      clearTimeout(fadeTimeoutRef.current);
    }
    fadeTimeoutRef.current = setTimeout(() => {
      setAreControlsVisible(false);
    }, 3000);
  }, []);

  useEffect(() => {
    const handleActivity = () => {
      resetControlsTimeout();
    };
    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("touchstart", handleActivity, { passive: true });
    
    resetControlsTimeout();
    
    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("touchstart", handleActivity);
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current);
      }
    };
  }, [resetControlsTimeout]);

  // Keep latest state in refs so the gesture callbacks (registered once)
  // always see current values without re-binding listeners every render.
  const answerShownRef = useRef(isAnswerShown);
  const submittingRef = useRef(isSubmitting);
  // `handleRating` is declared below; initialize to a no-op and patch the ref
  // every render once it exists. The gesture hooks read `.current` at call time.
  const ratingCbRef = useRef<(rating: ReviewRating, grade?: number) => Promise<void>>(
    async () => {},
  );
  answerShownRef.current = isAnswerShown && !pendingArenaReview;
  submittingRef.current = isSubmitting;

  const {
    ref: swipeRef,
  } = useSwipeGesture({
    onSwipeLeft: () => answerShownRef.current && !submittingRef.current && ratingCbRef.current(1 as ReviewRating),
    onSwipeRight: () => answerShownRef.current && !submittingRef.current && ratingCbRef.current(4 as ReviewRating),
    onSwipeUp: () => answerShownRef.current && !submittingRef.current && ratingCbRef.current(3 as ReviewRating),
    onSwipeDown: () => answerShownRef.current && !submittingRef.current && ratingCbRef.current(2 as ReviewRating),
    threshold: 80,
    preventDefaultTouch: true,
  });

  // The joystick and swipe gestures both attach to the card container; only
  // one is active depending on the algorithm + form factor. The joystick
  // itself is owned by `SixGradeRatingControl` below.
  const joystickAreaRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useJoystick ? joystickAreaRef : swipeRef;
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt key for context peek
      if (e.key === "Alt") {
        e.preventDefault();
        setContextPeekVisible(true);
        return;
      }
      
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      // Allow through when focus has fallen back to <body>/<html> (e.g. after
      // the auto-focused "Show Answer" button unmounts on flip), so rating
      // keys (1-4) still work. Only bail when focus is in another surface.
      const target = e.target as Node | null;
      if (
        target &&
        target !== document.body &&
        target !== document.documentElement &&
        !containerRef.current?.contains(target)
      ) {
        return;
      }
      
      if (pendingArenaReview) {
        if (e.key === "Escape") {
          e.preventDefault();
          cancelArenaDecision();
        }
        return;
      }

      // V: jump to the source passage (same contract as the regular session).
      if (e.key.toLowerCase() === "v" && currentCard) {
        e.preventDefault();
        void openCardSource(currentCard, useTabsStore.getState().addTab, {
          reviewReturn: true,
        }).then((resolution) => {
          if (resolution.status === "coarse" && resolution.reason !== "no-anchor") {
            toast.info(t("review.source.notLocated"));
          } else if (resolution.status === "unavailable") {
            toast.info(t("review.source.unavailable"));
          }
        });
        return;
      }

      if (e.key === "Escape") {
        onExit();
        return;
      }
      
      // Space to show answer
      if (e.key === " " && !isAnswerShown && currentCard) {
        e.preventDefault();
        showAnswer();
        return;
      }
      
      // Rating keys (only when answer shown)
      if (isAnswerShown && currentCard && !isSubmitting && !justRated) {
        const key = e.key;
        if (useNativeGrades && /^[0-5]$/.test(key)) {
          // Native 0-5 grade scale (mirrors ReviewSession).
          e.preventDefault();
          const grade = Number(key) as SixGrade;
          handleRating(gradeToRating(grade), grade);
        } else if (key >= "1" && key <= "4") {
          e.preventDefault();
          const rating = parseInt(key) as ReviewRating;
          handleRating(rating);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        setContextPeekVisible(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isAnswerShown, currentCard, isSubmitting, justRated, onExit, showAnswer, useNativeGrades, pendingArenaReview, cancelArenaDecision, toast, t]);
  
  const handleRating = useCallback(async (rating: ReviewRating, grade?: number) => {
    if (justRated || isSubmitting) return;

    haptic.click();
    setJustRated(true);
    const beforeId = currentCard?.id;
    await submitRating(rating, grade);
    if (!beforeId) return;
    const committedState = useReviewStore.getState();
    if (committedState.pendingArenaReview || committedState.error) {
      setJustRated(false);
      return;
    }
    // Instant transition - no animation delay
    setTimeout(() => {
      setJustRated(false);
    }, 50);
  }, [justRated, isSubmitting, submitRating, currentCard?.id, haptic]);
  // Keep the gesture-hook ref pointed at the latest rating handler.
  ratingCbRef.current = handleRating;

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-muted-foreground/30 text-sm">{t("zenReview.loading")}</div>
      </div>
    );
  }
  
  if (error && !pendingArenaReview) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-muted-foreground mb-4">{t("zenReview.errorWithMessage", { message: error })}</div>
          <button onClick={onExit} className="text-sm text-primary hover:underline">
            {t("zenReview.exit")}
          </button>
        </div>
      </div>
    );
  }
  
  if (queue.length === 0 || !currentCard) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl mb-4 opacity-30">◉</div>
          <div className="text-muted-foreground/50 mb-6">{t("zenReview.sessionComplete")}</div>
          <button 
            onClick={onExit}
            className="text-sm text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
          >
            {t("zenReview.pressEscapeToExit")}
          </button>
        </div>
      </div>
    );
  }
  
  const currentCardData = currentCard as any;

  // Compute algorithm-aware metadata values
  const effectiveAlgorithm = normalizeSchedulerId(
    currentCardData.algorithm_type || settings.learning.algorithm,
  );
  const isAdaptive = effectiveAlgorithm === "adaptive";
  const isPrecision = effectiveAlgorithm === "precision";
  const adaptiveState = isAdaptive ? parseAdaptiveState(currentCardData.algorithm_state) : null;
  const precisionState = isPrecision ? parsePrecisionState(currentCardData.algorithm_state) : null;
  const metaStability = isAdaptive && adaptiveState
    ? adaptiveState.stability
    : isPrecision && precisionState
    ? precisionState.stability
    : currentCardData.stability;
  const metaDifficulty = isAdaptive && adaptiveState
    ? adaptiveState.difficulty
    : isPrecision && precisionState
    ? precisionState.difficulty
    : currentCardData.difficulty;
  const metaRetrievability = isAdaptive && adaptiveState && adaptiveState.stability > 0
    ? adaptiveRetrievability(adaptiveState.stability, adaptiveState.elapsed)
    : isPrecision && precisionState && precisionState.stability > 0
    ? precisionRetrievability(
        precisionState.stability,
        currentCardData.last_review_date
          ? (Date.now() - new Date(currentCardData.last_review_date).getTime()) / (86400 * 1000)
          : 0
      )
    : currentCardData.retrievability;
  const metaInterval = currentCardData.interval;

  return (
    <div ref={containerRef} className="h-full flex flex-col items-center justify-center p-8 md:p-16 relative">
      {/* Exit Button */}
      <button
        onClick={onExit}
        className={cn(
          "fixed top-4 left-4 z-50 p-2 rounded-full border border-border/30 bg-background/60 hover:bg-muted/80 backdrop-blur-sm text-muted-foreground/60 hover:text-foreground transition-all duration-300 min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer",
          areControlsVisible ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
        )}
        title={t("zenReview.exit")}
      >
        <X className="w-5 h-5" />
      </button>

      <button
        onClick={onRequestDelete}
        disabled={isDeleting || Boolean(pendingArenaReview)}
        className={cn(
          "fixed top-4 right-4 z-50 p-2 rounded-full border border-destructive/30 bg-background/60 hover:bg-destructive/10 backdrop-blur-sm text-destructive/70 hover:text-destructive transition-all duration-300 min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed",
          areControlsVisible ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
        )}
        title={t("learningCards.deleteCard")}
        aria-label={t("learningCards.deleteCard")}
      >
        <Trash className="w-5 h-5" />
      </button>

      {/* Session Timer */}
      {sessionStartTime && <SessionTimer startTime={sessionStartTime} isVisible={areControlsVisible} />}

      {/* Card Content */}
      <div
        ref={gestureRef}
        className={cn(
          "w-full min-h-0 flex-1 flex items-center justify-center touch-pan-y",
          justRated && !pendingArenaReview && "opacity-0"
        )}
      >
        {pendingArenaReview ? (
          <div className="flex h-full min-h-0 w-full flex-col overflow-hidden py-12">
            <AlgorithmArenaDecision compact />
          </div>
        ) : (
          <ZenCard
            item={currentCard}
            showAnswer={isAnswerShown}
            onShowAnswer={showAnswer}
            t={t}
          />
        )}
      </div>

      {/* Subtle hint at bottom — reflects the active grading scheme. The
          touch joystick/swipe show their own hint while active, so this is a
          cue for keyboard/hardware-keyboard users. */}
      {!pendingArenaReview && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 text-xs text-muted-foreground/20">
        {isAnswerShown ? (
          <span className="tracking-widest">{useNativeGrades ? "0 1 2 3 4 5" : "1 2 3 4"}</span>
        ) : (
          <span className="tracking-wide">Space</span>
        )}
      </div>}

      {/* Algorithm Metadata */}
      <AlgorithmMetadata
        stability={metaStability}
        difficulty={metaDifficulty}
        retrievability={metaRetrievability}
        interval={metaInterval}
      />
      
      {/* Context Peek Overlay */}
      <ContextPeek 
        item={currentCard} 
        isVisible={contextPeekVisible}
        t={t}
      />
      
      {/* Progress indicator - ultra subtle dots */}
      <div 
        className={cn(
          "fixed top-16 right-4 flex gap-1 transition-all duration-300",
          areControlsVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"
        )}
      >
        {queue.slice(0, 20).map((_, i) => (
          <div
            key={i}
            className={cn(
              "w-1 h-1 rounded-full transition-colors duration-75",
              i < currentIndex ? "bg-muted-foreground/20" :
              i === currentIndex ? "bg-muted-foreground/40" :
              "bg-muted-foreground/5"
            )}
          />
        ))}
        {queue.length > 20 && (
          <div className="text-[8px] text-muted-foreground/20 ml-1">
            +{queue.length - 20}
          </div>
        )}
      </div>

      {/* Touch rating overlay — the shared H-pattern joystick control (same
          as the regular review); active on touch devices with a
          six-grade schema. Zen renders no tappable grid (keyboard-only on
          desktop). */}
      {useNativeGrades && (
        <SixGradeRatingControl
          onSelect={(rating, grade) => ratingCbRef.current(rating, grade)}
          enabled={() => answerShownRef.current && !submittingRef.current}
          previewIntervals={previewIntervals}
          touchAreaRef={useJoystick ? joystickAreaRef : undefined}
          showButtons={false}
        />
      )}
    </div>
  );
}
