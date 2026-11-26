import { useCallback, useState } from "react";
import { ArrowClockwise, ChartBar, Check, ShieldWarning, SkipForward, SpeakerHigh, X } from "@phosphor-icons/react";
import { useLanguageProfileStore } from "../../../stores/languageProfileStore";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../utils/cn";
import {
  buildPlacementSession,
  combineProfileEvidenceWithPlacement,
  stepAdaptiveItem,
  type PlacementResult,
  type PlacementSession,
} from "../../../lib/languageAssessment";
import {
  ASSESSMENT_DIMENSIONS,
  type AssessmentDimension,
  type AssessmentItem,
} from "../../../lib/languageAssessment/types";

const DIMENSION_LABEL_KEYS: Record<AssessmentDimension, string> = {
  vocabularyBreadth: "languageLearning.assessment.dimension.vocabularyBreadth",
  grammarMorphology: "languageLearning.assessment.dimension.grammarMorphology",
  readingComprehension: "languageLearning.assessment.dimension.readingComprehension",
  listeningComprehension: "languageLearning.assessment.dimension.listeningComprehension",
  writingProduction: "languageLearning.assessment.dimension.writingProduction",
  speakingPronunciation: "languageLearning.assessment.dimension.speakingPronunciation",
};

const FORMAT_LABEL_KEYS: Record<AssessmentItem["responseFormat"], string> = {
  "multiple-choice": "languageLearning.assessment.format.multipleChoice",
  cloze: "languageLearning.assessment.format.cloze",
  "free-response": "languageLearning.assessment.format.freeResponse",
  "spoken-response": "languageLearning.assessment.format.spokenResponse",
};

/**
 * Honest multi-dimensional placement assessment. It never collapses untested
 * skill dimensions into a single score and always shows the internal
 * non-CEFR disclaimers. Results are in-session only; no certification.
 */
export function LanguageAssessmentPanel() {
  const { t } = useI18n();
  const activeProfile = useLanguageProfileStore((state) => state.activeProfile);

  const [session, setSession] = useState<PlacementSession | null>(null);
  const [result, setResult] = useState<PlacementResult | null>(null);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [textAnswer, setTextAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTranscriptHint, setShowTranscriptHint] = useState(false);

  const profileId = activeProfile?.id ?? null;
  const targetLanguage = activeProfile?.targetLanguage ?? null;

  const startAssessment = useCallback(() => {
    if (!targetLanguage || !profileId) return;
    setError(null);
    try {
      const built = buildPlacementSession({
        targetLanguage,
        profileId,
        includeListening: true,
        includeSpeaking: true,
      });
      setSession(built);
      setResult(null);
      setSelectedOption(null);
      setTextAnswer("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [targetLanguage, profileId]);

  const submitResponse = useCallback(
    (skip: boolean) => {
      if (!session?.currentItem) return;
      const item = session.currentItem;
      setBusy(true);
      setError(null);
      try {
        const response =
          skip
            ? { itemId: item.id, skip: true }
            : item.responseFormat === "multiple-choice" && selectedOption !== null
              ? { itemId: item.id, selectedOptionIndex: selectedOption }
              : { itemId: item.id, textResponse: textAnswer.trim() };
        const step = stepAdaptiveItem(session, response);
        if (step.isComplete) {
          const combined = combineProfileEvidenceWithPlacement({}, step.estimate);
          setSession(step.session);
          setResult({ ...step.estimate, dimensions: combined.dimensions });
        } else {
          setSession(step.session);
          setSelectedOption(null);
          setTextAnswer("");
          setShowTranscriptHint(false);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [session, selectedOption, textAnswer],
  );

  const stopEarly = useCallback(() => {
    if (!session?.currentItem) return;
    setBusy(true);
    try {
      const step = stepAdaptiveItem(session, { itemId: session.currentItem.id, stopEarly: true });
      setSession(step.session);
      setResult(step.estimate);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [session]);

  const answeredCount = session?.history.filter((entry) => !entry.skipped).length ?? 0;
  const currentItem = session?.currentItem ?? null;
  const isRunning = session !== null && result === null;

  if (!profileId || !targetLanguage) {
    return (
      <div className="rounded-xl bg-card p-5 text-sm text-muted-foreground ring-1 ring-inset ring-border">
        {t("languageLearning.assessment.noProfile")}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ChartBar className="h-4 w-4 text-primary" />
          {t("languageLearning.assessment.title")}
        </h3>
        {!isRunning && result ? (
          <button
            type="button"
            onClick={startAssessment}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-4 py-2 text-sm font-medium text-foreground ring-1 ring-inset ring-border hover:bg-surface-container-highest"
          >
            <ArrowClockwise className="h-4 w-4" />
            {t("languageLearning.assessment.restart")}
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <ShieldWarning className="h-4 w-4" />
          {error}
        </div>
      ) : null}

      {!session ? (
        <div className="rounded-xl bg-card p-5 ring-1 ring-inset ring-border">
          <p className="text-sm text-foreground">{t("languageLearning.assessment.intro")}</p>
          <p className="mt-2 text-xs text-muted-foreground">{t("languageLearning.assessment.introDetails")}</p>
          <button
            type="button"
            onClick={startAssessment}
            className="mt-4 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground md-state"
          >
            {t("languageLearning.assessment.start")}
          </button>
        </div>
      ) : null}

      {isRunning && currentItem ? (
        <div className="rounded-xl bg-card p-5 ring-1 ring-inset ring-border">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-secondary-container px-2.5 py-0.5 text-xs font-medium text-on-secondary-container ring-1 ring-inset ring-primary/40">
                {t(DIMENSION_LABEL_KEYS[currentItem.dimension])}
              </span>
              <span className="rounded-full bg-surface-container px-2.5 py-0.5 text-xs text-muted-foreground ring-1 ring-inset ring-border">
                {t(FORMAT_LABEL_KEYS[currentItem.responseFormat])}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {t("languageLearning.assessment.progress", {
                answered: String(answeredCount),
                total: String(session.config.maxItems),
              })}
            </span>
          </div>

          {currentItem.dimension === "listeningComprehension" || currentItem.audioTranscriptHint ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-surface-container-low p-3 ring-1 ring-inset ring-border">
              <button
                type="button"
                onClick={() => {
                  const text = currentItem.audioTranscriptHint ?? currentItem.contextPassage ?? currentItem.prompt;
                  if (typeof window !== "undefined" && window.speechSynthesis && text) {
                    const utterance = new SpeechSynthesisUtterance(text);
                    utterance.lang = targetLanguage;
                    window.speechSynthesis.cancel();
                    window.speechSynthesis.speak(utterance);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container px-3 py-1 text-xs font-medium text-on-secondary-container ring-1 ring-inset ring-primary/40 md-state"
              >
                <SpeakerHigh className="h-3.5 w-3.5" />
                Play audio stimulus
              </button>
              {currentItem.audioTranscriptHint ? (
                <button
                  type="button"
                  onClick={() => setShowTranscriptHint((prev) => !prev)}
                  className="rounded-full bg-surface-container px-3 py-1 text-xs text-foreground ring-1 ring-inset ring-border hover:bg-surface-container-highest"
                >
                  {showTranscriptHint ? "Hide transcript hint" : "Show transcript hint"}
                </button>
              ) : null}
              {showTranscriptHint && currentItem.audioTranscriptHint ? (
                <p className="w-full text-xs text-foreground">{currentItem.audioTranscriptHint}</p>
              ) : null}
            </div>
          ) : null}

          {currentItem.contextPassage ? (
            <p className="mt-4 rounded-lg bg-surface-container-low p-3 text-sm leading-relaxed text-foreground ring-1 ring-inset ring-border">
              {currentItem.contextPassage}
            </p>
          ) : null}

          <p className="mt-4 text-sm text-foreground">{currentItem.prompt}</p>

          {currentItem.rubricHint ? (
            <p className="mt-2 text-xs text-muted-foreground">{currentItem.rubricHint}</p>
          ) : null}

          {currentItem.responseFormat === "multiple-choice" && currentItem.options ? (
            <div className="mt-3 space-y-2">
              {currentItem.options.map((option, index) => (
                <button
                  key={index}
                  type="button"
                  aria-pressed={selectedOption === index}
                  onClick={() => setSelectedOption(index)}
                  className={cn(
                    "block w-full rounded-lg px-3 py-2.5 text-left text-sm ring-1 ring-inset transition-colors",
                    selectedOption === index
                      ? "bg-secondary-container text-on-secondary-container ring-primary/40"
                      : "bg-surface-container-low text-foreground ring-border hover:bg-surface-container",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          ) : (
            <textarea
              value={textAnswer}
              onChange={(event) => setTextAnswer(event.target.value)}
              rows={3}
              placeholder={t("languageLearning.assessment.answerPlaceholder")}
              className="mt-3 w-full rounded-lg bg-surface-container-low p-3 text-sm text-foreground ring-1 ring-inset ring-border placeholder:text-muted-foreground md-focus-ring focus-visible:ring-primary"
            />
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => submitResponse(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-4 py-2 text-sm font-medium text-foreground ring-1 ring-inset ring-border hover:bg-surface-container-highest disabled:opacity-40"
            >
              <SkipForward className="h-4 w-4" />
              {t("languageLearning.assessment.skip")}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={stopEarly}
                className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-4 py-2 text-sm font-medium text-foreground ring-1 ring-inset ring-border hover:bg-surface-container-highest disabled:opacity-40"
              >
                <X className="h-4 w-4" />
                {t("languageLearning.assessment.finishEarly")}
              </button>
              <button
                type="button"
                disabled={busy || (currentItem.responseFormat === "multiple-choice" && selectedOption === null) || (currentItem.responseFormat !== "multiple-choice" && !textAnswer.trim())}
                onClick={() => submitResponse(false)}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground md-state md-focus-ring disabled:opacity-40"
              >
                <Check className="h-4 w-4" />
                {t("languageLearning.assessment.submit")}
              </button>
            </div>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{session.disclaimer}</p>
        </div>
      ) : null}

      {result ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {ASSESSMENT_DIMENSIONS.map((dimension) => {
              const estimate = result.dimensions[dimension];
              const statusKey =
                estimate.status === "calibrated"
                  ? "languageLearning.assessment.status.calibrated"
                  : estimate.status === "insufficient-evidence"
                    ? "languageLearning.assessment.status.insufficient"
                    : "languageLearning.assessment.status.unavailable";
              return (
                <div key={dimension} className="rounded-xl bg-card p-4 ring-1 ring-inset ring-border">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">{t(DIMENSION_LABEL_KEYS[dimension])}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                        estimate.status === "calibrated"
                          ? "bg-secondary-container text-on-secondary-container ring-primary/40"
                          : estimate.status === "insufficient-evidence"
                            ? "bg-warning/15 text-foreground ring-warning/40"
                            : "bg-surface-container text-muted-foreground ring-border",
                      )}
                    >
                      {t(statusKey)}
                    </span>
                  </div>
                  {estimate.available && estimate.estimatedLevel ? (
                    <>
                      <div className="mt-2 text-2xl font-semibold text-foreground">{estimate.estimatedLevel}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t("languageLearning.assessment.range", {
                          low: estimate.confidenceInterval.minBand ?? "?",
                          high: estimate.confidenceInterval.maxBand ?? "?",
                        })}
                      </div>
                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                        <div>{t("languageLearning.assessment.score", { score: String(Math.round(estimate.numericScore ?? 0)) })}</div>
                        <div>{t("languageLearning.assessment.confidence", { value: String(Math.round(estimate.confidenceScore * 100)) })}</div>
                        <div>{t("languageLearning.assessment.samples", { count: String(estimate.sampleCount) })}</div>
                      </div>
                    </>
                  ) : (
                    <div className="mt-2 text-sm text-muted-foreground">{estimate.calibrationNote}</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-card p-3 ring-1 ring-inset ring-border">
            <ShieldWarning className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground">{result.disclaimer}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
