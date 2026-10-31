/**
 * Learning Agent proposal review (tasks 2.2/3.2/3.5/3.6).
 *
 * This is NOT a second chat. It renders inside the existing Assistant turn as
 * the agent's review artifact:
 *
 *  - progress/partial-result explanation (run progress itself is owned by the
 *    panel's throttled event stream and Stop button);
 *  - proposals grouped by their actual source document (never the currently
 *    visible document);
 *  - existing editable candidate semantics (question/answer/cloze/type),
 *    duplicate + grounding status, and the 8-cards/2-per-concept preview caps;
 *  - explicit per-row acceptance; only selected rows are saved, one source
 *    group at a time, with retry-safe ids;
 *  - non-card kinds route to their existing approval destinations: the
 *    extract editor, a visible tag confirmation, and the occlusion composer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowSquareOut,
  Check,
  CircleNotch,
  PencilSimple,
  Warning,
} from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { SWITCHABLE_CARD_TYPES } from "../learn/LearnThisProposalSheet";
import { CreateExtractDialog } from "../extracts/CreateExtractDialog";
import { updateLearningItemTags } from "../../api/learning-items";
import type { LearningCardType } from "../../lib/ai/schemas/learningMaterial";
import type {
  AgentProposal,
  AgentExtractProposal,
  AgentTagProposal,
  AgentOcclusionProposal,
} from "../../lib/ai/agent/tools/types";
import type {
  AgentDraftArtifact,
  SourceReference,
  SelectionSnapshot,
} from "../../lib/ai/assistant/conversations/types";
import { recordLearningAgentStage } from "../../lib/ai/assistant/learningAgent";
import {
  buildAgentDraftArtifact,
  buildAgentProposalGroups,
  repairAgentProvenance,
  revalidateRestoredProposalSources,
  saveAgentProposals,
  validateAgentCardReview,
  validateAgentProposalGroups,
  AGENT_PREVIEW_MAX_CARDS_PER_CONCEPT,
  AGENT_PREVIEW_MAX_CARDS_PER_SOURCE,
  type AgentAcceptanceResult,
  type AgentCardReview,
  type AgentProposalGroup,
  type AgentSimpleProposalReview,
} from "../../lib/ai/assistant/learningAgentAcceptance";

export interface LearningAgentRunView {
  runId: string;
  conversationId: string;
  intent: string;
  scope: AgentDraftArtifact["scope"];
  sources: SourceReference[];
  selection?: SelectionSnapshot;
  sectionTitle?: string;
  proposals: AgentProposal[];
  provider: string;
  model?: string;
  modelClass: string;
  capabilityRevision: string;
  endReason?: string;
  explanation?: string;
  partial?: boolean;
  /** Model that actually served the run (AIResponse.baseModelName). */
  servedModel?: string;
  /** Provider id that actually served the run. */
  servedProviderId?: string;
  /** Provider id the user selected in the picker. */
  selectedProviderId?: string;
  /** True when this artifact came from conversation hydration. */
  restored?: boolean;
  /** Saved ids recovered from the persisted artifact (plain map). */
  savedIds?: Record<string, string>;
  acceptedProposalIds?: string[];
  /** Source ids the user removed after this run was frozen (blocks approval). */
  revokedSourceIds?: string[];
}

export interface LearningAgentProposalsProps {
  run: LearningAgentRunView;
  /** Persist the updated draft artifact (status/saved ids only). */
  onArtifactChange?: (artifact: AgentDraftArtifact) => void;
}

function sourceCount(run: LearningAgentRunView): number {
  return run.sources.filter((source) => source.kind === "document" || source.kind === "library")
    .length;
}

export function LearningAgentProposals({ run, onArtifactChange }: LearningAgentProposalsProps) {
  const { t } = useI18n();
  const [proposals, setProposals] = useState<AgentProposal[]>(run.proposals);
  const [groups, setGroups] = useState<AgentProposalGroup[]>([]);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [staleSources, setStaleSources] = useState<string[]>([]);
  const [revalidated, setRevalidated] = useState(!run.restored);
  const [summary, setSummary] = useState<string | null>(null);
  const [extractProposal, setExtractProposal] = useState<AgentExtractProposal | null>(null);
  const [confirmingTag, setConfirmingTag] = useState<string | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const runIdRef = useRef(run.runId);

  const savedIds = useMemo(
    () => new Map(Object.entries(run.savedIds ?? {})),
    [run.savedIds]
  );
  const acceptedIds = useMemo(
    () => new Set(run.acceptedProposalIds ?? []),
    [run.acceptedProposalIds]
  );

  useEffect(() => {
    recordLearningAgentStage({
      runId: run.runId,
      stage: "preview",
      outcome: "success",
      capabilityRevision: run.capabilityRevision,
    });
  }, [run.runId, run.capabilityRevision]);

  const rebuild = useCallback(
    (nextProposals: AgentProposal[]) => {
      const nextGroups = buildAgentProposalGroups(nextProposals, {
        savedIds,
        acceptedProposalIds: acceptedIds,
      });
      setGroups(nextGroups);
      return nextGroups;
    },
    [savedIds, acceptedIds]
  );

  // Hydration: restore the draft shape, re-read the cited source records and
  // re-anchor evidence. Never starts a run. Stale sources block acceptance.
  useEffect(() => {
    if (runIdRef.current !== run.runId) {
      runIdRef.current = run.runId;
      setProposals(run.proposals);
      setRevalidated(!run.restored);
      setStaleSources([]);
      setSummary(null);
    }
    let cancelled = false;
    const hydrate = async () => {
      setValidating(true);
      let nextProposals = run.proposals;
      if (run.restored) {
        const result = await revalidateRestoredProposalSources(nextProposals);
        if (cancelled) return;
        nextProposals = result.proposals;
        setStaleSources(result.stale);
        setRevalidated(result.stale.length === 0);
        setProposals(nextProposals);
      }
      const built = rebuild(nextProposals);
      const validated = await validateAgentProposalGroups(built);
      if (!cancelled) {
        setGroups(validated);
        setValidating(false);
        const blocked = validated.some((group) =>
          group.cards.some(
            (row) =>
              row.status === "duplicate-unavailable" ||
              row.status === "ungrounded" ||
              row.status === "duplicate"
          )
        );
        recordLearningAgentStage({
          runId: run.runId,
          stage: "validation",
          outcome: blocked ? "failed" : "success",
          capabilityRevision: run.capabilityRevision,
          errorCategory: blocked ? "ValidationBlocked" : undefined,
          recoveryCode: blocked ? "review_candidate" : undefined,
        });
      }
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [run.runId, run.proposals, run.restored, rebuild]);

  const persist = useCallback(
    (nextGroups: AgentProposalGroup[], extra?: { partial?: boolean; explanation?: string }) => {
      if (!onArtifactChange) return;
      const artifact = buildAgentDraftArtifact({
        runId: run.runId,
        conversationId: run.conversationId,
        intent: run.intent,
        scope: run.scope,
        sources: run.sources,
        selection: run.selection,
        sectionTitle: run.sectionTitle,
        proposals,
        review: nextGroups,
        partial: extra?.partial ?? run.partial,
        endReason: run.endReason,
        explanation: extra?.explanation ?? run.explanation,
      });
      onArtifactChange(artifact);
    },
    [onArtifactChange, proposals, run]
  );

  const updateRow = useCallback(
    (proposalId: string, patch: Partial<AgentCardReview>) => {
      setGroups((prev) =>
        prev.map((group) => ({
          ...group,
          cards: group.cards.map((row) =>
            row.proposalId === proposalId ? { ...row, ...patch } : row
          ),
        }))
      );
    },
    []
  );

  const editCandidate = useCallback(
    (proposalId: string, patch: Partial<AgentCardReview["candidate"]>) => {
      setGroups((prev) =>
        prev.map((group) => ({
          ...group,
          cards: group.cards.map((row) =>
            row.proposalId === proposalId
              ? {
                  ...row,
                  candidate: { ...row.candidate, ...patch },
                  edited: true,
                  // Edits never clear a duplicate/unavailable flag by
                  // themselves; revalidation must pass.
                  status: "draft",
                  issues: [],
                  accepted: false,
                }
              : row
          ),
        }))
      );
    },
    []
  );

  const revalidateRow = useCallback(
    async (proposalId: string) => {
      setValidating(true);
      const group = groups.find((candidate) =>
        candidate.cards.some((row) => row.proposalId === proposalId)
      );
      const row = group?.cards.find((candidate) => candidate.proposalId === proposalId);
      if (!row || !group) {
        setValidating(false);
        return;
      }
      const validated = await validateAgentCardReview(row, group.cards);
      updateRow(proposalId, {
        ...validated,
        accepted: validated.status === "valid",
      });
      setValidating(false);
    },
    [groups, updateRow]
  );

  const selectedCount = groups.reduce(
    (count, group) =>
      count + group.cards.filter((row) => row.accepted && row.status === "valid" && !row.savedId).length,
    0
  );
  const revoked = new Set(run.revokedSourceIds ?? []);
  const revokedBlocked =
    revoked.size > 0 &&
    proposals.some((proposal) =>
      proposal.sourceRefs.some(
        (source) => source.documentId && revoked.has(source.documentId)
      )
    );

  const save = useCallback(async () => {
    if (saving || selectedCount === 0 || revokedBlocked) return;
    setSaving(true);
    setSummary(null);
    const selected = groups.flatMap((group) =>
      group.cards
        .filter((row) => row.accepted && row.status === "valid" && !row.savedId)
        .map((row) => ({ proposalId: row.proposalId, candidate: row.candidate }))
    );
    try {
      const result: AgentAcceptanceResult = await saveAgentProposals({
        runId: run.runId,
        conversationId: run.conversationId,
        provider: run.provider,
        model: run.model,
        modelClass: run.modelClass,
        proposals,
        sources: run.sources,
        selected,
        onCandidateState: (proposalId, state, detail) => {
          if (state === "validating" || state === "saving") return;
          if (state === "saved") {
            updateRow(proposalId, {
              status: "saved",
              savedId: detail?.savedId,
              provenancePending: detail?.provenancePending,
              issues: detail?.provenancePending
                ? ["Saved; source metadata needs repair."]
                : [],
            });
          } else if (state === "failed") {
            updateRow(proposalId, {
              status: "failed",
              issues: [detail?.error ?? "Save failed."],
            });
          }
        },
      });
      const savedByProposal = new Map(result.saved.map((entry) => [entry.proposalId, entry]));
      const failedByProposal = new Map(
        result.failed.map((entry) => [entry.proposalId, entry])
      );
      const groupsWithResults: AgentProposalGroup[] = groups.map((group) => ({
        ...group,
        cards: group.cards.map((row) => {
          const saved = savedByProposal.get(row.proposalId);
          if (saved) {
            return {
              ...row,
              status: "saved" as const,
              savedId: saved.itemId,
              provenancePending: saved.provenancePending,
              accepted: true,
              issues: saved.provenancePending
                ? ["Saved; source metadata needs repair."]
                : [],
            };
          }
          const failure = failedByProposal.get(row.proposalId);
          if (failure) {
            return {
              ...row,
              status: failure.duplicateCheckUnavailable
                ? ("duplicate-unavailable" as const)
                : ("failed" as const),
              accepted: false,
              issues: [failure.error],
            };
          }
          return row;
        }),
      }));
      setGroups(groupsWithResults);
      const groupSummary = groups
        .map((group) => {
          const saved = group.cards.filter((row) => savedByProposal.has(row.proposalId)).length;
          const failed = group.cards.filter((row) =>
            result.failed.some((failure) => failure.proposalId === row.proposalId)
          ).length;
          if (saved === 0 && failed === 0) return null;
          return `${group.title}: ${saved} saved${failed ? `, ${failed} failed` : ""}`;
        })
        .filter(Boolean)
        .join(" · ");
      const reconciled = result.reconciledProposalIds.length
        ? ` Recovered ${result.reconciledProposalIds.length} already-saved item(s) after an interrupted response.`
        : "";
      const blocked = result.failed.find((failure) => failure.duplicateCheckUnavailable);
      const cancelled = result.cancelled ? " Stopped before the next group; earlier saves remain." : "";
      recordLearningAgentStage({
        runId: run.runId,
        stage: "persistence",
        outcome: cancelled
          ? "cancelled"
          : result.failed.length > 0
            ? "failed"
            : "success",
        capabilityRevision: run.capabilityRevision,
        errorCategory: blocked ? "DuplicateCheckUnavailable" : undefined,
        recoveryCode: result.reconciledProposalIds.length ? "reconciled_acceptance" : undefined,
      });
      setSummary(
        `${groupSummary || "Nothing was saved."}${reconciled}${cancelled}${
          blocked ? ` ${blocked.error}` : ""
        }`
      );
      const nextGroups = buildAgentProposalGroups(proposals, {
        savedIds: new Map(result.saved.map((entry) => [entry.proposalId, entry.itemId])),
        acceptedProposalIds: new Set(result.saved.map((entry) => entry.proposalId)),
      });
      // Persist the actual per-candidate outcomes (saved ids + failures), not
      // a freshly rebuilt draft that would forget the failure/issue states.
      persist(groupsWithResults.length > 0 ? groupsWithResults : nextGroups);
    } catch (error) {
      setSummary(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [groups, persist, proposals, revokedBlocked, run, saving, selectedCount, updateRow]);

  const repairSaved = useCallback(
    async (proposalId: string, itemId: string) => {
      const result = await repairAgentProvenance({
        runId: run.runId,
        conversationId: run.conversationId,
        provider: run.provider,
        model: run.model,
        modelClass: run.modelClass,
        proposals,
        selected: [],
        saved: [{ proposalId, itemId }],
      });
      if (result.repaired.includes(proposalId)) {
        updateRow(proposalId, {
          provenancePending: false,
          issues: [],
        });
      }
    },
    [proposals, run, updateRow]
  );

  const markSimpleSaved = useCallback(
    (proposalId: string, itemId: string) => {
      const nextGroups = groups.map((group) => ({
        ...group,
        extracts: group.extracts.map((entry) =>
          entry.proposalId === proposalId
            ? { ...entry, status: "saved" as const, savedId: itemId }
            : entry
        ),
        tags: group.tags.map((entry) =>
          entry.proposalId === proposalId
            ? { ...entry, status: "saved" as const, savedId: itemId }
            : entry
        ),
        occlusions: group.occlusions.map((entry) =>
          entry.proposalId === proposalId ? { ...entry, status: "saved" as const } : entry
        ),
      }));
      setGroups(nextGroups);
      persist(nextGroups);
    },
    [groups, persist]
  );

  const applyTag = useCallback(
    async (row: AgentSimpleProposalReview) => {
      const proposal = row.proposal as AgentTagProposal;
      setTagError(null);
      setConfirmingTag(null);
      try {
        const updated = await updateLearningItemTags(proposal.itemId, [
          ...proposal.existingTags,
          proposal.tag,
        ]);
        markSimpleSaved(proposal.proposalId, updated.id);
      } catch (error) {
        setTagError(error instanceof Error ? error.message : String(error));
      }
    },
    [markSimpleSaved]
  );

  const openOcclusion = useCallback(
    (proposal: AgentOcclusionProposal) => {
      window.dispatchEvent(
        new CustomEvent("plethora:create-image-occlusion", {
          detail: { assetId: proposal.imageAssetId, documentId: proposal.documentId },
        })
      );
      setGroups((prev) =>
        prev.map((group) => ({
          ...group,
          occlusions: group.occlusions.map((entry) =>
            entry.proposalId === proposal.proposalId
              ? {
                  ...entry,
                  status: "draft",
                  issues: [
                    "Opened the occlusion composer. Nothing is saved until you finish there.",
                  ],
                }
              : entry
          ),
        }))
      );
    },
    []
  );

  const cardRows = groups.flatMap((group) => group.cards);
  const extractRows = groups.flatMap((group) => group.extracts);
  const tagRows = groups.flatMap((group) => group.tags);
  const occlusionRows = groups.flatMap((group) => group.occlusions);
  const totalRows = cardRows.length + extractRows.length + tagRows.length + occlusionRows.length;

  // End-reason copy resolves through i18n (assistant.agent.end.*); fallback
  // to the raw loop explanation for reasons without a key yet.
  const endReasonCopy = (): string | undefined => {
    if (!run.endReason) return run.explanation;
    const key = `assistant.agent.end.${run.endReason}`;
    const translated = t(key);
    return translated !== key ? translated : run.explanation;
  };

  const routeDisclosure = (): string | undefined => {
    if (!run.servedModel) return undefined;
    const servedProvider = run.servedProviderId ?? run.provider;
    const selectedModel = run.model;
    if (run.selectedProviderId && run.selectedProviderId !== run.servedProviderId && selectedModel) {
      return t("assistant.agent.routeMismatch", {
        selectedProvider: run.selectedProviderId,
        selectedModel,
        servedProvider,
        servedModel: run.servedModel,
      });
    }
    return t("assistant.agent.routeDisclosure", {
      provider: servedProvider,
      model: run.servedModel,
    });
  };

  if (totalRows === 0) {
    return (
      <div data-learning-agent-proposals className="space-y-1 rounded-lg border border-border bg-background p-3 text-sm">
        <p className="font-medium text-foreground">{t("assistant.agent.noProposals")}</p>
        {routeDisclosure() && (
          <p className="text-[11px] text-muted-foreground">{routeDisclosure()}</p>
        )}
        {run.scope === "section" && run.endReason && run.endReason !== "final-answer" && (
          <p className="text-xs text-muted-foreground">
            {t("assistant.agent.noCardsFromSection")}
          </p>
        )}
        {endReasonCopy() && (
          <p className="text-xs text-muted-foreground">{endReasonCopy()}</p>
        )}
      </div>
    );
  }

  return (
    <div
      data-learning-agent-proposals
      data-run-id={run.runId}
      className="space-y-3 rounded-lg border border-border bg-background p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{t("assistant.agent.reviewTitle")}</p>
          <p className="text-[11px] text-muted-foreground">
            {t("assistant.agent.sources", { count: sourceCount(run) })} ·{" "}
            {t("assistant.agent.scope", { scope: run.scope })}
          </p>
          {routeDisclosure() && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">{routeDisclosure()}</p>
          )}
        </div>
        {run.partial && (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
            {t("assistant.agent.partial")}
          </span>
        )}
      </div>

      {(endReasonCopy() || staleSources.length > 0) && (
        <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          {staleSources.length > 0 ? (
            <p>{t("assistant.agent.staleSources")}</p>
          ) : (
            <p>{endReasonCopy()}</p>
          )}
          {staleSources.length > 0 && (
            <p className="mt-1 font-medium text-amber-700 dark:text-amber-300">
              {t("assistant.agent.staleSourcesHint")}
            </p>
          )}
        </div>
      )}
      {revokedBlocked && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
          {t("assistant.agent.revokedSource")}
        </p>
      )}

      {validating && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <CircleNotch className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {t("assistant.agent.validating")}
        </div>
      )}

      {groups.map((group) => (
        <section
          key={group.key}
          data-agent-source-group={group.key}
          className="space-y-2 rounded-md border border-border/70 p-2"
        >
          <header className="flex items-center justify-between gap-2">
            <h3 className="truncate text-xs font-semibold text-foreground">{group.title}</h3>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {t("assistant.agent.groupCount", {
                cards: group.cards.filter((row) => row.status !== "cap-exceeded").length,
                max: AGENT_PREVIEW_MAX_CARDS_PER_SOURCE,
              })}
            </span>
          </header>

          {group.capApplied && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              {t("assistant.agent.capApplied", {
                perSource: AGENT_PREVIEW_MAX_CARDS_PER_SOURCE,
                perConcept: AGENT_PREVIEW_MAX_CARDS_PER_CONCEPT,
              })}
            </p>
          )}

          <div className="space-y-2" role="list">
            {group.cards.map((row) => {
              const blocked =
                row.status === "cap-exceeded" ||
                row.status === "ungrounded" ||
                row.status === "duplicate" ||
                row.status === "duplicate-unavailable" ||
                row.status === "failed";
              return (
                <div
                  key={row.proposalId}
                  role="listitem"
                  data-agent-proposal-id={row.proposalId}
                  className={`rounded-lg border p-2 ${
                    row.savedId
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : row.accepted && !blocked
                        ? "border-primary/50 bg-primary/5"
                        : "border-border bg-background"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      aria-label={t("assistant.agent.acceptRow")}
                      checked={row.accepted && !blocked && !saving}
                      disabled={blocked || saving || Boolean(row.savedId)}
                      onChange={(event) =>
                        updateRow(row.proposalId, { accepted: event.target.checked })
                      }
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t(`aiLearning.ct.${row.candidate.cardType}`)}
                        {row.edited ? ` · ${t("assistant.agent.edited")}` : ""}
                      </p>
                      {row.issues.length > 0 && (
                        <p className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
                          <Warning className="h-3 w-3" aria-hidden="true" />
                          {row.issues.join(" ")}
                        </p>
                      )}
                      {row.status === "duplicate-unavailable" && (
                        <button
                          type="button"
                          className="rounded border border-border px-2 py-0.5 text-[11px] text-foreground"
                          onClick={() => void revalidateRow(row.proposalId)}
                          disabled={validating}
                        >
                          {t("assistant.agent.retryDuplicateCheck")}
                        </button>
                      )}
                      {row.status === "saved" && row.provenancePending && (
                        <div className="text-[11px] text-amber-700 dark:text-amber-300">
                          <span>{t("assistant.agent.savedMetadataPending")}</span>
                          <button
                            type="button"
                            className="ml-2 rounded border border-border px-2 py-0.5 text-foreground"
                            onClick={() => void repairSaved(row.proposalId, row.savedId!)}
                          >
                            {t("assistant.agent.repairMetadata")}
                          </button>
                        </div>
                      )}
                      <textarea
                        aria-label={t("assistant.agent.editQuestion")}
                        className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-[13px] text-foreground"
                        rows={2}
                        value={
                          row.candidate.cardType === "cloze"
                            ? row.candidate.clozeText ?? row.candidate.question
                            : row.candidate.question
                        }
                        disabled={Boolean(row.savedId) || saving || row.status === "cap-exceeded"}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (row.candidate.cardType === "cloze") {
                            editCandidate(row.proposalId, {
                              clozeText: value,
                              question: value,
                            });
                          } else {
                            editCandidate(row.proposalId, { question: value });
                          }
                        }}
                        onBlur={() => {
                          if (row.edited && !row.savedId) void revalidateRow(row.proposalId);
                        }}
                      />
                      <textarea
                        aria-label={t("assistant.agent.editAnswer")}
                        className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-[12px] text-muted-foreground"
                        rows={2}
                        value={row.candidate.answer}
                        disabled={Boolean(row.savedId) || saving || row.status === "cap-exceeded"}
                        onChange={(event) =>
                          editCandidate(row.proposalId, { answer: event.target.value })
                        }
                        onBlur={() => {
                          if (row.edited && !row.savedId) void revalidateRow(row.proposalId);
                        }}
                      />
                      <div className="flex items-center gap-2">
                        <select
                          aria-label={t("aiLearning.cardType")}
                          className="rounded border border-border bg-background px-1 py-0.5 text-[11px]"
                          value={row.candidate.cardType}
                          disabled={Boolean(row.savedId) || saving || row.status === "cap-exceeded"}
                          onChange={(event) => {
                            editCandidate(row.proposalId, {
                              cardType: event.target.value as LearningCardType,
                            });
                            void revalidateRow(row.proposalId);
                          }}
                        >
                          {SWITCHABLE_CARD_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {t(`aiLearning.ct.${type}`)}
                            </option>
                          ))}
                        </select>
                        {row.savedId && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                            <Check className="h-3 w-3" aria-hidden="true" />
                            {t("assistant.agent.saved")}
                          </span>
                        )}
                        {!row.savedId && (row.edited || row.status === "rejected") && (
                          <button
                            type="button"
                            className="rounded border border-border px-2 py-0.5 text-[11px]"
                            onClick={() => void revalidateRow(row.proposalId)}
                            disabled={validating}
                          >
                            {t("assistant.agent.revalidate")}
                          </button>
                        )}
                        {!row.savedId && (
                          <button
                            type="button"
                            className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                            onClick={() =>
                              updateRow(row.proposalId, {
                                accepted: false,
                                status: "rejected",
                              })
                            }
                            disabled={saving}
                          >
                            {t("assistant.agent.reject")}
                          </button>
                        )}
                      </div>
                    </div>
                    <PencilSimple className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </div>
                </div>
              );
            })}
          </div>

          {group.extracts.map((row) => {
            const proposal = row.proposal as AgentExtractProposal;
            return (
              <div key={row.proposalId} className="rounded-lg border border-border p-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("assistant.agent.extract")}
                </p>
                <p className="line-clamp-3 text-[12px] text-foreground">{proposal.text}</p>
                <div className="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-0.5 text-[11px]"
                    onClick={() => setExtractProposal(proposal)}
                    disabled={Boolean(row.savedId)}
                  >
                    {row.savedId ? t("assistant.agent.saved") : t("assistant.agent.reviewExtract")}
                  </button>
                  {row.savedId && (
                    <span className="text-[11px] text-muted-foreground">{t("assistant.agent.openInExtracts")}</span>
                  )}
                </div>
              </div>
            );
          })}

          {group.tags.map((row) => {
            const proposal = row.proposal as AgentTagProposal;
            return (
              <div key={row.proposalId} className="rounded-lg border border-border p-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("assistant.agent.tag")}
                </p>
                <p className="text-[12px] text-foreground">
                  {proposal.itemQuestion} → <strong>{proposal.tag}</strong>
                </p>
                {confirmingTag === proposal.proposalId ? (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {t("assistant.agent.confirmTag", { tag: proposal.tag })}
                    </span>
                    <button
                      type="button"
                      className="rounded bg-primary px-2 py-0.5 text-[11px] text-primary-foreground"
                      onClick={() => void applyTag(row)}
                    >
                      {t("assistant.agent.confirm")}
                    </button>
                    <button
                      type="button"
                      className="rounded border border-border px-2 py-0.5 text-[11px]"
                      onClick={() => setConfirmingTag(null)}
                    >
                      {t("assistant.agent.cancel")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="mt-1 rounded border border-border px-2 py-0.5 text-[11px]"
                    onClick={() => setConfirmingTag(proposal.proposalId)}
                    disabled={Boolean(row.savedId)}
                  >
                    {row.savedId ? t("assistant.agent.saved") : t("assistant.agent.applyTag")}
                  </button>
                )}
                {tagError && <p className="mt-1 text-[11px] text-destructive">{tagError}</p>}
              </div>
            );
          })}

          {group.occlusions.map((row) => {
            const proposal = row.proposal as AgentOcclusionProposal;
            return (
              <div key={row.proposalId} className="rounded-lg border border-border p-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("assistant.agent.occlusion")}
                </p>
                <p className="text-[12px] text-foreground">{proposal.imageAssetId}</p>
                <button
                  type="button"
                  className="mt-1 inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px]"
                  onClick={() => openOcclusion(proposal)}
                >
                  <ArrowSquareOut className="h-3 w-3" aria-hidden="true" />
                  {t("assistant.agent.openOcclusion")}
                </button>
                {row.issues.length > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">{row.issues.join(" ")}</p>
                )}
              </div>
            );
          })}
        </section>
      ))}

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-agent-save
          className="flex-1 rounded-lg bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
          disabled={saving || validating || selectedCount === 0 || staleSources.length > 0 || revokedBlocked}
          onClick={() => void save()}
        >
          {saving
            ? t("assistant.agent.saving")
            : t("assistant.agent.acceptSelected", { count: selectedCount })}
        </button>
        {saving && <CircleNotch className="h-4 w-4 animate-spin" aria-hidden="true" />}
      </div>
      {!revalidated && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">
          {t("assistant.agent.acceptanceBlocked")}
        </p>
      )}
      {summary && (
        <div className="rounded-md border border-border bg-muted/40 p-2 text-[11px] text-foreground" role="status">
          <div className="flex items-start justify-between gap-2">
            <p className="flex-1">{summary}</p>
            <button type="button" onClick={() => setReportOpen((open) => !open)}>
              {t("assistant.agent.details")}
            </button>
          </div>
          {reportOpen && (
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {groups.flatMap((group) =>
                group.cards.map((row) => (
                  <li key={row.proposalId}>
                    {group.title}: {row.proposalId} — {row.status}
                    {row.savedId ? ` (${row.savedId})` : ""}
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}

      {extractProposal && (
        <CreateExtractDialog
          documentId={extractProposal.documentId}
          selectedText={extractProposal.text}
          isOpen
          onClose={() => setExtractProposal(null)}
          onCreate={(extract) => {
            markSimpleSaved(extractProposal.proposalId, extract.id);
            setExtractProposal(null);
          }}
        />
      )}
    </div>
  );
}
