/**
 * LearnThisProposalSheet — proposal preview for the "Learn this" action
 * (task 2.4, design D16 / ai-learning-material-generation spec).
 *
 * Shows the structured proposal (importance, knowledge type, concepts, tags,
 * rationale, provenance summary) and the candidate cards with per-card
 * accept/reject toggles, edit-in-place (question/answer/cloze text), a
 * card-type switcher, and Regenerate (re-runs the task and discards the
 * previous proposal). Flagged candidates (ungrounded / duplicate) are
 * presented with a warning and CANNOT be accepted until the user edits them
 * so validation passes. Acceptance goes exclusively through the existing
 * domain services (`acceptLearnThisCandidates`).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowsClockwise, Check, CircleNotch, PencilSimple, Warning } from "@phosphor-icons/react";
import { MobileContextMenuSheet } from "../common/MobileContextMenuSheet";
import { useI18n } from "../../lib/i18n";
import { AIError } from "../../lib/ai/errors";
import {
  runLearnThis,
  checkCandidateGrounding,
  type LearnThisRun,
  type ValidatedLearnCandidate,
} from "../../lib/ai/tasks/definitions/learnThisValidation";
import {
  LEARNING_CARD_TYPES,
  type LearningCardCandidate,
  type LearningCardType,
} from "../../lib/ai/schemas/learningMaterial";
import { acceptLearnThisCandidates } from "./acceptLearnThis";

/** Text card types a candidate may be switched to (occlusion needs Phase 2). */
export const SWITCHABLE_CARD_TYPES = LEARNING_CARD_TYPES.filter(
  (t) => t !== "occlusion-ref"
) as readonly LearningCardType[];

/**
 * Pre-validated candidate for the static-proposal path (Phase 4 "keep this
 * question" promotion): no generation runs; the sheet opens directly in the
 * proposal phase with this candidate pre-accepted.
 */
export interface LearnThisStaticCandidate {
  question: string;
  answer: string;
  /** Defaults to a plain question/answer card. */
  cardType?: LearningCardType;
  conceptKeys?: string[];
  tags?: string[];
}

export interface LearnThisProposalSheetProps {
  open: boolean;
  /** The selected text. */
  text: string;
  /** Passage handed to the model (selection plus surrounding context). */
  passage: string;
  documentId?: string;
  documentTitle?: string;
  sectionHeading?: string;
  /** Existing extract the selection belongs to, when there is one. */
  extractId?: string;
  /** Selection context payload recorded with provenance. */
  selectionContext?: unknown;
  /**
   * Static candidates (recall-question promotion): when set, the sheet skips
   * generation entirely and previews exactly these candidates.
   */
  staticCandidates?: LearnThisStaticCandidate[];
  /** Provenance labels for the static path (no run exists to read them from). */
  staticProvenance?: { provider: string; model?: string; modelClass: string };
  onClose: () => void;
}

interface CandidateRow {
  key: string;
  /** The (possibly edited) candidate under review. */
  candidate: LearningCardCandidate;
  /** Original status from the validation pipeline. */
  validatedStatus: ValidatedLearnCandidate["status"];
  issues: string[];
  /** True once the user edited any text field (clears duplicate flags). */
  edited: boolean;
  accepted: boolean;
  editing: boolean;
}

type Phase = "running" | "proposal" | "error" | "creating" | "done";

function initialRows(validated: LearnThisRun["validated"]): CandidateRow[] {
  return validated.candidates.map((c, index) => ({
    key: `c${index}`,
    candidate: { ...c.candidate },
    validatedStatus: c.status,
    issues: [...c.issues],
    edited: false,
    // Valid candidates start accepted; flagged ones require review first.
    accepted: c.status === "valid",
    editing: false,
  }));
}

/** A flagged row becomes acceptable once an edit made it pass validation. */
function rowAcceptBlocked(row: CandidateRow, passage: string): boolean {
  if (row.validatedStatus === "valid" && !row.edited) return false;
  const grounding = checkCandidateGrounding(row.candidate, passage);
  return !grounding.grounded;
}

export function LearnThisProposalSheet({
  open,
  text,
  passage,
  documentId,
  documentTitle,
  sectionHeading,
  extractId,
  selectionContext,
  staticCandidates,
  staticProvenance,
  onClose,
}: LearnThisProposalSheetProps) {
  const { t } = useI18n();
  const abortRef = useRef<AbortController | null>(null);

  const [phase, setPhase] = useState<Phase>("running");
  const [run, setRun] = useState<LearnThisRun | null>(null);
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createdCount, setCreatedCount] = useState(0);

  const sourcePassage = (passage || text).trim();
  const startedRef = useRef(false);

  /** Static-proposal path: seed rows from pre-validated candidates. */
  const seedStatic = useCallback(
    (candidates: LearnThisStaticCandidate[]) => {
      abortRef.current?.abort();
      setRun(null);
      setError(null);
      if (candidates.length === 0) {
        setRows([]);
        setPhase("error");
        return;
      }
      setRows(
        candidates.map((candidate, index) => ({
          key: `s${index}`,
          candidate: {
            cardType: candidate.cardType ?? "qa",
            concept: candidate.conceptKeys?.[0],
            conceptKeys: candidate.conceptKeys ?? [],
            question: candidate.question,
            answer: candidate.answer,
            tags: candidate.tags,
          },
          validatedStatus: "valid",
          issues: [],
          edited: false,
          accepted: true,
          editing: false,
        }))
      );
      setPhase("proposal");
    },
    []
  );

  const generate = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase("running");
    setRun(null);
    setRows([]);
    setError(null);

    void runLearnThis(
      { passage: sourcePassage, documentTitle, sectionHeading },
      { signal: controller.signal }
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setRun(result);
        setRows(initialRows(result.validated));
        if (result.validated.candidates.length === 0) {
          setError(null);
          setPhase("error");
        } else {
          setPhase("proposal");
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setPhase("error");
        setError(
          err instanceof AIError || err instanceof Error ? err.message : String(err)
        );
      });
  }, [sourcePassage, documentTitle, sectionHeading]);

  // Closing aborts whatever is in flight; a cancelled request never creates
  // anything (spec: "Proposal timeout or failure creates nothing").
  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }

    if (startedRef.current) return;
    startedRef.current = true;

    if (staticCandidates && staticCandidates.length > 0) {
      seedStatic(staticCandidates);
    } else {
      generate();
    }
  }, [open, generate, seedStatic, staticCandidates]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const updateRow = (key: string, patch: Partial<CandidateRow>) =>
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const editCandidate = (key: string, patch: Partial<LearningCardCandidate>) =>
    setRows((prev) =>
      prev.map((row) =>
        row.key === key
          ? { ...row, candidate: { ...row.candidate, ...patch }, edited: true }
          : row
      )
    );

  const acceptedRows = rows.filter((r) => r.accepted && !rowAcceptBlocked(r, sourcePassage));

  const accept = useCallback(() => {
    if (acceptedRows.length === 0) return;
    // Static path has no run; provenance comes from `staticProvenance`.
    if (!run && !staticProvenance) return;
    setPhase("creating");
    void acceptLearnThisCandidates(
      acceptedRows.map((r) => r.candidate),
      {
        documentId,
        extractId,
        provider: run?.run.providerId ?? staticProvenance?.provider ?? "unknown",
        model: run?.run.baseModelName ?? staticProvenance?.model,
        modelClass: run?.run.servedModelClass ?? staticProvenance?.modelClass ?? "full",
        passage: sourcePassage,
        selectionContext,
      }
    )
      .then((result) => {
        setCreatedCount(result.created.length);
        setPhase("done");
      })
      .catch((err) => {
        setPhase("error");
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [run, staticProvenance, acceptedRows, sourcePassage, documentId, extractId, selectionContext]);

  if (!open) return null;

  const proposal = run?.validated.proposal;
  const isStatic = !run && rows.length > 0;

  return (
    <MobileContextMenuSheet
      open={open}
      onClose={onClose}
      variant="content"
      title={t("aiLearning.learnThis")}
    >
      <div data-learn-this-sheet="true" className="max-h-[70vh] overflow-y-auto px-4 pb-4 space-y-3">
        {phase === "running" && (
          <div className="py-8 text-center space-y-3">
            <CircleNotch className="w-6 h-6 animate-spin text-primary mx-auto" aria-hidden="true" />
            <p className="text-[15px] font-medium text-foreground">
              {t("aiLearning.running")}
            </p>
          </div>
        )}

        {phase === "creating" && (
          <div className="py-8 text-center space-y-3">
            <CircleNotch className="w-6 h-6 animate-spin text-primary mx-auto" aria-hidden="true" />
            <p className="text-[15px] font-medium text-foreground">
              {t("aiLearning.creating")}
            </p>
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-3">
            <p className="text-[14px] text-destructive">
              {error ? t("aiLearning.error", { message: error }) : t("aiLearning.empty")}
            </p>
            <div className="flex gap-2">
              <button
                className="flex-1 rounded-lg border border-border px-3 py-2 text-[14px] text-foreground inline-flex items-center justify-center gap-2"
                onClick={generate}
              >
                <ArrowsClockwise className="w-4 h-4" aria-hidden="true" />
                {t("aiLearning.retry")}
              </button>
              <button
                className="flex-1 rounded-lg border border-border px-3 py-2 text-[14px] text-foreground"
                onClick={onClose}
              >
                {t("aiLearning.close")}
              </button>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="space-y-3">
            <p className="text-[15px] text-foreground">
              {t("aiLearning.created", { count: createdCount })}
            </p>
            <button
              className="w-full rounded-lg bg-primary px-3 py-2 text-[15px] text-primary-foreground"
              onClick={onClose}
            >
              {t("aiLearning.close")}
            </button>
          </div>
        )}

        {phase === "proposal" && (proposal || isStatic) && (
          <>
            {/* Proposal header (static promotions carry only provenance) */}
            <div className="space-y-1.5 pt-1">
              {proposal ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {t(`aiLearning.kt.${proposal.knowledgeType}`)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {t("aiLearning.importance")}: {Math.round(proposal.importance * 100)}%
                    </span>
                  </div>
                  {proposal.concepts.length > 0 && (
                    <p className="text-[12px] text-muted-foreground">
                      {t("aiLearning.concepts")}: {proposal.concepts.join(", ")}
                    </p>
                  )}
                  {proposal.prerequisites.length > 0 && (
                    <p className="text-[12px] text-muted-foreground">
                      {t("aiLearning.prerequisites")}: {proposal.prerequisites.join(", ")}
                    </p>
                  )}
                  {proposal.tags.length > 0 && (
                    <p className="text-[12px] text-muted-foreground">
                      {t("aiLearning.tags")}: {proposal.tags.join(", ")}
                    </p>
                  )}
                  <p className="text-[13px] leading-snug text-foreground">{proposal.rationale}</p>
                </>
              ) : (
                <p className="text-[13px] font-medium text-foreground">
                  {t("aiRecall.promotedCardTitle")}
                </p>
              )}
              {(run || staticProvenance) && (
                <p className="text-[11px] text-muted-foreground">
                  {t("aiLearning.provenance", {
                    provider: run?.run.providerId ?? staticProvenance?.provider ?? "unknown",
                    modelClass:
                      run?.run.servedModelClass ?? staticProvenance?.modelClass ?? "full",
                  })}
                </p>
              )}
            </div>

            {/* Candidate cards */}
            <div className="space-y-2" role="list" aria-label={t("aiLearning.cards")}>
              {rows.map((row) => {
                const blocked = rowAcceptBlocked(row, sourcePassage);
                return (
                  <div
                    key={row.key}
                    role="listitem"
                    className={`rounded-lg border p-3 space-y-2 ${
                      row.accepted && !blocked
                        ? "border-primary/60 bg-primary/5"
                        : "border-border bg-background"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={row.accepted && !blocked}
                        disabled={blocked}
                        aria-label={t("aiLearning.acceptCard")}
                        onChange={(e) => updateRow(row.key, { accepted: e.target.checked })}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        {blocked && (
                          <p
                            className="text-[12px] text-amber-600 dark:text-amber-400 inline-flex items-center gap-1"
                            data-status={row.edited ? "edited-ungrounded" : row.validatedStatus}
                          >
                            <Warning className="w-3.5 h-3.5" aria-hidden="true" />
                            {row.validatedStatus === "duplicate" && !row.edited
                              ? t("aiLearning.statusDuplicate")
                              : t("aiLearning.statusUngrounded")}
                          </p>
                        )}
                        {row.editing ? (
                          <div className="space-y-2">
                            <label className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                              {t("aiLearning.cardType")}
                              <select
                                className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[14px] normal-case text-foreground"
                                value={row.candidate.cardType}
                                onChange={(e) =>
                                  editCandidate(row.key, {
                                    cardType: e.target.value as LearningCardType,
                                  })
                                }
                              >
                                {SWITCHABLE_CARD_TYPES.map((type) => (
                                  <option key={type} value={type}>
                                    {t(`aiLearning.ct.${type}`)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                              {t("aiLearning.question")}
                              <textarea
                                rows={2}
                                className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[14px] normal-case text-foreground"
                                value={row.candidate.question}
                                onChange={(e) => editCandidate(row.key, { question: e.target.value })}
                              />
                            </label>
                            <label className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                              {t("aiLearning.answer")}
                              <textarea
                                rows={2}
                                className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[14px] normal-case text-foreground"
                                value={row.candidate.answer}
                                onChange={(e) => editCandidate(row.key, { answer: e.target.value })}
                              />
                            </label>
                            {row.candidate.cardType === "cloze" && (
                              <label className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                                {t("aiLearning.clozeText")}
                                <textarea
                                  rows={2}
                                  className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-[14px] normal-case text-foreground"
                                  value={row.candidate.clozeText ?? row.candidate.question}
                                  onChange={(e) =>
                                    editCandidate(row.key, { clozeText: e.target.value })
                                  }
                                />
                              </label>
                            )}
                          </div>
                        ) : (
                          <>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                              {t(`aiLearning.ct.${row.candidate.cardType}`)}
                            </p>
                            <p className="text-[14px] leading-snug text-foreground">
                              {row.candidate.question}
                            </p>
                            <p className="text-[13px] leading-snug text-muted-foreground">
                              {row.candidate.answer}
                            </p>
                          </>
                        )}
                      </div>
                      <button
                        className="p-1 text-muted-foreground"
                        aria-label={t("aiLearning.edit")}
                        onClick={() => updateRow(row.key, { editing: !row.editing })}
                      >
                        {row.editing ? (
                          <Check className="w-4 h-4" aria-hidden="true" />
                        ) : (
                          <PencilSimple className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer actions (Regenerate needs a passage; static promotions
                only offer accept/close) */}
            <div className="flex gap-2 pt-1">
              {!isStatic && (
                <button
                  className="flex-1 rounded-lg border border-border px-3 py-2 text-[14px] text-foreground inline-flex items-center justify-center gap-2"
                  onClick={generate}
                >
                  <ArrowsClockwise className="w-4 h-4" aria-hidden="true" />
                  {t("aiLearning.regenerate")}
                </button>
              )}
              <button
                className="flex-1 rounded-lg bg-primary px-3 py-2 text-[14px] text-primary-foreground disabled:opacity-50"
                disabled={acceptedRows.length === 0}
                onClick={accept}
              >
                {t("aiLearning.accept", { count: acceptedRows.length })}
              </button>
            </div>
            <button
              className="w-full inline-flex items-center justify-center gap-1 text-[13px] text-muted-foreground"
              onClick={onClose}
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              {t("aiLearning.close")}
            </button>
          </>
        )}
      </div>
    </MobileContextMenuSheet>
  );
}
