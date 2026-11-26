import { useCallback, useMemo, useState } from "react";
import { ArrowClockwise, ChartBar, Check, ShieldWarning, SkipForward, X } from "@phosphor-icons/react";
import { useLanguageProfileStore } from "../../../stores/languageProfileStore";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../utils/cn";
import {
  buildPlacementSession,
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
          setSession(step.session);
          setResult(step.estimate);
        } else {
          setSession(step.session);
          setSelectedOption(null);
          setTextAnswer("");
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
      <div className="rounded-xl bg-stone-800/60 p-5 text-sm text-stone-400 ring-1 ring-inset ring-stone-700/60">
        {t("languageLearning.assessment.noProfile")}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-300">
          <ChartBar className="h-4 w-4 text-emerald-400" />
          {t("languageLearning.assessment.title")}
        </h3>
        {!isRunning && result ? (
          <button
            type="button"
            onClick={startAssessment}
            className="inline-flex items-center gap-1.5 rounded-full bg-stone-800 px-4 py-2 text-sm font-medium text-stone-200 ring-1 ring-inset ring-stone-700 hover:bg-stone-700"
          >
            <ArrowClockwise className="h-4 w-4" />
            {t("languageLearning.assessment.restart")}
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="flex items-center gap-2 text-sm text-red-400">
          <ShieldWarning className="h-4 w-4" />
          {error}
        </div>
      ) : null}

      {!session ? (
        <div className="rounded-xl bg-stone-800/60 p-5 ring-1 ring-inset ring-stone-700/60">
          <p className="text-sm text-stone-300">{t("languageLearning.assessment.intro")}</p>
          <p className="mt-2 text-xs text-stone-400">{t("languageLearning.assessment.introDetails")}</p>
          <button
            type="button"
            onClick={startAssessment}
            className="mt-4 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            {t("languageLearning.assessment.start")}
          </button>
        </div>
      ) : null}

      {isRunning && currentItem ? (
        <div className="rounded-xl bg-stone-800/60 p-5 ring-1 ring-inset ring-stone-700/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/40">
                {t(DIMENSION_LABEL_KEYS[currentItem.dimension])}
              </span>
              <span className="rounded-full bg-stone-800 px-2.5 py-0.5 text-xs text-stone-400 ring-1 ring-inset ring-stone-700">
                {t(FORMAT_LABEL_KEYS[currentItem.responseFormat])}
              </span>
            </div>
            <span className="text-xs text-stone-500">
              {t("languageLearning.assessment.progress", {
                answered: String(answeredCount),
                total: String(session.config.maxItems),
              })}
            </span>
          </div>

          {currentItem.contextPassage ? (
            <p className="mt-4 rounded-lg bg-stone-900/60 p-3 text-sm leading-relaxed text-stone-300 ring-1 ring-inset ring-stone-800">
              {currentItem.contextPassage}
            </p>
          ) : null}

          <p className="mt-4 text-sm text-stone-100">{currentItem.prompt}</p>

          {currentItem.responseFormat === "multiple-choice" && currentItem.options ? (
            <div className="mt-3 space-y-2">
              {currentItem.options.map((option, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setSelectedOption(index)}
                  className={cn(
                    "block w-full rounded-lg px-3 py-2.5 text-left text-sm ring-1 ring-inset transition-colors",
                    selectedOption === index
                      ? "bg-emerald-500/15 text-emerald-200 ring-emerald-500/40"
                      : "bg-stone-900/50 text-stone-300 ring-stone-700 hover:bg-stone-800",
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
              className="mt-3 w-full rounded-lg bg-stone-900/60 p-3 text-sm text-stone-100 ring-1 ring-inset ring-stone-700 placeholder:text-stone-500 focus:outline-none focus:ring-emerald-500"
            />
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => submitResponse(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-stone-800 px-4 py-2 text-sm font-medium text-stone-300 ring-1 ring-inset ring-stone-700 hover:bg-stone-700 disabled:opacity-40"
            >
              <SkipForward className="h-4 w-4" />
              {t("languageLearning.assessment.skip")}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={stopEarly}
                className="inline-flex items-center gap-1.5 rounded-full bg-stone-800 px-4 py-2 text-sm font-medium text-stone-300 ring-1 ring-inset ring-stone-700 hover:bg-stone-700 disabled:opacity-40"
              >
                <X className="h-4 w-4" />
                {t("languageLearning.assessment.finishEarly")}
              </button>
              <button
                type="button"
                disabled={busy || (currentItem.responseFormat === "multiple-choice" && selectedOption === null) || (currentItem.responseFormat !== "multiple-choice" && !textAnswer.trim())}
                onClick={() => submitResponse(false)}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
              >
                <Check className="h-4 w-4" />
                {t("languageLearning.assessment.submit")}
              </button>
            </div>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-stone-500">{session.disclaimer}</p>
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
                <div key={dimension} className="rounded-xl bg-stone-800/60 p-4 ring-1 ring-inset ring-stone-700/60">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-stone-400">{t(DIMENSION_LABEL_KEYS[dimension])}</span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                        estimate.status === "calibrated"
                          ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40"
                          : estimate.status === "insufficient-evidence"
                            ? "bg-amber-500/15 text-amber-300 ring-amber-500/40"
                            : "bg-stone-800 text-stone-500 ring-stone-700",
                      )}
                    >
                      {t(statusKey)}
                    </span>
                  </div>
                  {estimate.available && estimate.estimatedLevel ? (
                    <>
                      <div className="mt-2 text-2xl font-semibold text-stone-100">{estimate.estimatedLevel}</div>
                      <div className="mt-1 text-xs text-stone-400">
                        {t("languageLearning.assessment.range", {
                          low: estimate.confidenceInterval.minBand ?? "?",
                          high: estimate.confidenceInterval.maxBand ?? "?",
                        })}
                      </div>
                      <div className="mt-2 space-y-1 text-xs text-stone-500">
                        <div>{t("languageLearning.assessment.score", { score: String(Math.round(estimate.numericScore ?? 0)) })}</div>
                        <div>{t("languageLearning.assessment.confidence", { value: String(Math.round(estimate.confidenceScore * 100)) })}</div>
                        <div>{t("languageLearning.assessment.samples", { count: String(estimate.sampleCount) })}</div>
                      </div>
                    </>
                  ) : (
                    <div className="mt-2 text-sm text-stone-500">{estimate.calibrationNote}</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-stone-800/60 p-3 ring-1 ring-inset ring-stone-700/60">
            <ShieldWarning className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" />
            <p className="text-xs leading-relaxed text-stone-400">{result.disclaimer}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
