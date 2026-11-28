import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, X } from "@phosphor-icons/react";
import { useLearningGoalsStore } from "../../stores/learningGoalsStore";
import type {
  CreateLearningGoalInput,
  LearningGoal,
  LearningGoalKind,
} from "../../types/learningGoal";
import { cn } from "../../utils/cn";

export interface LearningGoalWizardModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  onCreated?: (goal: LearningGoal) => void;
  initialDraft?: Partial<CreateLearningGoalInput>;
}

interface ApproachOption {
  kind: LearningGoalKind;
  label: string;
  description: string;
}

const APPROACH_OPTIONS: readonly ApproachOption[] = [
  {
    kind: "exploration",
    label: "Explore at my own pace",
    description: "Casual, curiosity-driven reading with no deadline pressure.",
  },
  {
    kind: "mastery",
    label: "Master a subject",
    description: "Build deep comprehension and lasting command over a topic.",
  },
  {
    kind: "deadline",
    label: "Prepare for a deadline",
    description: "Work steadily toward an exam, presentation, or target date.",
  },
  {
    kind: "retention",
    label: "Remember what I read",
    description: "Keep key concepts fresh with spaced repetition.",
  },
  {
    kind: "language",
    label: "Learn a language",
    description: "Grow vocabulary, reading fluency, and active recall.",
  },
  {
    kind: "continuous",
    label: "Stay informed",
    description: "Follow ongoing developments and feeds without backlog stress.",
  },
];

const DAILY_MINUTES_PRESETS = [15, 30, 45, 60] as const;

export function LearningGoalWizardModal({
  isOpen: isOpenProp,
  onClose: onCloseProp,
  onCreated,
  initialDraft,
}: LearningGoalWizardModalProps) {
  const storeWizardOpen = useLearningGoalsStore((s) => s.wizard.isOpen);
  const closeStoreWizard = useLearningGoalsStore((s) => s.closeWizard);
  const createGoal = useLearningGoalsStore((s) => s.createGoal);

  const isOpen = isOpenProp ?? storeWizardOpen;
  const handleClose = () => {
    if (onCloseProp) {
      onCloseProp();
    } else {
      closeStoreWizard();
    }
  };

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [title, setTitle] = useState(initialDraft?.title ?? "");
  const [description, setDescription] = useState(initialDraft?.description ?? "");
  const [kind, setKind] = useState<LearningGoalKind>(initialDraft?.kind ?? "exploration");
  const [targetDate, setTargetDate] = useState(initialDraft?.targetDate ?? "");
  const [dailyMinutes, setDailyMinutes] = useState<string>(
    initialDraft?.dailyMinutesBudget ? String(initialDraft.dailyMinutesBudget) : "",
  );
  const [includeDiagnostic, setIncludeDiagnostic] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setTitle(initialDraft?.title ?? "");
    setDescription(initialDraft?.description ?? "");
    setKind(initialDraft?.kind ?? "exploration");
    setTargetDate(initialDraft?.targetDate ?? "");
    setDailyMinutes(
      initialDraft?.dailyMinutesBudget ? String(initialDraft.dailyMinutesBudget) : "",
    );
    setIncludeDiagnostic(false);
    setErrorMessage(null);
    setIsSubmitting(false);
  }, [isOpen, initialDraft]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      titleInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!isOpen) return null;

  const trimmedTitle = title.trim();

  const submitGoal = async (overrideKind?: LearningGoalKind) => {
    if (!trimmedTitle) {
      setErrorMessage("Please enter what you would like to learn.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const parsedMinutes = dailyMinutes.trim() ? Number(dailyMinutes) : null;
      const validMinutes =
        parsedMinutes !== null && Number.isFinite(parsedMinutes) && parsedMinutes > 0
          ? Math.round(parsedMinutes)
          : null;

      const created = await createGoal({
        title: trimmedTitle,
        description: description.trim() || null,
        kind: overrideKind ?? kind,
        targetDate: targetDate.trim() || null,
        dailyMinutesBudget: validMinutes,
        policy: includeDiagnostic ? { optionalDiagnostic: true } : undefined,
      });

      onCreated?.(created);
      handleClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not create learning goal.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="learning-goal-wizard-title"
        className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Step {step} of 3{step === 3 ? " (optional)" : ""}
            </p>
            <h2
              id="learning-goal-wizard-title"
              className="mt-0.5 text-lg font-semibold text-foreground"
            >
              {step === 1
                ? "What would you like to learn?"
                : step === 2
                  ? "How would you like to approach it?"
                  : "Optional schedule & preferences"}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close learning goal dialog"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {errorMessage && (
          <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {errorMessage}
          </p>
        )}

        {/* Step 1: Title (sufficient for casual exploration goal) */}
        {step === 1 && (
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="learning-goal-title-input"
                className="block text-xs font-medium text-foreground"
              >
                Topic or goal title
              </label>
              <input
                ref={titleInputRef}
                id="learning-goal-title-input"
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="e.g., Distributed systems, Japanese reading, Linear algebra"
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="learning-goal-description-input"
                className="block text-xs font-medium text-muted-foreground"
              >
                Short note (optional)
              </label>
              <textarea
                id="learning-goal-description-input"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Why this matters to you, or what you'd like to explore..."
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <button
                type="button"
                disabled={!trimmedTitle || isSubmitting}
                onClick={() => void submitGoal("exploration")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3.5 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Save as casual goal
              </button>

              <button
                type="button"
                disabled={!trimmedTitle || isSubmitting}
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Next
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Approach */}
        {step === 2 && (
          <div className="mt-4 space-y-4">
            <div
              role="radiogroup"
              aria-label="Learning approach"
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              {APPROACH_OPTIONS.map((option) => {
                const selected = kind === option.kind;
                return (
                  <button
                    key={option.kind}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setKind(option.kind)}
                    className={cn(
                      "flex flex-col items-start rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      selected
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-background text-foreground hover:bg-accent",
                    )}
                  >
                    <span className="text-xs font-semibold">{option.label}</span>
                    <span className="mt-1 text-[11px] text-muted-foreground">
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Back
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3.5 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Schedule & options
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void submitGoal()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Create goal
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Optional target date, daily minutes, optional diagnostic */}
        {step === 3 && (
          <div className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="learning-goal-target-date"
                className="block text-xs font-medium text-foreground"
              >
                Target date (optional)
              </label>
              <input
                id="learning-goal-target-date"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3.5 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="learning-goal-daily-minutes"
                className="block text-xs font-medium text-foreground"
              >
                Daily study minutes (optional)
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="learning-goal-daily-minutes"
                  type="number"
                  min={5}
                  max={480}
                  value={dailyMinutes}
                  onChange={(e) => setDailyMinutes(e.target.value)}
                  placeholder="e.g., 30"
                  className="w-28 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                {DAILY_MINUTES_PRESETS.map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setDailyMinutes(String(mins))}
                    className={cn(
                      "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      dailyMinutes === String(mins)
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {mins}m
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 p-3 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={includeDiagnostic}
                onChange={(e) => setIncludeDiagnostic(e.target.checked)}
                className="mt-0.5 rounded border-border text-primary focus:ring-primary"
              />
              <span>
                <span className="block font-medium text-foreground">
                  Offer an optional quick diagnostic later
                </span>
                <span className="text-muted-foreground">
                  Helps skip concepts you already know. Never required.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Back
              </button>

              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void submitGoal()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Create goal
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
