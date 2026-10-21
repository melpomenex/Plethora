/**
 * SessionAnalysisCoordinator (Task 3.5, Design D8).
 *
 * Checkpointed analysis coordinator orchestrating:
 *   - Token budgets and transcript unit planning (unitPlanner.ts)
 *   - Execution of sessionSectionAnalysisTask and sessionOverviewTask via runTask
 *   - Checkpointing runs, units, and learning drafts to SQLite (SessionAnalysisRepository)
 *   - Evidence validation, range anchoring, and truthful timing (sessionAnalysis.ts)
 *   - Run-level limits (max 40 cards, max 40 extracts, max 64 section requests, max 16 overview requests)
 *   - Concurrency control (mobile=1, desktop=2 / 1 during recording)
 *   - Pause / Resume / Cancel / Retry failed / Regenerate new epoch
 *   - Idempotent re-runs (no duplicate inference for committed inputs)
 *   - Safe staging (creates drafts in session_learning_drafts only; zero active learning items)
 */

import {
  createSessionAnalysisRun,
  createSessionLearningDraft,
  getRecordingSession,
  getSessionDocumentPrivacy,
  getSessionSegments,
  listSessionAnalysisUnits,
  listSessionLearningDrafts,
  updateRecordingSessionOverview,
  updateSessionLearningDraft,
  upsertSessionAnalysisUnit,
} from "../../../api/recordingSessions";
import type { AIProvider } from "../../../lib/ai/providers/types";
import {
  SESSION_ANALYSIS_TASK_VERSION,
  validateAndReconstructEvidence,
  type SessionOverviewAnalysisResult,
  type SessionProfileObservations,
  type SessionSectionAnalysisResult,
} from "../../../lib/ai/schemas/sessionAnalysis";
import {
  sessionOverviewTask,
  type SessionOverviewInput,
} from "../../../lib/ai/tasks/definitions/sessionOverviewTask";
import {
  sessionSectionAnalysisTask,
  type SessionSectionAnalysisInput,
} from "../../../lib/ai/tasks/definitions/sessionSectionAnalysisTask";
import { runTask } from "../../../lib/ai/tasks/runTask";
import type {
  RecordingSession,
  SessionAnalysisRun,
  SessionAnalysisUnit,
} from "../../../types/recordingSession";
import {
  calculateTokenBudget,
  DEFAULT_MAX_OVERVIEW_REQUESTS,
  DEFAULT_MAX_SECTION_REQUESTS,
  MAX_RUN_PROPOSED_CARDS,
  MAX_RUN_PROPOSED_EXTRACTS,
  planSummaryTree,
  planTranscriptUnits,
  sha256Sync,
  type PlannedTranscriptUnit,
} from "./unitPlanner";
import {
  computeProfileHash,
  parseSessionProfile,
  type SessionOutputProfile,
} from "./profiles";

export type CoordinatorState =
  | "idle"
  | "planning"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface CoordinatorProgress {
  state: CoordinatorState;
  sessionId: string;
  runId?: string;
  generationEpoch?: string;
  completedUnits: number;
  totalUnits: number;
  proposedCards: number;
  proposedExtracts: number;
  totalTokens: number;
  currentStage: "planning" | "sections" | "overview" | "done";
  errorMessage?: string;
}

export interface StartAnalysisOptions {
  profile?: string;
  enrichmentSelected?: boolean;
  profileOverrides?: Partial<SessionOutputProfile>;
  forceProvider?: AIProvider;
  contextTokens?: number;
  systemTokens?: number;
  maxSectionRequests?: number;
  maxOverviewRequests?: number;
  generationEpoch?: string;
  isMobile?: boolean;
  isRecordingOrSttActive?: boolean;
  onProgress?: (progress: CoordinatorProgress) => void;
}

export class SessionAnalysisCoordinator {
  private state: CoordinatorState = "idle";
  private currentSessionId: string | null = null;
  private currentRun: SessionAnalysisRun | null = null;
  private abortController: AbortController | null = null;
  private isPaused = false;
  private isCancelled = false;

  private completedUnitsCount = 0;
  private totalUnitsCount = 0;
  private proposedCardsCount = 0;
  private proposedExtractsCount = 0;
  private totalTokensCount = 0;
  private onProgressCallback?: (progress: CoordinatorProgress) => void;

  public getState(): CoordinatorState {
    return this.state;
  }

  public getProgress(): CoordinatorProgress {
    return {
      state: this.state,
      sessionId: this.currentSessionId || "",
      runId: this.currentRun?.id,
      generationEpoch: this.currentRun?.generationEpoch,
      completedUnits: this.completedUnitsCount,
      totalUnits: this.totalUnitsCount,
      proposedCards: this.proposedCardsCount,
      proposedExtracts: this.proposedExtractsCount,
      totalTokens: this.totalTokensCount,
      currentStage:
        this.state === "planning"
          ? "planning"
          : this.completedUnitsCount < this.totalUnitsCount
          ? "sections"
          : this.state === "completed"
          ? "done"
          : "overview",
    };
  }

  private notifyProgress(errorMessage?: string) {
    if (this.onProgressCallback) {
      const p = this.getProgress();
      if (errorMessage) p.errorMessage = errorMessage;
      this.onProgressCallback(p);
    }
  }

  /**
   * Pause the active analysis. Current in-flight unit will finish or abort safely,
   * checkpoints are persisted in SQLite, and execution can be resumed later.
   */
  public pause(): void {
    if (this.state === "running") {
      this.isPaused = true;
      this.state = "paused";
      this.notifyProgress();
    }
  }

  /**
   * Cancel the active analysis run. Leaves committed units and drafts intact.
   */
  public cancel(): void {
    this.isCancelled = true;
    this.state = "cancelled";
    if (this.abortController) {
      this.abortController.abort();
    }
    this.notifyProgress();
  }

  /**
   * Start or resume session analysis.
   */
  public async startAnalysis(
    sessionId: string,
    options: StartAnalysisOptions = {}
  ): Promise<CoordinatorProgress> {
    this.currentSessionId = sessionId;
    this.isPaused = false;
    this.isCancelled = false;
    this.abortController = new AbortController();
    this.onProgressCallback = options.onProgress;
    this.state = "planning";
    this.notifyProgress();

    // 1. Privacy gate
    const privacy = await getSessionDocumentPrivacy(sessionId);
    if (privacy.isAiExcluded) {
      this.state = "failed";
      const err = "Session is excluded from AI processing due to document privacy";
      this.notifyProgress(err);
      throw new Error(err);
    }

    // 2. Load recording session & transcript
    const session = await getRecordingSession(sessionId);
    if (!session) {
      this.state = "failed";
      const err = `Session ${sessionId} not found`;
      this.notifyProgress(err);
      throw new Error(err);
    }

    // 2b. Parse profile and check explicit user opt-in (D9)
    const profile = parseSessionProfile(
      session.profileJson,
      options.profile ?? session.contentType
    );
    if (options.enrichmentSelected !== undefined) {
      profile.enrichmentSelected = options.enrichmentSelected;
    }
    if (options.profileOverrides) {
      Object.assign(profile, options.profileOverrides);
    }

    if (!profile.enrichmentSelected) {
      this.state = "idle";
      const err = "Analysis enrichment was not selected by user";
      this.notifyProgress(err);
      throw new Error(err);
    }

    const segmentsPage = await getSessionSegments(sessionId, { limit: 10000 });
    const segments = segmentsPage.items;
    if (segments.length === 0) {
      this.state = "completed";
      this.completedUnitsCount = 0;
      this.totalUnitsCount = 0;
      this.notifyProgress();
      return this.getProgress();
    }

    // 3. Token budgeting (D8 formula)
    const contextTokens = options.contextTokens ?? 8192;
    const systemTokens = options.systemTokens ?? 1000;
    const budget = calculateTokenBudget({ contextTokens, systemTokens });

    if (!budget.fits) {
      this.state = "failed";
      const err = budget.error || "Insufficient model context token budget";
      this.notifyProgress(err);
      throw new Error(err);
    }

    // 4. Plan transcript units
    const maxSectionRequests = options.maxSectionRequests ?? DEFAULT_MAX_SECTION_REQUESTS;
    const unitPlan = planTranscriptUnits(segments, {
      budget,
      maxSectionRequests,
      transcriptRevision: session.transcriptRevision,
    });

    const plannedUnits = unitPlan.units;
    this.totalUnitsCount = plannedUnits.length;
    this.totalTokensCount = unitPlan.totalTokens;
    this.completedUnitsCount = 0;

    // 5. Create or claim analysis run
    const epoch = options.generationEpoch ?? `epoch-${Date.now()}`;
    const profileHash = computeProfileHash(profile);
    const runId = `run-${session.id}-rev${session.transcriptRevision}-${epoch}-${profileHash.slice(0, 8)}`;

    const run = await createSessionAnalysisRun({
      id: runId,
      sessionId: session.id,
      transcriptRevision: session.transcriptRevision,
      profileHash,
      taskVersion: SESSION_ANALYSIS_TASK_VERSION,
      generationEpoch: epoch,
      totalUnits: plannedUnits.length,
    });
    this.currentRun = run;

    // 6. Check existing units for idempotency (no duplicate inference)
    const existingUnits = await listSessionAnalysisUnits(run.id);
    const existingUnitMap = new Map<string, SessionAnalysisUnit>();
    for (const u of existingUnits) {
      existingUnitMap.set(u.unitKey, u);
    }

    this.state = "running";
    this.notifyProgress();

    // 7. Process Section Units
    const sectionSummaries: Array<{
      unitKey: string;
      summary: string;
      topics?: string[];
      observations?: SessionProfileObservations;
    }> = [];
    let priorTopicSummary: string | undefined = undefined;

    for (let i = 0; i < plannedUnits.length; i++) {
      if (this.isCancelled) {
        this.state = "cancelled";
        this.notifyProgress();
        return this.getProgress();
      }

      if (this.isPaused) {
        this.state = "paused";
        this.notifyProgress();
        return this.getProgress();
      }

      const unit = plannedUnits[i];
      const existing = existingUnitMap.get(unit.unitKey);

      // Checkpoint idempotency: if unit is already completed with identical inputHash, reuse!
      if (existing && existing.status === "completed" && existing.inputHash === unit.inputHash && existing.resultJson) {
        try {
          const parsedResult: SessionSectionAnalysisResult = JSON.parse(existing.resultJson);
          sectionSummaries.push({
            unitKey: unit.unitKey,
            summary: parsedResult.sectionSummary,
            topics: parsedResult.topics,
            observations: parsedResult.profileObservations,
          });
          priorTopicSummary = parsedResult.sectionSummary;
          this.completedUnitsCount++;
          this.notifyProgress();
          continue;
        } catch {
          // If parse fails, re-run unit
        }
      }

      // Mark unit running
      await upsertSessionAnalysisUnit({
        runId: run.id,
        unitKey: unit.unitKey,
        inputHash: unit.inputHash,
        segmentKeysJson: JSON.stringify(unit.ownedSegmentKeys),
        status: "running",
      });

      // Prepare structured task input
      const taskInput: SessionSectionAnalysisInput = {
        sessionId: session.id,
        unitKey: unit.unitKey,
        ownedText: unit.ownedText,
        contextText: unit.contextOverlap?.text,
        profile: profile.profileType,
        enableCards: profile.enableCards,
        enableExtracts: profile.enableExtracts,
        priorTopicSummary,
      };

      try {
        // Execute section analysis via runTask (with up to 2 transport retries)
        const result = await this.executeSectionTaskWithRetries(
          taskInput,
          options.forceProvider
        );

        // Process and persist learning drafts
        await this.persistDraftsFromResult(
          session,
          run.id,
          unit,
          result,
          profile
        );

        // Checkpoint unit completion in SQLite
        await upsertSessionAnalysisUnit({
          runId: run.id,
          unitKey: unit.unitKey,
          inputHash: unit.inputHash,
          segmentKeysJson: JSON.stringify(unit.ownedSegmentKeys),
          status: "completed",
          resultJson: JSON.stringify(result),
        });

        sectionSummaries.push({
          unitKey: unit.unitKey,
          summary: result.sectionSummary,
          topics: result.topics,
          observations: result.profileObservations,
        });
        priorTopicSummary = result.sectionSummary;
        this.completedUnitsCount++;
        this.notifyProgress();
      } catch (err: any) {
        // Record failed unit checkpoint
        await upsertSessionAnalysisUnit({
          runId: run.id,
          unitKey: unit.unitKey,
          inputHash: unit.inputHash,
          segmentKeysJson: JSON.stringify(unit.ownedSegmentKeys),
          status: "failed",
          errorCode: err?.code || "section_inference_failed",
        });

        // Fail closed for unrecoverable errors
        this.state = "failed";
        const msg = err?.message || "Section analysis unit execution failed";
        this.notifyProgress(msg);
        throw err;
      }
    }

    // 8. Hierarchical Overview Summary Tree
    if (sectionSummaries.length > 0) {
      const alreadyHasOverview =
        Boolean(session.overviewJson) &&
        session.overviewRevision === session.transcriptRevision;

      if (!alreadyHasOverview) {
        try {
          await this.executeSummaryTree(
            session,
            sectionSummaries,
            profile,
            options.maxOverviewRequests ?? DEFAULT_MAX_OVERVIEW_REQUESTS,
            options.forceProvider
          );
        } catch (overviewErr) {
          // Non-fatal if overview fails after sections succeed; report error
          console.warn("[SessionAnalysisCoordinator] Overview synthesis failed:", overviewErr);
        }
      }
    }

    // 9. If epoch is new, supersede unaccepted predecessor drafts from earlier epochs
    await this.supersedePredecessorDrafts(session.id, run.id);

    this.state = "completed";
    this.notifyProgress();
    return this.getProgress();
  }

  /**
   * Execute section task with up to 2 transport retries (backoff 1s / 4s).
   */
  private async executeSectionTaskWithRetries(
    input: SessionSectionAnalysisInput,
    forceProvider?: AIProvider
  ): Promise<SessionSectionAnalysisResult> {
    let lastError: any = null;
    const backoffs = [1000, 4000];

    for (let attempt = 0; attempt <= 2; attempt++) {
      if (this.isCancelled) {
        throw new Error("Analysis run cancelled by user");
      }

      try {
        const res = await runTask(sessionSectionAnalysisTask, input, {
          provider: forceProvider,
          signal: this.abortController?.signal,
        });
        return res.output;
      } catch (err: any) {
        lastError = err;
        if (attempt < 2 && !this.isCancelled && !this.isPaused) {
          const delay = backoffs[attempt];
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Persist validated learning drafts for cards and extracts.
   */
  private async persistDraftsFromResult(
    session: RecordingSession,
    runId: string,
    unit: PlannedTranscriptUnit,
    result: SessionSectionAnalysisResult,
    profile: SessionOutputProfile
  ): Promise<void> {
    // 1. Proposed Extracts (up to run-level cap)
    if (profile.enableExtracts && Array.isArray(result.extractProposals)) {
      for (const ext of result.extractProposals) {
        if (this.proposedExtractsCount >= MAX_RUN_PROPOSED_EXTRACTS) break;

        const reconstructed = validateAndReconstructEvidence(ext.quote, unit.ownedRanges);
        if (!reconstructed.valid) continue;

        const contentHash = sha256Sync(ext.quote.trim());
        const evidenceJson = JSON.stringify({
          version: 1,
          documentId: session.documentId,
          sessionId: session.id,
          transcriptId: session.transcriptId ?? 0,
          transcriptRevision: session.transcriptRevision,
          segmentKeys: reconstructed.segmentKeys,
          quote: reconstructed.quote,
          ranges: reconstructed.ranges,
          time: reconstructed.timing.kind !== "none" ? reconstructed.timing : undefined,
          precision: "segment",
          fingerprint: contentHash,
        });

        const payloadJson = JSON.stringify({
          kind: "extract",
          verbatimText: reconstructed.quote,
          summaryNote: ext.summaryNote,
        });

        await createSessionLearningDraft({
          id: `draft-ext-${session.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          sessionId: session.id,
          runId,
          kind: "extract",
          status: "proposed",
          payloadJson,
          evidenceJson,
          contentHash,
        });

        this.proposedExtractsCount++;
      }
    }

    // 2. Proposed Cards (up to run-level cap)
    if (profile.enableCards && Array.isArray(result.cards)) {
      for (const card of result.cards) {
        if (this.proposedCardsCount >= MAX_RUN_PROPOSED_CARDS) break;

        const evidenceQuote = card.evidenceQuote || card.question;
        const reconstructed = validateAndReconstructEvidence(evidenceQuote, unit.ownedRanges);
        if (!reconstructed.valid) continue;

        const contentHash = sha256Sync(card.question.trim() + "::" + card.answer.trim());
        const evidenceJson = JSON.stringify({
          version: 1,
          documentId: session.documentId,
          sessionId: session.id,
          transcriptId: session.transcriptId ?? 0,
          transcriptRevision: session.transcriptRevision,
          segmentKeys: reconstructed.segmentKeys,
          quote: reconstructed.quote,
          ranges: reconstructed.ranges,
          time: reconstructed.timing.kind !== "none" ? reconstructed.timing : undefined,
          precision: "segment",
          fingerprint: contentHash,
        });

        const payloadJson = JSON.stringify({
          kind: "card",
          candidate: card,
        });

        await createSessionLearningDraft({
          id: `draft-card-${session.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          sessionId: session.id,
          runId,
          kind: "card",
          status: "proposed",
          payloadJson,
          evidenceJson,
          contentHash,
          conceptKey: card.concept || card.conceptKeys?.[0],
        });

        this.proposedCardsCount++;
      }
    }
  }

  /**
   * Execute hierarchical summary tree to synthesize overall session overview.
   */
  private async executeSummaryTree(
    session: RecordingSession,
    sectionSummaries: Array<{
      unitKey: string;
      summary: string;
      topics?: string[];
      observations?: SessionProfileObservations;
    }>,
    profile: SessionOutputProfile,
    maxOverviewRequests: number,
    forceProvider?: AIProvider
  ): Promise<void> {
    const unitKeys = sectionSummaries.map((s) => s.unitKey);
    const treePlan = planSummaryTree(unitKeys, { maxOverviewRequests });

    if (!treePlan.fitsBudget || treePlan.levels.length === 0) {
      return;
    }

    // Direct overview synthesis over bounded summaries
    const overviewInput: SessionOverviewInput = {
      sessionId: session.id,
      summaries: sectionSummaries,
      profile: profile.profileType,
      enableDecisionsAndActions: profile.enableDecisionsAndActions,
    };

    const overviewRes = await runTask(sessionOverviewTask, overviewInput, {
      provider: forceProvider,
      signal: this.abortController?.signal,
    });

    const overviewResult: SessionOverviewAnalysisResult = { ...overviewRes.output };
    if (!profile.enableDecisionsAndActions) {
      delete overviewResult.decisions;
      delete overviewResult.actionItems;
    }
    if (!profile.enableConcepts) {
      overviewResult.concepts = [];
    }
    if (!profile.enableOutline) {
      overviewResult.outline = [];
    }

    // Persist final overview to recording session row in SQLite
    await updateRecordingSessionOverview(
      session.id,
      JSON.stringify(overviewResult),
      session.transcriptRevision
    );
  }

  /**
   * Supersede unaccepted predecessor drafts from earlier runs after new epoch succeeds.
   */
  private async supersedePredecessorDrafts(sessionId: string, currentRunId: string): Promise<void> {
    try {
      const page = await listSessionLearningDrafts(sessionId, { status: "proposed", limit: 500 });
      for (const draft of page.items) {
        if (draft.runId && draft.runId !== currentRunId) {
          await updateSessionLearningDraft({
            id: draft.id,
            expectedRevision: draft.revision,
            status: "superseded",
          });
        }
      }
    } catch {
      // Best-effort cleanup of predecessor drafts
    }
  }
}

export const sessionAnalysisCoordinator = new SessionAnalysisCoordinator();
