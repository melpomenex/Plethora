import { getQueueStats } from "../../api/queue";
import { useSettingsStore } from "../../stores/settingsStore";
import { emitFeedback } from "./orchestrator";

const DEFAULT_REMINDER_TIME = "09:00";
const DAY_MS = 24 * 60 * 60 * 1000;

type TimerHandle = ReturnType<typeof setTimeout>;

let timer: TimerHandle | null = null;
let nextFireAt = 0;
let stopScheduler: (() => void) | null = null;
let checkInFlight = false;

function parseReminderTime(reminderTime: string): { hour: number; minute: number } {
  const [hour, minute] = reminderTime.split(":").map(Number);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return { hour: 9, minute: 0 };
  }
  return { hour, minute };
}

/** Return the delay until the next configured local-time reminder. */
export function getNextReminderDelay(
  now = new Date(),
  reminderTime = DEFAULT_REMINDER_TIME,
): number {
  const { hour, minute } = parseReminderTime(reminderTime);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setTime(next.getTime() + DAY_MS);
  return Math.max(0, next.getTime() - now.getTime());
}

function clearScheduledTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  nextFireAt = 0;
}

function scheduleNext(): void {
  clearScheduledTimer();
  const { enabled, studyReminders, reminderTime } = useSettingsStore.getState().settings.notifications;
  if (!enabled || !studyReminders) return;

  const now = new Date();
  const delay = getNextReminderDelay(now, reminderTime);
  nextFireAt = now.getTime() + delay;
  timer = setTimeout(() => {
    timer = null;
    nextFireAt = 0;
    void checkAndDeliverReminder();
  }, delay);
}

async function checkAndDeliverReminder(): Promise<void> {
  if (checkInFlight) return;
  checkInFlight = true;

  try {
    const { enabled, studyReminders } = useSettingsStore.getState().settings.notifications;
    if (!enabled || !studyReminders) return;

    const stats = await getQueueStats();
    const dueCount = Math.max(0, stats.due_today);
    if (dueCount > 0) {
      await emitFeedback("reminder.reviews-due", { dueCount });
    }
  } catch (error) {
    console.warn("[feedback] Failed to check scheduled reviews:", error);
  } finally {
    checkInFlight = false;
    scheduleNext();
  }
}

/** Start the in-app daily reminder loop. Safe to call more than once. */
export function startReminderScheduler(): () => void {
  stopScheduler?.();

  const handleVisibilityChange = () => {
    if (document.visibilityState !== "visible" || nextFireAt === 0) return;
    if (Date.now() >= nextFireAt) void checkAndDeliverReminder();
  };

  const unsubscribe = useSettingsStore.subscribe(() => {
    scheduleNext();
  });
  document.addEventListener("visibilitychange", handleVisibilityChange);
  scheduleNext();

  const stop = () => {
    clearScheduledTimer();
    unsubscribe();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    if (stopScheduler === stop) stopScheduler = null;
  };
  stopScheduler = stop;
  return stop;
}

