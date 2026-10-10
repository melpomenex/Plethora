import { applyAutoPostponePlan, getAutoPostponeCandidates } from "../api/autoPostpone";
import { t } from "./i18n";
import { localDateKey } from "./scheduleViewModel";
import { parseScheduleDate, toDateString } from "./scheduleUtils";
import { whenBackendReady } from "./tauri";
import { useSettingsStore } from "../stores/settingsStore";
import { useStartupStore } from "../stores/startupStore";
import { useCollectionStore } from "../stores/collectionStore";
import { useQueueStore } from "../stores/queueStore";
import { ToastType, useToastStore } from "../components/common/Toast";
import { planAutoPostpone, type AutoPostponeSkipReason } from "./autoPostponePlanner";

type ReportedSkipReason = AutoPostponeSkipReason | "changed-before-commit";
const skipReasonTranslation: Record<ReportedSkipReason, string> = {
  "invalid-date": "postpone.autoPostponeReasonInvalidDate",
  "unsupported-video-extract": "postpone.autoPostponeReasonVideoUnsupported",
  suspended: "postpone.autoPostponeReasonSuspended",
  archived: "postpone.autoPostponeReasonArchived",
  dismissed: "postpone.autoPostponeReasonDismissed",
  inactive: "postpone.autoPostponeReasonInactive",
  "postpone-rules": "postpone.autoPostponeReasonRules",
  "changed-before-commit": "postpone.autoPostponeReasonChanged",
};

export interface AutoPostponeSessionResult {
  status: "disabled" | "completed" | "failed";
  discovered: number;
  postponed: number;
  skipped: number;
  skipReasons: Partial<Record<ReportedSkipReason, number>>;
  failed: number;
  remainingOverdue: number | null;
  distribution: Record<string, number>;
}

let sessionPromise: Promise<AutoPostponeSessionResult> | null = null;

async function waitForSettingsHydration(): Promise<void> {
  if (useSettingsStore.persist.hasHydrated()) return;
  await new Promise<void>((resolve) => {
    let unsubscribe = () => {};
    const finish = () => {
      unsubscribe();
      resolve();
    };
    unsubscribe = useSettingsStore.persist.onFinishHydration(finish);
    if (useSettingsStore.persist.hasHydrated()) finish();
  });
}

function countOverdue(candidates: Array<{ dueDate: string | null }>, todayKey: string): number {
  return candidates.filter(({ dueDate }) => {
    if (!dueDate) return false;
    const parsed = parseScheduleDate(dueDate);
    if (!parsed) return false;
    const key = toDateString(dueDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dueDate) && localDateKey(parsed) !== dueDate) return false;
    return key < todayKey;
  }).length;
}

function notifyResult(result: AutoPostponeSessionResult): void {
  if (result.status === "disabled") return;
  if (result.status === "failed") {
    useToastStore.getState().addToast({
      type: ToastType.Error,
      title: t("postpone.autoPostponeFailedTitle"),
      message: result.discovered > 0
        ? t("postpone.autoPostponeResultMessage", {
            discovered: result.discovered,
            postponed: result.postponed,
            skipped: result.skipped,
            failed: result.failed,
            remaining: result.remainingOverdue ?? "—",
            skipReasons: formatSkipReasons(result.skipReasons),
            distribution: Object.entries(result.distribution)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([date, count]) => `${date}: ${count}`)
              .join(", ") || t("postpone.autoPostponeNoDistribution"),
          })
        : t("postpone.autoPostponeFailedMessage"),
      feedback: { origin: "system" },
    });
    return;
  }
  if (result.discovered === 0) return;

  const distribution = Object.entries(result.distribution)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => {
      const parsed = parseScheduleDate(date);
      const label = parsed
        ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(parsed)
        : date;
      return `${label}: ${count}`;
    })
    .join(", ");
  useToastStore.getState().addToast({
    type: result.failed > 0 ? ToastType.Warning : ToastType.Info,
    title: t("postpone.autoPostponeResultTitle"),
    message: t("postpone.autoPostponeResultMessage", {
      discovered: result.discovered,
      postponed: result.postponed,
      skipped: result.skipped,
      failed: result.failed,
      remaining: result.remainingOverdue ?? "—",
      skipReasons: formatSkipReasons(result.skipReasons),
      distribution: distribution || t("postpone.autoPostponeNoDistribution"),
    }),
    duration: 10000,
    feedback: { origin: "system" },
  });
}

function formatSkipReasons(reasons: Partial<Record<ReportedSkipReason, number>>): string {
  const summary = Object.entries(reasons)
    .filter((entry): entry is [ReportedSkipReason, number] => typeof entry[1] === "number" && entry[1] > 0)
    .map(([reason, count]) => `${t(skipReasonTranslation[reason])}: ${count}`)
    .join(", ");
  return summary || t("postpone.autoPostponeNoSkipReasons");
}

async function runSession(): Promise<AutoPostponeSessionResult> {
  let discovered = 0;
  let postponed = 0;
  let skipped = 0;
  let failed = 0;
  let remainingOverdue: number | null = null;
  let skipReasons: Partial<Record<ReportedSkipReason, number>> = {};
  let distribution: Record<string, number> = {};
  let originalOverdue: number | null = null;
  let todayKey: string | null = null;
  try {
    await whenBackendReady();
    await waitForSettingsHydration();
    const settings = useSettingsStore.getState().settings;
    if (!settings.learning.postpone.autoPostponeEnabled) {
      return { status: "disabled", discovered: 0, postponed: 0, skipped: 0, skipReasons: {}, failed: 0, remainingOverdue: null, distribution: {} };
    }

    await useStartupStore.getState().ensureStartup("queue", { queueMode: "due-today" });
    const collectionStore = useCollectionStore.getState();
    if (!collectionStore.loaded) await collectionStore.loadCollections();
    const collectionId = useCollectionStore.getState().activeCollectionId;
    const today = new Date();
    todayKey = localDateKey(today);
    const localMidnightIso = (date: Date) =>
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
    const windowStart = localMidnightIso(today);
    // The planner still admits only tomorrow through day +30; this broad
    // native query bound absorbs timestamp offset differences at the boundary.
    const windowEnd = localMidnightIso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 32));
    const candidateSet = await getAutoPostponeCandidates(collectionId, windowStart, windowEnd);
    const plan = planAutoPostpone(candidateSet.candidates, candidateSet.scheduledDates, today, settings.learning.postpone);
    discovered = plan.discovered;
    skipped = plan.skipped;
    skipReasons = { ...plan.skipReasons };
    distribution = plan.distribution;
    originalOverdue = countOverdue(candidateSet.candidates, todayKey);
    remainingOverdue = originalOverdue;
    // On transaction failure the plan is atomic, so every planned item is
    // still overdue and is reported as failed.
    failed = plan.items.length;
    const applied = plan.items.length > 0
      ? await applyAutoPostponePlan(collectionId, plan.items)
      : { outcomes: [] };
    postponed = applied.outcomes.filter((outcome) => outcome.status === "postponed").length;
    const staleSkipped = applied.outcomes.filter((outcome) => outcome.status === "skipped").length;
    skipped += staleSkipped;
    if (staleSkipped > 0) skipReasons["changed-before-commit"] = staleSkipped;
    failed = 0;

    if (postponed > 0) {
      await Promise.all([
        useQueueStore.getState().reloadForCurrentMode(),
        useQueueStore.getState().loadStats(),
      ]);
    }
    if (plan.items.length > 0) {
      try {
        const remaining = await getAutoPostponeCandidates(collectionId, windowStart, windowEnd);
        remainingOverdue = countOverdue(remaining.candidates, todayKey);
      } catch (error) {
        console.warn("Could not refresh the remaining auto-postpone count:", error);
        remainingOverdue = Math.max(0, (originalOverdue ?? 0) - postponed);
      }
    }
    return { status: "completed", discovered, postponed, skipped, skipReasons, failed, remainingOverdue, distribution };
  } catch (error) {
    console.error("Automatic postpone session failed:", error);
    return {
      status: "failed",
      discovered,
      postponed,
      skipped,
      skipReasons,
      failed,
      remainingOverdue: todayKey && originalOverdue !== null
        ? Math.max(0, originalOverdue - postponed)
        : remainingOverdue,
      distribution,
    };
  }
}

/** One shared attempt per app process. Queue and Schedule callers join it. */
export function runAutoPostponeSession(): Promise<AutoPostponeSessionResult> {
  if (sessionPromise) return sessionPromise;
  sessionPromise = runSession()
    .then((result) => {
      notifyResult(result);
      return result;
    })
    .catch((error: unknown) => {
      console.error("Automatic postpone session failed:", error);
      const result: AutoPostponeSessionResult = {
        status: "failed", discovered: 0, postponed: 0, skipped: 0, skipReasons: {},
        failed: 0, remainingOverdue: null, distribution: {},
      };
      notifyResult(result);
      return result;
    });
  return sessionPromise;
}

/** Test-only reset keeps module singleton behavior easy to cover. */
export function resetAutoPostponeSessionForTests(): void {
  sessionPromise = null;
}
