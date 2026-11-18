import React, { useEffect, useState } from 'react';
import { CheckCircle, WarningCircle, ArrowCounterClockwise, ArrowRight, BookOpen, X, ArrowsClockwise } from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import { generateFormativeMultipleChoice, submitFormativeCheck } from '../../../api/study-trails';
import type {
  FormativeCheckResult,
  FormativeMultipleChoiceQuestion,
  FormativePromptFormat,
} from '../../../types/studyTrail';
import type { StudyQueueEntry } from '../../../lib/study-plans/trail/queueProjection';

const PROMPT_FORMAT_LABELS: Record<FormativePromptFormat, { label: string; template: (obj: string, concept: string) => string }> = {
  explain_own_words: {
    label: 'Explain in your own words',
    template: (obj, concept) => `In your own words, explain ${concept}: ${obj}`,
  },
  apply_example: {
    label: 'Apply to a new example',
    template: (obj, concept) => `Give a concrete example that illustrates ${concept} (${obj}).`,
  },
  distinguish_concepts: {
    label: 'Distinguish related ideas',
    template: (obj, concept) => `How does ${concept} differ from closely related ideas you encountered? (${obj})`,
  },
  argument_from_premises: {
    label: 'Trace the argument',
    template: (obj, concept) => `Why does the author's conclusion about ${concept} follow from the premises? (${obj})`,
  },
  identify_misconception: {
    label: 'Spot a misconception',
    template: (obj, concept) => `What is a common misunderstanding about ${concept}, and why is it mistaken? (${obj})`,
  },
  source_grounded_short_answer: {
    label: 'Source-grounded synthesis',
    template: (obj) => `Based on the assigned reading, summarize the key reasoning for: ${obj}`,
  },
};

export interface FormativeCheckDrawerProps {
  entry: StudyQueueEntry;
  onClose: () => void;
  onCompleted: (result: FormativeCheckResult) => void;
  onReturnToReading?: () => void;
  onNextAssignment?: () => void;
  nextAssignmentTitle?: string;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

export const FormativeCheckDrawer: React.FC<FormativeCheckDrawerProps> = ({
  entry,
  onClose,
  onCompleted,
  onReturnToReading,
  onNextAssignment,
  nextAssignmentTitle,
}) => {
  const [mode, setMode] = useState<'multiple_choice' | 'written'>('multiple_choice');
  const [format, setFormat] = useState<FormativePromptFormat>('explain_own_words');
  const [mcQuestion, setMcQuestion] = useState<FormativeMultipleChoiceQuestion | null>(null);
  const [loadingQuestion, setLoadingQuestion] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [response, setResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<FormativeCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const writtenPromptText = PROMPT_FORMAT_LABELS[format].template(entry.objectiveText, entry.node.title);

  useEffect(() => {
    if (mode !== 'multiple_choice') return;
    let cancelled = false;
    setLoadingQuestion(true);
    setError(null);
    setSelectedIndex(null);
    setResult(null);

    generateFormativeMultipleChoice({
      planId: entry.item.planId,
      versionId: entry.item.versionId,
      trailItemId: entry.item.id,
      nodeId: entry.node.nodeId,
      objectiveIndex: entry.item.objectiveIndex,
      promptFormat: format,
    })
      .then((q) => {
        if (!cancelled) {
          setMcQuestion(q);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to generate question');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingQuestion(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    mode,
    format,
    reloadNonce,
    entry.item.planId,
    entry.item.versionId,
    entry.item.id,
    entry.node.nodeId,
    entry.item.objectiveIndex,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (mode === 'multiple_choice') {
      if (!mcQuestion || selectedIndex === null) return;
      const chosenOption = mcQuestion.options[selectedIndex] ?? '';
      const isCorrect = selectedIndex === mcQuestion.correctIndex;
      setSubmitting(true);
      setError(null);
      try {
        const res = await submitFormativeCheck({
          planId: entry.item.planId,
          versionId: entry.item.versionId,
          trailItemId: entry.item.id,
          nodeId: entry.node.nodeId,
          objectiveIndex: entry.item.objectiveIndex,
          promptFormat: format,
          promptText: mcQuestion.question,
          learnerResponse: chosenOption,
          isCorrectChoice: isCorrect,
          choiceExplanation: mcQuestion.explanation,
        });
        setResult(res);
        onCompleted(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to submit comprehension check');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!response.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await submitFormativeCheck({
        planId: entry.item.planId,
        versionId: entry.item.versionId,
        trailItemId: entry.item.id,
        nodeId: entry.node.nodeId,
        objectiveIndex: entry.item.objectiveIndex,
        promptFormat: format,
        promptText: writtenPromptText,
        learnerResponse: response.trim(),
      });
      setResult(res);
      onCompleted(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit comprehension check');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-label="Formative comprehension check"
      className="rounded-2xl border border-outline-variant bg-surface-container-low p-4 sm:p-5 space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            Comprehension Check (Formative)
          </span>
          <h3 className="text-base font-semibold text-on-surface mt-0.5">{entry.node.title}</h3>
          <p className="text-xs text-on-surface-variant mt-0.5">{entry.objectiveText}</p>
        </div>
        <Button variant="text" size="iconSm" onClick={onClose} aria-label="Close comprehension check">
          <X size={16} />
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Check format">
          {(Object.keys(PROMPT_FORMAT_LABELS) as FormativePromptFormat[]).map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => {
                setFormat(fmt);
                setResult(null);
              }}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                format === fmt
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {PROMPT_FORMAT_LABELS[fmt].label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setMode((prev) => (prev === 'multiple_choice' ? 'written' : 'multiple_choice'));
            setResult(null);
            setError(null);
          }}
          className="text-xs font-medium text-primary hover:underline"
        >
          {mode === 'multiple_choice' ? 'Write my own answer' : 'Switch to multiple choice'}
        </button>
      </div>

      {mode === 'multiple_choice' ? (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="rounded-xl bg-surface p-3 border border-outline-variant/60">
            {loadingQuestion ? (
              <p className="text-sm text-on-surface-variant">Generating question…</p>
            ) : mcQuestion ? (
              <>
                <p className="text-sm font-medium text-on-surface">{mcQuestion.question}</p>
                {entry.segment && (
                  <p className="text-xs text-on-surface-variant mt-1">
                    Grounded in: {entry.documentTitle} — {entry.segment.title}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-on-surface-variant">Unable to load question.</p>
            )}
          </div>

          {!loadingQuestion && mcQuestion && (
            <div className="space-y-2" role="radiogroup" aria-label="Multiple choice options">
              {mcQuestion.options.map((option, idx) => {
                const isSelected = selectedIndex === idx;
                const isCorrectOption = idx === mcQuestion.correctIndex;
                const showOutcome = result !== null;

                let optionStyle =
                  'border-outline-variant bg-surface hover:border-primary/60 text-on-surface';
                if (showOutcome) {
                  if (isCorrectOption) {
                    optionStyle =
                      'border-emerald-500/60 bg-emerald-500/10 text-on-surface';
                  } else if (isSelected && !isCorrectOption) {
                    optionStyle =
                      'border-amber-500/60 bg-amber-500/10 text-on-surface';
                  } else {
                    optionStyle =
                      'border-outline-variant/60 bg-surface/60 text-on-surface-variant';
                  }
                } else if (isSelected) {
                  optionStyle =
                    'border-primary bg-primary/10 text-on-surface ring-1 ring-primary';
                }

                return (
                  <button
                    key={idx}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={showOutcome || submitting}
                    onClick={() => setSelectedIndex(idx)}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 text-xs sm:text-sm transition-colors flex items-start gap-2.5 ${optionStyle}`}
                  >
                    <span
                      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-semibold shrink-0 mt-0.5 ${
                        isSelected
                          ? 'bg-primary text-on-primary'
                          : 'bg-surface-container-high text-on-surface-variant'
                      }`}
                    >
                      {OPTION_LETTERS[idx] ?? idx + 1}
                    </span>
                    <span className="leading-snug">{option}</span>
                  </button>
                );
              })}
            </div>
          )}

          {error && (
            <p role="alert" className="text-xs text-error">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-on-surface-variant">
              Does not mutate formal exam scores or FSRS items.
            </span>
            <div className="flex items-center gap-2">
              {!loadingQuestion && (
                <Button
                  type="button"
                  variant="text"
                  size="sm"
                  disabled={submitting}
                  onClick={() => setReloadNonce((n) => n + 1)}
                >
                  <ArrowsClockwise size={14} />
                  <span>New Question</span>
                </Button>
              )}
              {!result && (
                <Button
                  type="submit"
                  variant="filled"
                  size="sm"
                  disabled={loadingQuestion || submitting || selectedIndex === null}
                >
                  {submitting ? 'Checking…' : 'Check Answer'}
                </Button>
              )}
            </div>
          </div>
        </form>
      ) : (
        <>
          <div className="rounded-xl bg-surface p-3 border border-outline-variant/60">
            <p className="text-sm font-medium text-on-surface">{writtenPromptText}</p>
            {entry.segment && (
              <p className="text-xs text-on-surface-variant mt-1">
                Grounded in: {entry.documentTitle} — {entry.segment.title}
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              rows={4}
              placeholder="Write your explanation here. This is a low-stakes check and will not affect formal exam grades or flashcards."
              className="w-full rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {error && (
              <p role="alert" className="text-xs text-error">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-on-surface-variant">
                Does not mutate formal exam scores or FSRS items.
              </span>
              <Button type="submit" variant="filled" size="sm" disabled={submitting || !response.trim()}>
                {submitting ? 'Checking…' : 'Check Understanding'}
              </Button>
            </div>
          </form>
        </>
      )}

      {result && (
        <div
          role="status"
          className={`rounded-xl p-3.5 border space-y-2 ${
            result.outcome === 'understood'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-on-surface'
              : 'border-amber-500/30 bg-amber-500/10 text-on-surface'
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            {result.outcome === 'understood' ? (
              <CheckCircle size={18} className="text-emerald-600 dark:text-emerald-400" />
            ) : (
              <WarningCircle size={18} className="text-amber-600 dark:text-amber-400" />
            )}
            <span>
              {result.outcome === 'understood'
                ? 'Understanding confirmed'
                : result.outcome === 'partial'
                  ? 'Partially aligned — review recommended'
                  : 'Needs another look'}
            </span>
          </div>
          <p className="text-xs text-on-surface-variant">{result.feedback}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {onNextAssignment && (
              <Button variant="filled" size="sm" className="max-w-full" onClick={onNextAssignment}>
                <span className="truncate">
                  {nextAssignmentTitle
                    ? `Next: ${nextAssignmentTitle}`
                    : 'Next Assignment'}
                </span>
                <ArrowRight size={14} className="shrink-0" />
              </Button>
            )}
            {result.outcome !== 'understood' && onReturnToReading && (
              <>
                <Button variant="tonal" size="sm" onClick={onReturnToReading}>
                  <BookOpen size={14} />
                  <span>Revisit Assigned Reading</span>
                </Button>
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => {
                    setResult(null);
                    setSelectedIndex(null);
                    setResponse('');
                    if (mode === 'multiple_choice') {
                      setReloadNonce((n) => n + 1);
                    }
                  }}
                >
                  <ArrowCounterClockwise size={14} />
                  <span>Try Another Angle</span>
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
