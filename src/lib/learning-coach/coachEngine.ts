/**
 * Deterministic, local-first Personal Learning Coach engine.
 *
 * Architectural guarantees:
 * 1. Pure & 100% deterministic — zero AI required, identical inputs always yield
 *    identical ranked recommendations.
 * 2. Strictly non-mutating — never mutates canonical learning state; every
 *    recommendation carries a previewable `proposedAction` with
 *    `requiresConfirmation: true` and `mutatesDirectly: false`.
 * 3. Privacy-first — never reads or emits Health Vault metrics, and sets
 *    `cloudExplanationAllowed: false` whenever any referenced source is
 *    `isLocalOnly` or `isAiExcluded`.
 * 4. Exam isolation & user control — immediately returns `[]` when
 *    `proactivity === "disabled"` or `examIsolationActive === true`, honors
 *    per-category and per-signal dismissals/snoozes, quiet hours, and caps.
 */

export const COACHING_SIGNAL_TYPES = [
  "approaching_exam",
  "deadline_infeasible",
  "repeatedly_failed_cards",
  "misunderstood_concept",
  "review_backlog",
  "stalled_goal",
  "cross_document_connection",
  "demonstrated_prerequisite",
  "formulation_opportunity",
  "relevant_smart_feed",
  "schedule_adjustment",
  "transfer_opportunity",
] as const;

export type CoachingSignalType = (typeof COACHING_SIGNAL_TYPES)[number];

export const COACH_PROACTIVITY_LEVELS = [
  "disabled",
  "on_demand",
  "minimal",
  "balanced",
  "proactive",
] as const;

export type CoachProactivityLevel = (typeof COACH_PROACTIVITY_LEVELS)[number];

export type CoachingSeverity = "info" | "advisory" | "urgent";

export const PROACTIVITY_MAX_RECOMMENDATIONS: Record<CoachProactivityLevel, number> = {
  disabled: 0,
  on_demand: 12,
  minimal: 1,
  balanced: 3,
  proactive: 6,
};

export interface SourcePrivacyFlags {
  isLocalOnly?: boolean;
  isAiExcluded?: boolean;
}

export interface CoachEvidenceRef {
  kind:
    | "exam"
    | "goal"
    | "concept"
    | "learning_item"
    | "document"
    | "extract"
    | "smart_feed_item"
    | "session"
    | "study_plan_node";
  id: string;
  label?: string;
  isLocalOnly?: boolean;
  isAiExcluded?: boolean;
}

export type CoachProposedActionType =
  | "launch_exam_prep_session"
  | "adjust_goal_pace"
  | "open_conceptual_review"
  | "schedule_remediation"
  | "open_backlog_triage_session"
  | "launch_restart_session"
  | "open_cross_document_synthesis"
  | "offer_prerequisite_fast_track"
  | "open_formulation_queue"
  | "open_smart_feed_items"
  | "adjust_session_schedule"
  | "launch_transfer_practice";

export interface CoachProposedAction {
  actionType: CoachProposedActionType;
  targetDomain:
    | "session_runtime"
    | "learning_goals"
    | "review_queue"
    | "remediation"
    | "knowledge_graph"
    | "study_plan"
    | "formulation"
    | "smart_feeds";
  label: string;
  previewDescription: string;
  requiresConfirmation: true;
  mutatesDirectly: false;
  params: Record<string, string | number | boolean | string[]>;
}

export interface CoachingRecommendation {
  id: string;
  signalType: CoachingSignalType;
  dedupeKey: string;
  severity: CoachingSeverity;
  confidence: number;
  urgency: number;
  rankScore: number;
  title: string;
  summary: string;
  evidenceRefs: CoachEvidenceRef[];
  proposedAction: CoachProposedAction;
  cloudExplanationAllowed: boolean;
  privacyReason: "allowed" | "local_only_source" | "ai_excluded_source";
  generatedAt: string;
}

export interface CoachQuietHours {
  enabled: boolean;
  /** Local/UTC HH:MM (24h) */
  start: string;
  /** Local/UTC HH:MM (24h) */
  end: string;
}

export interface CoachPreferences {
  proactivity: CoachProactivityLevel;
  enabledCategories: Partial<Record<CoachingSignalType, boolean>>;
  aiExplanationsEnabled?: boolean;
  quietHours?: CoachQuietHours;
}

export interface CoachDismissal {
  /** Dismisses either a specific recommendation id/dedupeKey or an entire category. */
  signalId?: string;
  signalType?: CoachingSignalType;
  dismissedAt: string;
  /** If set, the dismissal is a snooze that expires at this ISO timestamp. If null/undefined, permanent. */
  snoozeUntil?: string | null;
  reason?: string;
}

export interface ApproachingExamSignalInput extends SourcePrivacyFlags {
  examId: string;
  title: string;
  examDateIso: string;
  /** 0..1 estimated readiness */
  readinessScore: number;
  targetReadiness?: number;
  weakConceptIds?: string[];
}

export interface GoalPacingSignalInput extends SourcePrivacyFlags {
  goalId: string;
  title: string;
  targetDateIso?: string | null;
  remainingEffortMinutes?: number;
  availableMinutesAtPace?: number;
  daysSinceLastActivity?: number;
  isPaused?: boolean;
}

export interface FailedCardClusterInput extends SourcePrivacyFlags {
  clusterId: string;
  conceptId?: string;
  conceptName: string;
  failedCardIds: string[];
  maxLapses: number;
  totalRecentFailures: number;
}

export interface MisunderstoodConceptInput extends SourcePrivacyFlags {
  conceptId: string;
  conceptName: string;
  comprehensionScore: number;
  unresolvedGap: boolean;
  isCorePrerequisite?: boolean;
  failedAssessmentCount?: number;
}

export interface ReviewBacklogInput extends SourcePrivacyFlags {
  overdueCount: number;
  rollingDailyThroughput: number;
  configuredCap?: number;
}

export interface CrossDocumentConnectionInput extends SourcePrivacyFlags {
  connectionId: string;
  conceptId: string;
  conceptName: string;
  documentIds: string[];
  alreadySynthesized?: boolean;
}

export interface DemonstratedPrerequisiteInput extends SourcePrivacyFlags {
  nodeId: string;
  conceptId: string;
  conceptName: string;
  studyPlanId: string;
  masteryScore: number;
  alreadySkippedOrCompleted?: boolean;
}

export interface FormulationOpportunityInput extends SourcePrivacyFlags {
  documentId: string;
  documentTitle: string;
  readingMinutesLast7Days: number;
  unformulatedExtractCount: number;
  existingCardCount: number;
}

export interface RelevantSmartFeedInput extends SourcePrivacyFlags {
  feedItemId: string;
  title: string;
  matchedGoalId?: string;
  matchedConceptId?: string;
  relevanceScore: number;
}

export interface ScheduleAdjustmentInput extends SourcePrivacyFlags {
  consecutiveAbandonedSessions: number;
  averageSessionDurationMinutes: number;
  accuracyDropInLongSessions?: number;
  recommendedTimeboxMinutes?: number;
}

export interface TransferOpportunityInput extends SourcePrivacyFlags {
  conceptId: string;
  conceptName: string;
  retentionScore: number;
  transferScore: number;
}

export interface CoachSnapshot {
  /** When true (active exam / strict assessment isolation), ALL coaching is suppressed. */
  examIsolationActive?: boolean;
  /** Optional map of entity/document IDs to privacy flags. */
  sourcePrivacyById?: Record<string, SourcePrivacyFlags>;
  approachingExams?: ApproachingExamSignalInput[];
  goals?: GoalPacingSignalInput[];
  failedCardClusters?: FailedCardClusterInput[];
  misunderstoodConcepts?: MisunderstoodConceptInput[];
  reviewBacklog?: ReviewBacklogInput | null;
  crossDocumentConnections?: CrossDocumentConnectionInput[];
  demonstratedPrerequisites?: DemonstratedPrerequisiteInput[];
  formulationOpportunities?: FormulationOpportunityInput[];
  relevantSmartFeeds?: RelevantSmartFeedInput[];
  scheduleMetrics?: ScheduleAdjustmentInput | null;
  transferOpportunities?: TransferOpportunityInput[];
}

export const DEFAULT_COACH_ENABLED_CATEGORIES: Record<CoachingSignalType, boolean> = {
  approaching_exam: true,
  deadline_infeasible: true,
  repeatedly_failed_cards: true,
  misunderstood_concept: true,
  review_backlog: true,
  stalled_goal: true,
  cross_document_connection: true,
  demonstrated_prerequisite: true,
  formulation_opportunity: true,
  relevant_smart_feed: true,
  schedule_adjustment: true,
  transfer_opportunity: true,
};

export const DEFAULT_COACH_PREFERENCES: CoachPreferences = {
  proactivity: "balanced",
  enabledCategories: { ...DEFAULT_COACH_ENABLED_CATEGORIES },
  aiExplanationsEnabled: false,
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "07:00",
  },
};

const SEVERITY_WEIGHT: Record<CoachingSeverity, number> = {
  urgent: 1.0,
  advisory: 0.65,
  info: 0.35,
};

const FORBIDDEN_HEALTH_KEY_PATTERN =
  /(^|[_\-.])(health|health_vault|healthvault|health_db|healthdb|biometric|wearable|heart_rate|heartrate|hrv|blood_pressure|bloodpressure|blood_glucose|bloodglucose|sleep_stage|sleepstage|sleep_duration|sleepduration|spo2|vo2_max|vo2max|resting_heart|restingheart|medication|symptom|medical_record|medicalrecord|menstrual|body_weight|bodyweight|calories_burned|caloriesburned|steps_count|stepscount)($|[_\-.])/i;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function computeRankScore(severity: CoachingSeverity, confidence: number, urgency: number): number {
  const score = SEVERITY_WEIGHT[severity] * 0.5 + clamp01(confidence) * 0.3 + clamp01(urgency) * 0.2;
  return round4(score);
}

function parseIsoMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function parseHhMmToMinutes(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function isWithinQuietHours(quietHours: CoachQuietHours | undefined, nowIso: string): boolean {
  if (!quietHours || !quietHours.enabled) return false;
  const startMin = parseHhMmToMinutes(quietHours.start);
  const endMin = parseHhMmToMinutes(quietHours.end);
  if (startMin === null || endMin === null || startMin === endMin) return false;

  const date = new Date(parseIsoMs(nowIso));
  const currentMin = date.getUTCHours() * 60 + date.getUTCMinutes();

  if (startMin < endMin) {
    return currentMin >= startMin && currentMin < endMin;
  }
  // Overnight quiet window (e.g. 22:00 -> 07:00)
  return currentMin >= startMin || currentMin < endMin;
}

function resolvePrivacy(
  itemFlags: SourcePrivacyFlags | undefined,
  evidenceRefs: CoachEvidenceRef[],
  sourcePrivacyById: Record<string, SourcePrivacyFlags> | undefined,
): { cloudExplanationAllowed: boolean; privacyReason: CoachingRecommendation["privacyReason"] } {
  let isLocalOnly = Boolean(itemFlags?.isLocalOnly);
  let isAiExcluded = Boolean(itemFlags?.isAiExcluded);

  for (const ref of evidenceRefs) {
    if (ref.isLocalOnly) isLocalOnly = true;
    if (ref.isAiExcluded) isAiExcluded = true;
    const mapped = sourcePrivacyById?.[ref.id];
    if (mapped?.isLocalOnly) isLocalOnly = true;
    if (mapped?.isAiExcluded) isAiExcluded = true;
  }

  if (isLocalOnly) {
    return { cloudExplanationAllowed: false, privacyReason: "local_only_source" };
  }
  if (isAiExcluded) {
    return { cloudExplanationAllowed: false, privacyReason: "ai_excluded_source" };
  }
  return { cloudExplanationAllowed: true, privacyReason: "allowed" };
}

function isCategoryEnabled(preferences: CoachPreferences, signalType: CoachingSignalType): boolean {
  const configured = preferences.enabledCategories?.[signalType];
  return configured !== false;
}

function isDismissedOrSnoozed(
  recommendation: Pick<CoachingRecommendation, "id" | "dedupeKey" | "signalType">,
  dismissals: readonly CoachDismissal[],
  nowMs: number,
): boolean {
  for (const dismissal of dismissals) {
    const matchesSignal =
      dismissal.signalId !== undefined &&
      (dismissal.signalId === recommendation.id || dismissal.signalId === recommendation.dedupeKey);
    const matchesCategory =
      dismissal.signalId === undefined &&
      dismissal.signalType !== undefined &&
      dismissal.signalType === recommendation.signalType;

    if (!matchesSignal && !matchesCategory) {
      continue;
    }

    if (dismissal.snoozeUntil === undefined || dismissal.snoozeUntil === null) {
      return true;
    }

    const snoozeUntilMs = parseIsoMs(dismissal.snoozeUntil);
    if (nowMs < snoozeUntilMs) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively checks whether an arbitrary value contains any forbidden Health Vault
 * field names. Useful for runtime verification and tests.
 */
export function containsHealthVaultFields(value: unknown): boolean {
  if (value === null || value === undefined || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsHealthVaultFields(item));
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_HEALTH_KEY_PATTERN.test(key)) {
      return true;
    }
    if (containsHealthVaultFields(nested)) {
      return true;
    }
  }
  return false;
}

function makeRecommendation(params: {
  signalType: CoachingSignalType;
  dedupeKey: string;
  severity: CoachingSeverity;
  confidence: number;
  urgency: number;
  title: string;
  summary: string;
  evidenceRefs: CoachEvidenceRef[];
  proposedAction: CoachProposedAction;
  itemFlags?: SourcePrivacyFlags;
  sourcePrivacyById?: Record<string, SourcePrivacyFlags>;
  nowIso: string;
}): CoachingRecommendation {
  const { cloudExplanationAllowed, privacyReason } = resolvePrivacy(
    params.itemFlags,
    params.evidenceRefs,
    params.sourcePrivacyById,
  );
  const id = `coach:${params.signalType}:${params.dedupeKey}`;
  const confidence = round4(clamp01(params.confidence));
  const urgency = round4(clamp01(params.urgency));

  return {
    id,
    signalType: params.signalType,
    dedupeKey: params.dedupeKey,
    severity: params.severity,
    confidence,
    urgency,
    rankScore: computeRankScore(params.severity, confidence, urgency),
    title: params.title,
    summary: params.summary,
    evidenceRefs: params.evidenceRefs.map((ref) => ({
      kind: ref.kind,
      id: ref.id,
      ...(ref.label !== undefined ? { label: ref.label } : {}),
      ...(ref.isLocalOnly ? { isLocalOnly: true } : {}),
      ...(ref.isAiExcluded ? { isAiExcluded: true } : {}),
    })),
    proposedAction: {
      ...params.proposedAction,
      requiresConfirmation: true,
      mutatesDirectly: false,
      params: { ...params.proposedAction.params },
    },
    cloudExplanationAllowed,
    privacyReason,
    generatedAt: params.nowIso,
  };
}

/**
 * Pure, deterministic coaching opportunity detector covering all 12 canonical
 * signal types. Never mutates input state or canonical domain stores.
 */
export function detectCoachingOpportunities(
  snapshot: CoachSnapshot,
  preferences: CoachPreferences,
  dismissals: readonly CoachDismissal[],
  nowIso: string,
): CoachingRecommendation[] {
  if (preferences.proactivity === "disabled") {
    return [];
  }

  if (snapshot.examIsolationActive === true) {
    return [];
  }

  if (
    preferences.proactivity !== "on_demand" &&
    isWithinQuietHours(preferences.quietHours, nowIso)
  ) {
    return [];
  }

  const nowMs = parseIsoMs(nowIso);
  const candidates: CoachingRecommendation[] = [];
  const sourcePrivacyById = snapshot.sourcePrivacyById;

  // 1. approaching_exam
  for (const exam of snapshot.approachingExams ?? []) {
    const examMs = parseIsoMs(exam.examDateIso);
    const daysUntil = (examMs - nowMs) / (1000 * 60 * 60 * 24);
    const targetReadiness = exam.targetReadiness ?? 0.85;
    if (daysUntil >= 0 && daysUntil <= 14 && exam.readinessScore < targetReadiness) {
      const daysRounded = Math.max(0, Math.ceil(daysUntil));
      const readinessGap = clamp01(targetReadiness - exam.readinessScore);
      const severity: CoachingSeverity = daysUntil <= 5 ? "urgent" : "advisory";
      const evidenceRefs: CoachEvidenceRef[] = [
        {
          kind: "exam",
          id: exam.examId,
          label: exam.title,
          isLocalOnly: exam.isLocalOnly,
          isAiExcluded: exam.isAiExcluded,
        },
        ...(exam.weakConceptIds ?? []).map((cid) => ({
          kind: "concept" as const,
          id: cid,
        })),
      ];
      candidates.push(
        makeRecommendation({
          signalType: "approaching_exam",
          dedupeKey: exam.examId,
          severity,
          confidence: 0.75 + readinessGap * 0.25,
          urgency: clamp01((14 - daysUntil) / 14),
          title: `Exam approaching: ${exam.title}`,
          summary: `${exam.title} is in ${daysRounded} day(s) with ${Math.round(exam.readinessScore * 100)}% readiness (target ${Math.round(targetReadiness * 100)}%).`,
          evidenceRefs,
          proposedAction: {
            actionType: "launch_exam_prep_session",
            targetDomain: "session_runtime",
            label: "Preview Exam Prep Session",
            previewDescription: `Launch a focused preparation session for "${exam.title}" targeting weak concepts.`,
            requiresConfirmation: true,
            mutatesDirectly: false,
            params: {
              examId: exam.examId,
              weakConceptIds: exam.weakConceptIds ?? [],
            },
          },
          itemFlags: exam,
          sourcePrivacyById,
          nowIso,
        }),
      );
    }
  }

  // 2. deadline_infeasible
  for (const goal of snapshot.goals ?? []) {
    if (goal.isPaused || !goal.targetDateIso) continue;
    const remaining = goal.remainingEffortMinutes ?? 0;
    const available = goal.availableMinutesAtPace ?? 0;
    if (remaining > 0 && remaining > available * 1.25) {
      const ratio = available > 0 ? remaining / available : 2.5;
      candidates.push(
        makeRecommendation({
          signalType: "deadline_infeasible",
          dedupeKey: goal.goalId,
          severity: "urgent",
          confidence: 0.85,
          urgency: clamp01((ratio - 1.0) / 1.5),
          title: `Goal deadline at risk: ${goal.title}`,
          summary: `Estimated ${Math.round(remaining)} min remaining exceeds ${Math.round(available)} min available at current pace before ${goal.targetDateIso}.`,
          evidenceRefs: [
            {
              kind: "goal",
              id: goal.goalId,
              label: goal.title,
              isLocalOnly: goal.isLocalOnly,
              isAiExcluded: goal.isAiExcluded,
            },
          ],
          proposedAction: {
            actionType: "adjust_goal_pace",
            targetDomain: "learning_goals",
            label: "Review Goal Pace & Target Date",
            previewDescription: `Preview adjusting daily effort or target date for "${goal.title}".`,
            requiresConfirmation: true,
            mutatesDirectly: false,
            params: {
              goalId: goal.goalId,
              remainingEffortMinutes: remaining,
              availableMinutesAtPace: available,
            },
          },
          itemFlags: goal,
          sourcePrivacyById,
          nowIso,
        }),
      );
    }
  }

  // 3. repeatedly_failed_cards
  for (const cluster of snapshot.failedCardClusters ?? []) {
    if (cluster.failedCardIds.length >= 3 || cluster.maxLapses >= 5) {
      const evidenceRefs: CoachEvidenceRef[] = [
        ...(cluster.conceptId
          ? [{ kind: "concept" as const, id: cluster.conceptId, label: cluster.conceptName }]
          : []),
        ...cluster.failedCardIds.map((cardId) => ({
          kind: "learning_item" as const,
          id: cardId,
          isLocalOnly: cluster.isLocalOnly,
          isAiExcluded: cluster.isAiExcluded,
        })),
      ];
      candidates.push(
        makeRecommendation({
          signalType: "repeatedly_failed_cards",
          dedupeKey: cluster.clusterId,
          severity: "advisory",
          confidence: clamp01(0.7 + Math.min(cluster.maxLapses, 10) * 0.03),
          urgency: clamp01(cluster.totalRecentFailures / 15),
          title: `Repeatedly failed cards: ${cluster.conceptName}`,
          summary: `${cluster.failedCardIds.length} card(s) around "${cluster.conceptName}" show repeated lapses (max ${cluster.maxLapses} lapses).`,
          evidenceRefs,
          proposedAction: {
            actionType: "open_conceptual_review",
            targetDomain: "remediation",
            label: "Open Conceptual Review",
            previewDescription: `Review the underlying concept "${cluster.conceptName}" before re-drilling ${cluster.failedCardIds.length} struggling card(s).`,
            requiresConfirmation: true,
            mutatesDirectly: false,
            params: {
              clusterId: cluster.clusterId,
              cardIds: cluster.failedCardIds,
              ...(cluster.conceptId ? { conceptId: cluster.conceptId } : {}),
            },
          },
          itemFlags: cluster,
          sourcePrivacyById,
          nowIso,
        }),
      );
    }
  }

  // 4. misunderstood_concept
  for (const concept of snapshot.misunderstoodConcepts ?? []) {
    if (concept.unresolvedGap && concept.comprehensionScore < 0.5) {
      const severity: CoachingSeverity = concept.isCorePrerequisite ? "urgent" : "advisory";
      candidates.push(
        makeRecommendation({
          signalType: "misunderstood_concept",
          dedupeKey: concept.conceptId,
          severity,
          confidence: clamp01(0.7 + (0.5 - concept.comprehensionScore)),
          urgency: concept.isCorePrerequisite ? 0.85 : 0.6,
          title: `Concept gap detected: ${concept.conceptName}`,
          summary: `"${concept.conceptName}" has an unresolved comprehension gap (${Math.round(concept.comprehensionScore * 100)}% understanding).`,
          evidenceRefs: [
            {
              kind: "concept",
              id: concept.conceptId,
              label: concept.conceptName,
              isLocalOnly: concept.isLocalOnly,
              isAiExcluded: concept.isAiExcluded,
            },
          ],
          proposedAction: {
            actionType: "schedule_remediation",
            targetDomain: "remediation",
            label: "Preview Concept Remediation",
            previewDescription: `Schedule a targeted remediation step for "${concept.conceptName}".`,
            requiresConfirmation: true,
            mutatesDirectly: false,
            params: {
              conceptId: concept.conceptId,
              comprehensionScore: concept.comprehensionScore,
            },
          },
          itemFlags: concept,
          sourcePrivacyById,
          nowIso,
        }),
      );
    }
  }

  // 5. review_backlog
  if (snapshot.reviewBacklog) {
    const backlog = snapshot.reviewBacklog;
    const throughput = Math.max(1, backlog.rollingDailyThroughput);
    const threshold = backlog.configuredCap ?? Math.max(20, Math.ceil(throughput * 2));
    if (backlog.overdueCount >= threshold) {
      const overloadRatio = backlog.overdueCount / throughput;
      candidates.push(
        makeRecommendation({
          signalType: "review_backlog",
          dedupeKey: "global_review_backlog",
          severity: "urgent",
          confidence: 0.9,
          urgency: clamp01(overloadRatio / 5),
          title: `Review backlog needs triage (${backlog.overdueCount} overdue)`,
          summary: `${backlog.overdueCount} overdue items exceed your rolling throughput of ${Math.round(throughput)}/day.`,
          evidenceRefs: [
            {
              kind: "session",
              id: "review_queue",
              label: `${backlog.overdueCount} overdue items`,
              isLocalOnly: backlog.isLocalOnly,
              isAiExcluded: backlog.isAiExcluded,
            },
          ],
          proposedAction: {
            actionType: "open_backlog_triage_session",
            targetDomain: "review_queue",
            label: "Preview Backlog Triage Session",
            previewDescription: `Start a 15-minute Backlog Triage session prioritizing high-value overdue reviews.`,
            requiresConfirmation: true,
            mutatesDirectly: false,
            params: {
              profile: "backlog_triage",
              overdueCount: backlog.overdueCount,
            },
          },
          itemFlags: backlog,
          sourcePrivacyById,
          nowIso,
        }),
      );
    }
  }

  // 6. stalled_goal
  for (const goal of snapshot.goals ?? []) {
    if (goal.isPaused) continue;
    const inactiveDays = goal.daysSinceLastActivity ?? 0;
    if (inactiveDays >= 7) {
      candidates.push(
        makeRecommendation({
          signalType: "stalled_goal",
          dedupeKey: goal.goalId,
          severity: inactiveDays >= 14 ? "advisory" : "info",
          confidence: 0.8,
          urgency: clamp01(inactiveDays / 21),
          title: `Goal ready for a gentle restart: ${goal.title}`,
          summary: `No recorded activity on "${goal.title}" for ${inactiveDays} day(s). A short 10-minute session can rebuild momentum.`,
          evidenceRefs: [
            {
              kind: "goal",
              id: goal.goalId,
              label: goal.title,
              isLocalOnly: goal.isLocalOnly,
              isAiExcluded: goal.isAiExcluded,
            },
          ],
          proposedAction: {
            actionType: "launch_restart_session",
            targetDomain: "session_runtime",
            label: "Preview 10-Minute Restart Session",
            previewDescription: `Start a lightweight 10-minute restart session for "${goal.title}".`,
            requiresConfirmation: true,
            mutatesDirectly: false,
            params: {
              goalId: goal.goalId,
              timeBudgetMinutes: 10,
            },
          },
          itemFlags: goal,
          sourcePrivacyById,
          nowIso,
        }),
      );
    }
  }

  // 7. cross_document_connection
  for (const conn of snapshot.crossDocumentConnections ?? []) {
    if (!conn.alreadySynthesized && conn.documentIds.length >= 2) {
      candidates.push(
        makeRecommendation({
          signalType: "cross_document_connection",
          dedupeKey: conn.connectionId,
          severity: "info",
          confidence: clamp01(0.65 + Math.min(conn.documentIds.length, 5) * 0.06),
          urgency: 0.4,
          title: `Cross-document connection: ${conn.conceptName}`,
          summary: `"${conn.conceptName}" appears across ${conn.documentIds.length} documents and can be synthesized into a unified note.`,
          evidenceRefs: [
            { kind: "concept", id: conn.conceptId, label: conn.conceptName },
            ...conn.documentIds.map((docId) => ({
              kind: "document" as const,
              id: docId,
              isLocalOnly: conn.isLocalOnly,
              isAiExcluded: conn.isAiExcluded,
            })),
          ],
          proposedAction: {
            actionType: "open_cross_document_synthesis",
            targetDomain: "knowledge_graph",
            label: "Preview Cross-Document Synthesis",
            previewDescription: `Compare and link "${conn.conceptName}" across ${conn.documentIds.length} documents.`,
            requiresConfirmation: true,
            mutatesDirectly: false,
            params: {
              conceptId: conn.conceptId,
              documentIds: conn.documentIds,
            },
          },
          itemFlags: conn,
          sourcePrivacyById,
          nowIso,
        }),
      );
    }
  }

  // 8. demonstrated_prerequisite
  for (const prereq of snapshot.demonstratedPrerequisites ?? []) {
    if (!prereq.alreadySkippedOrCompleted && prereq.masteryScore >= 0.8) {
      candidates.push(
        makeRecommendation({
          signalType: "demonstrated_prerequisite",
          dedupeKey: `${prereq.studyPlanId}:${prereq.nodeId}`,
          severity: "info",
          confidence: clamp01(prereq.masteryScore),
          urgency: 0.45,
          title: `Prerequisite already demonstrated: ${prereq.conceptName}`,
          summary: `Prior evidence shows ${Math.round(prereq.masteryScore * 100)}% mastery of "${prereq.conceptName}". You can fast-track this node.`,
          evidenceRefs: [
            {
              kind: "study_plan_node",
              id: prereq.nodeId,
              label: prereq.conceptName,
              isLocalOnly: prereq.isLocalOnly,
              isAiExcluded: prereq.isAiExcluded,
            },
            {
              kind: "concept",
              id: prereq.conceptId,
              label: prereq.conceptName,
            },
          ],
          proposedAction: {
            actionType: "offer_prerequisite_fast_track",
            targetDomain: "study_plan",
            label: "Preview Fast-Track Skip",
            previewDescription: `Mark "${prereq.conceptName}" as satisfied from prior mastery evidence in your study plan.`,
            requiresConfirmation: true,
            mutatesDirectly: false,
            params: {
              studyPlanId: prereq.studyPlanId,
              nodeId: prereq.nodeId,
              conceptId: prereq.conceptId,
            },
          },
          itemFlags: prereq,
          sourcePrivacyById,
          nowIso,
        }),
      );
    }
  }

  // 9. formulation_opportunity
  for (const form of snapshot.formulationOpportunities ?? []) {
    const highPassiveReading =
      form.readingMinutesLast7Days >= 60 && form.existingCardCount === 0;
    const unformulatedExtracts = form.unformulatedExtractCount >= 3;
    if (highPassiveReading || unformulatedExtracts) {
      candidates.push(
        makeRecommendation({
          signalType: "formulation_opportunity",
          dedupeKey: form.documentId,
          severity: "info",
          confidence: 0.78,
          urgency: clamp01(form.unformulatedExtractCount / 10 + form.readingMinutesLast7Days / 240),
          title: `Formulate active recall from "${form.documentTitle}"`,
          summary: `${form.unformulatedExtractCount} unformulated extract(s) and ${Math.round(form.readingMinutesLast7Days)} min reading in "${form.documentTitle}" have few active recall prompts.`,
          evidenceRefs: [
            {
              kind: "document",
              id: form.documentId,
              label: form.documentTitle,
              isLocalOnly: form.isLocalOnly,
              isAiExcluded: form.isAiExcluded,
            },
          ],
          proposedAction: {
            actionType: "open_formulation_queue",
            targetDomain: "formulation",
            label: "Preview Formulation Queue",
            previewDescription: `Turn key extracts from "${form.documentTitle}" into atomic recall prompts.`,
            requiresConfirmation: true,
            mutatesDirectly: false,
            params: {
              documentId: form.documentId,
              unformulatedExtractCount: form.unformulatedExtractCount,
            },
          },
          itemFlags: form,
          sourcePrivacyById,
          nowIso,
        }),
      );
    }
  }

  // 10. relevant_smart_feed
  for (const feed of snapshot.relevantSmartFeeds ?? []) {
    if (feed.relevanceScore >= 0.75 && (feed.matchedGoalId || feed.matchedConceptId)) {
      const evidenceRefs: CoachEvidenceRef[] = [
        {
          kind: "smart_feed_item",
          id: feed.feedItemId,
          label: feed.title,
          isLocalOnly: feed.isLocalOnly,
          isAiExcluded: feed.isAiExcluded,
        },
        ...(feed.matchedGoalId
          ? [{ kind: "goal" as const, id: feed.matchedGoalId }]
          : []),
        ...(feed.matchedConceptId
          ? [{ kind: "concept" as const, id: feed.matchedConceptId }]
          : []),
      ];
      candidates.push(
        makeRecommendation({
          signalType: "relevant_smart_feed",
          dedupeKey: feed.feedItemId,
          severity: "info",
          confidence: clamp01(feed.relevanceScore),
          urgency: 0.35,
          title: `Relevant Smart Feed reading: ${feed.title}`,
          summary: `"${feed.title}" closely matches your active learning focus (${Math.round(feed.relevanceScore * 100)}% relevance).`,
          evidenceRefs,
          proposedAction: {
            actionType: "open_smart_feed_items",
            targetDomain: "smart_feeds",
            label: "Preview Smart Feed Item",
            previewDescription: `Open "${feed.title}" to inspect or queue it for study.`,
            requiresConfirmation: true,
            mutatesDirectly: false,
            params: {
              feedItemId: feed.feedItemId,
              ...(feed.matchedGoalId ? { matchedGoalId: feed.matchedGoalId } : {}),
              ...(feed.matchedConceptId ? { matchedConceptId: feed.matchedConceptId } : {}),
            },
          },
          itemFlags: feed,
          sourcePrivacyById,
          nowIso,
        }),
      );
    }
  }

  // 11. schedule_adjustment
  if (snapshot.scheduleMetrics) {
    const sched = snapshot.scheduleMetrics;
    const fragmented = sched.consecutiveAbandonedSessions >= 3;
    const fatiguedLongBlock =
      sched.averageSessionDurationMinutes > 90 && (sched.accuracyDropInLongSessions ?? 0) >= 0.15;
    if (fragmented || fatiguedLongBlock) {
      const recommendedMinutes = sched.recommendedTimeboxMinutes ?? 20;
      candidates.push(
        makeRecommendation({
          signalType: "schedule_adjustment",
          dedupeKey: "session_timebox_adjustment",
          severity: "advisory",
          confidence: 0.8,
          urgency: fragmented ? 0.65 : 0.55,
          title: "Consider shorter study blocks",
          summary: fragmented
            ? `${sched.consecutiveAbandonedSessions} recent sessions ended early. Try a ${recommendedMinutes}-minute timebox.`
            : `Long sessions (${Math.round(sched.averageSessionDurationMinutes)} min) show declining accuracy. Try ${recommendedMinutes}-minute blocks.`,
          evidenceRefs: [
            {
              kind: "session",
              id: "recent_sessions",
              isLocalOnly: sched.isLocalOnly,
              isAiExcluded: sched.isAiExcluded,
            },
          ],
          proposedAction: {
            actionType: "adjust_session_schedule",
            targetDomain: "session_runtime",
            label: `Preview ${recommendedMinutes}-Minute Timebox`,
            previewDescription: `Adjust default session timebox to ${recommendedMinutes} minutes for steadier completion.`,
            requiresConfirmation: true,
            mutatesDirectly: false,
            params: {
              recommendedTimeboxMinutes: recommendedMinutes,
            },
          },
          itemFlags: sched,
          sourcePrivacyById,
          nowIso,
        }),
      );
    }
  }

  // 12. transfer_opportunity
  for (const transfer of snapshot.transferOpportunities ?? []) {
    if (transfer.retentionScore >= 0.75 && transfer.transferScore < 0.45) {
      candidates.push(
        makeRecommendation({
          signalType: "transfer_opportunity",
          dedupeKey: transfer.conceptId,
          severity: "info",
          confidence: clamp01(0.7 + (transfer.retentionScore - transfer.transferScore) * 0.3),
          urgency: 0.5,
          title: `Ready for transfer practice: ${transfer.conceptName}`,
          summary: `Strong recall (${Math.round(transfer.retentionScore * 100)}%) on "${transfer.conceptName}", but transfer/application is ${Math.round(transfer.transferScore * 100)}%.`,
          evidenceRefs: [
            {
              kind: "concept",
              id: transfer.conceptId,
              label: transfer.conceptName,
              isLocalOnly: transfer.isLocalOnly,
              isAiExcluded: transfer.isAiExcluded,
            },
          ],
          proposedAction: {
            actionType: "launch_transfer_practice",
            targetDomain: "session_runtime",
            label: "Preview Transfer Practice",
            previewDescription: `Launch an applied problem-solving exercise to strengthen transfer for "${transfer.conceptName}".`,
            requiresConfirmation: true,
            mutatesDirectly: false,
            params: {
              conceptId: transfer.conceptId,
              retentionScore: transfer.retentionScore,
              transferScore: transfer.transferScore,
            },
          },
          itemFlags: transfer,
          sourcePrivacyById,
          nowIso,
        }),
      );
    }
  }

  // Filter by enabled categories & dismissals/snoozes
  const filtered = candidates.filter(
    (rec) =>
      isCategoryEnabled(preferences, rec.signalType) &&
      !isDismissedOrSnoozed(rec, dismissals, nowMs),
  );

  // Deduplicate by id (keep highest rankScore deterministically)
  const dedupedById = new Map<string, CoachingRecommendation>();
  for (const rec of filtered) {
    const existing = dedupedById.get(rec.id);
    if (!existing || rec.rankScore > existing.rankScore) {
      dedupedById.set(rec.id, rec);
    }
  }

  // Deterministic sort: rankScore desc -> signalType asc -> id asc
  const sorted = Array.from(dedupedById.values()).sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    if (a.signalType !== b.signalType) return a.signalType.localeCompare(b.signalType);
    return a.id.localeCompare(b.id);
  });

  const cap = PROACTIVITY_MAX_RECOMMENDATIONS[preferences.proactivity];
  return sorted.slice(0, cap);
}
