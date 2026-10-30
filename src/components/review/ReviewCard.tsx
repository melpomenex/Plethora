import React, { useEffect, useMemo, useState } from "react";
import { LearningItem } from "../../api/review";
import {
  Brain,
  Eye,
  Lightbulb,
  Pause,
  Pencil,
  Play,
  Sparkle,
  SpeakerHigh,
  SpeakerSlash,
  TextT,
} from "@phosphor-icons/react";
import { generateReviewHint, explainCard } from "../../lib/ai/flashcardStudioAI";
import { useTTS } from "../../hooks/useTTS";
import { renderAnkiHtmlWithLatex, warmAnkiLatexNormalization } from "../../utils/ankiLatex";
import { getImageAssetById } from "../../api/image-registry";
import {
  getSafeCardPromptSummary,
  getSafeCardSpeechText,
  isClozeCardType,
  hasRawClozeSyntax,
  normalizeClozeSyntax,
} from "../../utils/cloze";
import { isOcclusionCard } from "../../utils/occlusion";
import { cn } from "../../utils";
import { CardSourceContext } from "./CardSourceContext";
import { AssessmentPanel, FreeResponseInput } from "./AssessmentPanel";
import { ReviewCardContent } from "./ReviewCardContent";
import type { AnswerAssessment } from "../../lib/ai/schemas/answerAssessment";
import { useI18n } from "../../lib/i18n";
import { CompactTagEditor } from "../common/CompactTagEditor";
import type {
  ImageOcclusionRegion,
  LearningItemInteractionMetadata,
  MultipleChoiceOption,
} from "../../types/learningItemInteractions";

interface ReviewCardProps {
  card: LearningItem;
  showAnswer: boolean;
  onShowAnswer: () => void;
  onInteractionResultChange?: (result: {
    interactionType: "multiple-choice" | "image-occlusion";
    correct?: boolean;
    selectedOptionId?: string;
    selectedOptionText?: string;
  } | null) => void;
  /** Opens the inline card editor for this card (edit-during-review). */
  onEdit?: () => void;
  /** Disables the edit affordance (e.g. while a rating submission is in flight). */
  editDisabled?: boolean;
  /**
   * Free-response assessment (Phase 4, `aiAnswerAssessment`): state is owned
   * by the session (`useCardAnswerAssessment`) because the question/answer
   * branches remount this component on reveal. Both props stay undefined
   * when the feature is off — zero extra DOM.
   */
  freeResponse?: { value: string; onChange: (value: string) => void };
  assessmentPanel?: {
    assessment: AnswerAssessment | null;
    error: string | null;
    pending: boolean;
  };
}

export const ReviewCard = React.memo(function ReviewCard({
  card,
  showAnswer,
  onShowAnswer,
  onInteractionResultChange,
  onEdit,
  editDisabled,
  freeResponse,
  assessmentPanel,
}: ReviewCardProps) {
  const { speak, stop, isSpeaking, isPaused, pause, resume, isSupported } = useTTS();
  const { t } = useI18n();
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [revealAllSiblings, setRevealAllSiblings] = useState(false);

  useEffect(() => {
    warmAnkiLatexNormalization([card.question, card.answer, card.cloze_text]);
  }, [card.question, card.answer, card.cloze_text]);

  useEffect(() => {
    setRevealAllSiblings(false);
  }, [card.id]);

  useEffect(() => {
    setSelectedChoiceId(null);
    onInteractionResultChange?.(null);
  }, [card.id, onInteractionResultChange]);

  // Helper to get item type - handles both snake_case and camelCase from different backends
  const getItemType = (): string => {
    const item = card as any;
    return item.item_type || item.itemType || "flashcard";
  };

  const getItemIcon = (itemType: string) => {
    switch (itemType?.toLowerCase()) {
      case "cloze":
        return "📝";
      case "qa":
        return "❓";
      case "flashcard":
        return "🎴";
      default:
        return "📚";
    }
  };

  const getItemTypeLabel = (itemType: string) => {
    switch (itemType?.toLowerCase()) {
      case "cloze":
        return "Cloze Deletion";
      case "qa":
        return "Question & Answer";
      case "flashcard":
        return "Flashcard";
      default:
        return "Learning Item";
    }
  };

  const itemType = getItemType();

  const getPlainText = (html: string): string => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body.textContent || "";
  };

  const handleSpeak = (text: string) => {
    if (isSpeaking) {
      if (isPaused) {
        resume();
      } else {
        pause();
      }
    } else {
      speak(text);
    }
  };

  const handleStop = () => {
    stop();
  };

  const safeQuestionSpeech = useMemo(() => getSafeCardSpeechText(card, "question"), [card]);
  const safeAnswerSpeech = useMemo(() => getSafeCardSpeechText(card, "answer"), [card]);
  const interactionMetadata = (
    (card as any)?.interaction_metadata ?? (card as any)?.interactionMetadata ?? {}
  ) as LearningItemInteractionMetadata;
  const audioQuestionUrl = interactionMetadata?.audioQuestionUrl || interactionMetadata?.audio_question_url;
  const audioAnswerUrl = interactionMetadata?.audioAnswerUrl || interactionMetadata?.audio_answer_url;

  const multipleChoiceOptions = useMemo(() => {
    const raw = interactionMetadata.multipleChoiceOptions;
    if (!Array.isArray(raw) || raw.length === 0) return [];

    return raw.map((entry, index): Required<Pick<MultipleChoiceOption, "text">> & MultipleChoiceOption => {
      if (typeof entry === "string") {
        return {
          id: `choice-${index + 1}`,
          text: entry,
          isCorrect: interactionMetadata.multipleChoiceCorrectOptionId === `choice-${index + 1}`,
        };
      }
      const id = entry.id || `choice-${index + 1}`;
      return {
        ...entry,
        id,
        text: entry.text,
        isCorrect:
          entry.isCorrect ??
          (interactionMetadata.multipleChoiceCorrectOptionId
            ? interactionMetadata.multipleChoiceCorrectOptionId === id
            : false),
      };
    });
  }, [interactionMetadata]);

  const isMultipleChoiceCard = multipleChoiceOptions.length > 0;
  const isImageOcclusionCard = isOcclusionCard(card);

  useEffect(() => {
    if (isImageOcclusionCard) {
      onInteractionResultChange?.({ interactionType: "image-occlusion" });
    }
  }, [isImageOcclusionCard, onInteractionResultChange]);

  const handleSelectChoice = (option: Required<Pick<MultipleChoiceOption, "text">> & MultipleChoiceOption) => {
    setSelectedChoiceId(option.id || null);
    onInteractionResultChange?.({
      interactionType: "multiple-choice",
      correct: Boolean(option.isCorrect),
      selectedOptionId: option.id,
      selectedOptionText: option.text,
    });
    if (!showAnswer) {
      onShowAnswer();
    }
  };

  const renderMultipleChoice = () => {
    if (!isMultipleChoiceCard) return null;

    return (
      <div className="mt-5 space-y-3">
        <div className="text-sm uppercase tracking-wide text-foreground/80 font-medium">
          {t("review.chooseAnswer")}
        </div>
        <div className="grid gap-3">
          {multipleChoiceOptions.map((option) => {
            const isSelected = selectedChoiceId === option.id;
            const isCorrect = Boolean(option.isCorrect);
            const tone = showAnswer
              ? isCorrect
                ? "border-green-500/60 bg-green-500/10 text-foreground"
                : isSelected
                ? "border-red-500/60 bg-red-500/10 text-foreground"
                : "border-border bg-background text-foreground"
              : isSelected
              ? "border-blue-500/60 bg-blue-500/10 text-foreground"
              : "border-border bg-background text-foreground hover:bg-muted";

            return (
              <button
                key={option.id}
                type="button"
                disabled={showAnswer}
                onClick={() => handleSelectChoice(option)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${tone}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm md:text-base">{option.text}</span>
                  {showAnswer && isCorrect && (
                    <span className="text-xs font-semibold text-green-600 dark:text-green-400">
                      {t("review.correctChoice")}
                    </span>
                  )}
                </div>
                {showAnswer && isSelected && option.feedback && (
                  <div className="mt-2 text-xs text-muted-foreground">{option.feedback}</div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderAnswer = () => {
    if (!showAnswer) return null;

    const isCloze = isClozeCardType(card) || Boolean(card.cloze_text) || hasRawClozeSyntax(card.question || "");
    const isOcclusion = isOcclusionCard(card);
    const hasAnswer = Boolean(card.answer && (!isCloze || !card.question?.includes(card.answer)));
    if (!hasAnswer && !isOcclusion && !card.answer) return null;

    return (
      <div className="mt-4 md:mt-6 pt-4 md:pt-6 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs md:text-sm uppercase tracking-wide text-foreground/80 font-medium">
            {t("review.answer")}
          </div>
          {/* TTS Button for Answer */}
          {isSupported && safeAnswerSpeech.speakable && (
            <button
              onClick={() => handleSpeak(safeAnswerSpeech.text)}
              className={`p-2 rounded-lg transition-colors ${
                isSpeaking
                  ? "bg-primary/20 text-primary"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
              title={isSpeaking ? (isPaused ? "Resume" : "Pause") : "Read answer aloud"}
              aria-label={isSpeaking ? (isPaused ? "Resume reading" : "Pause reading") : "Read answer aloud"}
            >
              {isSpeaking ? (
                isPaused ? (
                  <Play className="w-4 h-4" />
                ) : (
                  <Pause className="w-4 h-4" />
                )
              ) : (
                <SpeakerHigh className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
        <ReviewCardContent card={card} showAnswer={showAnswer} part="answer" variant="review" />
        {isMultipleChoiceCard && interactionMetadata.multipleChoiceExplanation && (
          <div className="mt-3 text-sm text-muted-foreground">
            {interactionMetadata.multipleChoiceExplanation}
          </div>
        )}
        {audioAnswerUrl && (
          <div className="mt-3">
            <audio controls preload="none" src={audioAnswerUrl} className="w-full" />
          </div>
        )}
      </div>
    );
  };

  const [hint, setHint] = useState<string | null>(null);
  const [isHintLoading, setIsHintLoading] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [isExplainLoading, setIsExplainLoading] = useState(false);

  useEffect(() => {
    setHint(null);
    setExplanation(null);
    setIsHintLoading(false);
    setIsExplainLoading(false);
  }, [card.id]);

  const handleRequestHint = async () => {
    if (isHintLoading || hint) return;
    setIsHintLoading(true);
    try {
      const promptSummary = getSafeCardPromptSummary(card, { revealed: false });
      const res = await generateReviewHint({
        question: promptSummary,
        answer: card.answer ? getSafeCardPromptSummary(card, { revealed: true }) : "",
        cloze_text: card.cloze_text ?? undefined,
        card_type: itemType,
      });
      setHint(res.hint);
    } catch {
      setHint("Think carefully about the key terms in the question.");
    } finally {
      setIsHintLoading(false);
    }
  };

  const handleExplainCard = async () => {
    if (isExplainLoading || explanation) return;
    setIsExplainLoading(true);
    try {
      const promptSummary = getSafeCardPromptSummary(card, { revealed: false });
      const res = await explainCard({
        question: promptSummary,
        answer: card.answer || safeAnswerSpeech.text || "",
        cloze_text: card.cloze_text ?? undefined,
        card_type: itemType,
      });
      setExplanation(res.explanation || "This answer directly aligns with the core concept of the question.");
    } catch (err) {
      console.error("[ReviewCard] Explain card error:", err);
      setExplanation("Could not generate card explanation at this moment.");
    } finally {
      setIsExplainLoading(false);
    }
  };

  return (
    <article className="w-full min-w-0 max-w-2xl mx-auto px-2 md:px-0" aria-label={`${getItemTypeLabel(itemType)} card`}>
      {/* Card Type Badge */}
      <div className="flex items-center gap-2 mb-3 md:mb-4">
        <span className="text-xl md:text-2xl" aria-hidden="true">{getItemIcon(itemType)}</span>
        <span className="text-xs md:text-sm uppercase tracking-wide text-foreground/80 font-medium">
          {getItemTypeLabel(itemType)}
        </span>
        {(card.tags?.length ?? 0) > 0 && (
          <CompactTagEditor
            target={{ type: "learning-item", id: card.id, tags: card.tags ?? [] }}
            previewLimit={2}
          />
        )}
        <div className="ml-auto flex items-center gap-1">
          {onEdit && (
            <button
              onClick={onEdit}
              disabled={editDisabled}
              data-testid="review-card-edit"
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={t("reviewSession.editCardLabel")}
              aria-label={t("reviewSession.editCardLabel")}
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          {/* TTS Controls for Question */}
          {isSupported && (
            <>
              {isSpeaking && (
                <button
                  onClick={handleStop}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  title="Stop reading"
                  aria-label="Stop reading"
                >
                  <SpeakerSlash className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => handleSpeak(safeQuestionSpeech.text)}
                disabled={!safeQuestionSpeech.speakable}
                className={`p-1.5 rounded-lg transition-colors ${
                  isSpeaking && !isPaused
                    ? "bg-primary/20 text-primary"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
                title={isSpeaking ? (isPaused ? "Pause" : "Pause") : "Read question aloud"}
                aria-label={isSpeaking ? (isPaused ? "Resume reading" : "Pause reading") : "Read question aloud"}
              >
                {isSpeaking ? (
                  isPaused ? (
                    <Play className="w-4 h-4" />
                  ) : (
                    <Pause className="w-4 h-4" />
                  )
                ) : (
                  <SpeakerHigh className="w-4 h-4" />
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Card Content with Animation */}
      <div className="min-w-0 max-w-full bg-card border border-border rounded-lg p-6 shadow-sm transition-all duration-300">
        {/* Question */}
        <div className="mb-2">
          <div className="text-sm uppercase tracking-wide text-foreground/80 mb-3 font-medium">
            {(itemType === "cloze" || itemType === "Cloze")
              ? t("review.completeSentence")
              : t("review.question")}
          </div>
          <ReviewCardContent
            card={card}
            showAnswer={showAnswer}
            part="question"
            revealAllSiblings={revealAllSiblings}
            onToggleRevealAllSiblings={() => setRevealAllSiblings((prev) => !prev)}
            variant="review"
          />
          {renderMultipleChoice()}
          {audioQuestionUrl && (
            <div className="mt-3">
              <audio controls preload="none" src={audioQuestionUrl} className="w-full" />
            </div>
          )}

          {/* AI Hint UI */}
          {!showAnswer && (
            <div className="mt-4 pt-3 border-t border-border/60">
              {hint ? (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground animate-in fade-in duration-200">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1">
                    <Lightbulb className="w-4 h-4" />
                    On-Device AI Hint
                  </div>
                  <p>{hint}</p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleRequestHint()}
                  disabled={isHintLoading}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline disabled:opacity-50"
                >
                  <Lightbulb className="w-4 h-4" />
                  {isHintLoading ? "Generating Hint..." : "Request AI Hint"}
                </button>
              )}
            </div>
          )}

          {/* Source context (collapsible provenance) */}
          <CardSourceContext itemId={card.id} />

          {/* Optional free-response capture before reveal (Phase 4; the
              session only passes `freeResponse` when the flag is on, a
              provider exists, and the card is not an interaction type). */}
          {freeResponse && !showAnswer && (
            <FreeResponseInput value={freeResponse.value} onChange={freeResponse.onChange} />
          )}
        </div>

        {/* Answer (shown when revealed) with fade-in animation */}
        {showAnswer && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
            {renderAnswer()}

            {/* Structured assessment beside the revealed answer (Phase 4) */}
            {assessmentPanel &&
              (assessmentPanel.assessment ||
                assessmentPanel.pending ||
                assessmentPanel.error) && (
                <AssessmentPanel
                  assessment={assessmentPanel.assessment}
                  error={assessmentPanel.error}
                  pending={assessmentPanel.pending}
                />
              )}

            {/* AI Explanation UI */}
            <div className="mt-4 pt-3 border-t border-border/60">
              {explanation ? (
                <div className="rounded-xl border border-blue-500/40 bg-blue-500/10 p-3 text-sm text-foreground animate-in fade-in duration-200">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-1">
                    <Sparkle className="w-4 h-4 text-blue-500" />
                    AI Card Explanation
                  </div>
                  <p>{explanation}</p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleExplainCard()}
                  disabled={isExplainLoading}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                >
                  <Sparkle className="w-4 h-4" />
                  {isExplainLoading ? "Generating Explanation..." : "Explain Card with AI"}
                </button>
              )}
            </div>

            {/* Card Stats */}
            <div className="mt-6 pt-4 border-t border-border">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1">
                    <Brain className="w-4 h-4" />
                    <span>Reviewed {card.review_count}x</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <TextT className="w-4 h-4" />
                    <span>Interval: {card.interval}d</span>
                  </div>
                </div>
                {card.state === "new" && (
                  <span className="px-2 py-0.5 bg-blue-500/10 text-blue-500 rounded text-xs">
                    New
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Show Answer Button */}
      {!showAnswer && (
        <div className="mt-6 flex justify-center">
          <button
            data-showcase-action="reveal-answer"
            onClick={onShowAnswer}
            className="md-state px-8 py-3 min-h-[52px] bg-primary text-on-primary rounded-full transition-all hover:shadow-lg active:scale-[0.98] font-medium text-lg shadow-md focus-visible:ring-4 focus-visible:ring-primary/40 focus-visible:outline-none"
            aria-label="Show answer"
            autoFocus
          >
            {t("review.showAnswer")}
            <span className="sr-only">Press space to show</span>
          </button>
        </div>
      )}
    </article>
  );
});
