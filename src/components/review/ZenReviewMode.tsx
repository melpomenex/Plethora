/**
 * Zen Review Mode
 *
 * Absolute minimal UI for distraction-free review sessions.
 * Philosophy: Only the card text exists. Everything else is invisible.
 *
 * Features:
 * - No visible buttons, progress bars, or headers
 * - Keyboard grading (1-4 / 0-5 for SM-18/SM-20, Space)
 * - Touch grading after reveal: the same H-pattern 6-grade joystick
 *   (SM-18/SM-20) or 4-direction swipe (FSRS/SM-2) as the regular review
 * - Subtle algorithm metadata (10px monospace, bottom-right)
 * - Context Peek: Hold Alt to see source document context
 * - Instant card transitions (no animations)
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useReviewStore, type ReviewSessionItem } from "../../stores/reviewStore";
import { ReviewRating, formatInterval } from "../../api/review";
import { cn } from "../../utils";
import { renderAnkiHtmlWithLatex } from "../../utils/ankiLatex";
import { parseSm18State, sm18Retrievability } from "../../lib/sm18";
import { parseSm20State, sm20Retrievability } from "../../lib/sm20";
import { useI18n } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { sanitizeHtml } from "../common/RichContentRenderer";
import { normalizeClozeSyntax } from "../../utils/cloze";
import { useFormFactor } from "../../hooks/useFormFactor";
import { useRatingJoystick } from "../../hooks/useRatingJoystick";
import { useSwipeGesture } from "../../hooks/useSwipeGesture";
import { useHapticFeedback } from "../../hooks/useHapticFeedback";
import { RatingJoystick } from "./RatingJoystick";

interface ZenReviewModeProps {
  onExit: () => void;
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
  const isDocument = (item as any).itemType === "document";
  
  if (isDocument) {
    const docItem = item as any;
    return (
      <div className="max-w-3xl mx-auto">
        <div className="text-xs text-muted-foreground/50 mb-4 font-mono tracking-wide">
          {docItem.documentTitle || t("zenReview.documentReview")}
        </div>
        <div className="prose prose-lg dark:prose-invert max-w-none">
          <div 
            className="text-foreground/90 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(docItem.extractContent || docItem.content || "") }}
          />
        </div>
      </div>
    );
  }

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

// Context Peek - shows source context when Alt is held
function ContextPeek({ 
  item,
  isVisible,
  t,
}: { 
  item: ReviewSessionItem | null;
  isVisible: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  if (!item || !isVisible) return null;
  
  const context = (item as any).context || (item as any).extractContext || (item as any).documentContext;
  const title = (item as any).documentTitle || (item as any).sourceTitle || t("zenReview.source");
  
  if (!context) return null;
  
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-8 pointer-events-none">
      <div className="absolute inset-0 bg-background/95 backdrop-blur-sm" />
      <div className="relative max-w-3xl max-h-[70vh] overflow-auto bg-card border border-border/50 rounded-lg p-6 shadow-2xl">
        <div className="text-xs font-mono text-muted-foreground/60 mb-3 uppercase tracking-wider">
          {title}
        </div>
        <div 
          className="prose prose-sm dark:prose-invert text-foreground/80"
          dangerouslySetInnerHTML={{ __html: context }}
        />
        <div className="mt-4 text-xs text-muted-foreground/40 text-center">
          {t("zenReview.releaseAlt")}
        </div>
      </div>
    </div>
  );
}

// Session timer - subtle fade when inactive
function SessionTimer({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const fadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);
  
  // Fade out after inactivity
  useEffect(() => {
    const handleActivity = () => {
      setIsVisible(true);
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
      fadeTimeoutRef.current = setTimeout(() => setIsVisible(false), 3000);
    };
    
    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("keydown", handleActivity);
    fadeTimeoutRef.current = setTimeout(() => setIsVisible(false), 3000);
    
    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current);
    };
  }, []);
  
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  
  return (
    <div 
      className={cn(
        "fixed top-4 left-1/2 -translate-x-1/2 text-xs font-mono text-muted-foreground/30 transition-opacity duration-500",
        !isVisible && "opacity-0"
      )}
    >
      {minutes.toString().padStart(2, "0")}:{seconds.toString().padStart(2, "0")}
    </div>
  );
}

export function ZenReviewMode({ onExit }: ZenReviewModeProps) {
  const { t } = useI18n();
  const {
    currentCard,
    queue,
    isLoading,
    isAnswerShown,
    isSubmitting,
    error,
    currentIndex,
    previewIntervals,
    showAnswer,
    submitRating,
    nextCard,
    sessionStartTime,
  } = useReviewStore();

  const [contextPeekVisible, setContextPeekVisible] = useState(false);
  const [justRated, setJustRated] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettingsStore();

  // Touch grading: SM-18/SM-20 get the 6-grade H-pattern joystick; FSRS/SM-2
  // (and desktop) keep the classic 4-direction swipe. Mirrors ReviewSession.
  const useNativeGrades =
    settings.learning.algorithm === "sm20" || settings.learning.algorithm === "sm18";
  const formFactor = useFormFactor();
  const isTouch = formFactor === "phone" || formFactor === "tablet";
  const useJoystick = useNativeGrades && isTouch;
  const haptic = useHapticFeedback();

  // Keep latest state in refs so the gesture callbacks (registered once)
  // always see current values without re-binding listeners every render.
  const answerShownRef = useRef(isAnswerShown);
  const submittingRef = useRef(isSubmitting);
  // `handleRating` is declared below; initialize to a no-op and patch the ref
  // every render once it exists. The gesture hooks read `.current` at call time.
  const ratingCbRef = useRef<(rating: ReviewRating, grade?: number) => Promise<void>>(
    async () => {},
  );
  answerShownRef.current = isAnswerShown;
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

  const joystick = useRatingJoystick({
    onSelect: (rating, grade) => ratingCbRef.current(rating as ReviewRating, grade),
    enabled: () => answerShownRef.current && !submittingRef.current,
  });
  // The joystick and swipe hooks both attach to the card container; only one
  // is active depending on the algorithm + form factor.
  const gestureRef = useJoystick ? joystick.ref : swipeRef;
  
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
          // Native SM-18/SM-20 0-5 grade scale (mirrors ReviewSession).
          e.preventDefault();
          const grade = Number(key);
          const rating = (grade < 3 ? 1 : grade - 1) as ReviewRating;
          handleRating(rating, grade);
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
  }, [isAnswerShown, currentCard, isSubmitting, justRated, onExit, showAnswer, useNativeGrades]);
  
  const handleRating = useCallback(async (rating: ReviewRating, grade?: number) => {
    if (justRated || isSubmitting) return;

    haptic.click();
    setJustRated(true);
    const beforeId = currentCard?.id;
    await submitRating(rating, grade);
    if (!beforeId) return;

    // `submitRating` already advances the queue; only step again if it didn't
    // (mirrors ReviewSession's guard so we never skip a card).
    const afterId = useReviewStore.getState().currentCard?.id;
    if (afterId === beforeId) {
      nextCard();
    }
    // Instant transition - no animation delay
    setTimeout(() => {
      setJustRated(false);
    }, 50);
  }, [justRated, isSubmitting, submitRating, nextCard, currentCard?.id, haptic]);
  // Keep the gesture-hook ref pointed at the latest rating handler.
  ratingCbRef.current = handleRating;

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-muted-foreground/30 text-sm">{t("zenReview.loading")}</div>
      </div>
    );
  }
  
  if (error) {
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
  const effectiveAlgorithm = currentCardData.algorithm_type || settings.learning.algorithm;
  const isSm18 = effectiveAlgorithm === "sm18";
  const isSm20 = effectiveAlgorithm === "sm20";
  const sm18State = isSm18 ? parseSm18State(currentCardData.algorithm_state) : null;
  const sm20State = isSm20 ? parseSm20State(currentCardData.algorithm_state) : null;
  const metaStability = isSm18 && sm18State
    ? sm18State.stability
    : isSm20 && sm20State
    ? sm20State.stability
    : currentCardData.stability;
  const metaDifficulty = isSm18 && sm18State
    ? sm18State.difficulty
    : isSm20 && sm20State
    ? sm20State.difficulty
    : currentCardData.difficulty;
  const metaRetrievability = isSm18 && sm18State && sm18State.stability > 0
    ? sm18Retrievability(sm18State.stability, sm18State.elapsed)
    : isSm20 && sm20State && sm20State.stability > 0
    ? sm20Retrievability(
        sm20State.stability,
        currentCardData.last_review_date
          ? (Date.now() - new Date(currentCardData.last_review_date).getTime()) / (86400 * 1000)
          : 0
      )
    : currentCardData.retrievability;
  const metaInterval = currentCardData.interval;

  return (
    <div ref={containerRef} className="h-full flex flex-col items-center justify-center p-8 md:p-16 relative">
      {/* Session Timer */}
      {sessionStartTime && <SessionTimer startTime={sessionStartTime} />}

      {/* Card Content */}
      <div
        ref={gestureRef}
        className={cn(
          "w-full flex-1 flex items-center justify-center touch-pan-y",
          justRated && "opacity-0"
        )}
      >
        <ZenCard
          item={currentCard}
          showAnswer={isAnswerShown}
          onShowAnswer={showAnswer}
          t={t}
        />
      </div>

      {/* Subtle hint at bottom — reflects the active grading scheme. The
          touch joystick/swipe show their own hint while active, so this is a
          cue for keyboard/hardware-keyboard users. */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 text-xs text-muted-foreground/20">
        {isAnswerShown ? (
          <span className="tracking-widest">{useNativeGrades ? "0 1 2 3 4 5" : "1 2 3 4"}</span>
        ) : (
          <span className="tracking-wide">Space</span>
        )}
      </div>

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
      <div className="fixed top-4 right-4 flex gap-1">
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

      {/* Touch rating overlay — same H-pattern joystick as the regular
          review; active on touch devices with an SM-18/SM-20 algorithm. */}
      {useJoystick && (
        <RatingJoystick
          activeGrade={joystick.activeGrade}
          knob={joystick.knob}
          base={joystick.base}
          isActive={joystick.isActive}
          previewIntervals={previewIntervals}
        />
      )}
    </div>
  );
}
