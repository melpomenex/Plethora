import {
  sendNotification,
  type NotificationOptions,
} from "../../utils/notificationService";
import {
  FEEDBACK_SOUND_FILES,
  NOTIFICATION_SOUND_FILES,
  playFile,
  playNotificationDefaultTone,
  vibrate,
  type FeedbackType,
} from "../../utils/soundService";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  ToastType,
  useToastStore,
  type ToastData,
} from "../../components/common/Toast";
import type { FeedbackEventId, FeedbackEventPayloads } from "./events";
import {
  FEEDBACK_POLICY_REGISTRY,
  SOUND_ROLE_GATE,
  SOUND_ROLE_TO_FEEDBACK_TYPE,
  type FeedbackPolicy,
  type SoundRole,
} from "./policy";
import {
  queryAsyncCapabilities,
  type AsyncFeedbackCapabilities,
} from "./capabilities";

export type FeedbackChannel = "toast" | "sound" | "haptic" | "os" | "badge";

export type FeedbackSuppressionReason =
  | "policy"
  | "settings"
  | "capability"
  | "focus"
  | "active-review"
  | "quiet-hours"
  | "cooldown"
  | "daily-cooldown"
  | "no-channels";

export interface FeedbackResolution {
  channels: FeedbackChannel[];
  suppressedBy?: FeedbackSuppressionReason;
}

export interface FeedbackToastOptions {
  title?: string;
  message?: string;
  duration?: number;
  type?: ToastType;
  action?: ToastData["action"];
  undoLabel?: string;
}

export interface FeedbackNotificationOptions {
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  requireInteraction?: boolean;
  actions?: NotificationOptions["actions"];
}

/** Presentation details may be supplied by a localized call site. */
export interface FeedbackEmitOptions {
  dedupeKey?: string;
  toast?: FeedbackToastOptions;
  notification?: FeedbackNotificationOptions;
  /** FocusTimer's local notification toggle is an event fact, not a channel choice. */
  notificationsEnabled?: boolean;
}

type NotificationSettings = ReturnType<typeof useSettingsStore.getState>["settings"]["notifications"];
type PresentablePayload = {
  title?: unknown;
  message?: unknown;
  onUndo?: unknown;
  dedupeKey?: unknown;
};

const LAST_REMINDER_KEY = "incrementum-feedback:last-reminder";
const DEBUG_KEY = "incrementum-feedback:debug";

const ROLE_LOUDNESS: Record<SoundRole, number> = {
  acknowledge: 0.5,
  confirm: 0.8,
  complete: 1,
  celebrate: 1,
  attention: 1,
  warning: 0.9,
  error: 0.9,
};

const ROLE_DURATION_MS: Record<SoundRole, number> = {
  acknowledge: 150,
  confirm: 500,
  complete: 900,
  celebrate: 1200,
  attention: 1000,
  warning: 400,
  error: 400,
};

const ROLE_PRIORITY: Record<SoundRole, number> = {
  acknowledge: 0,
  confirm: 1,
  attention: 1,
  complete: 2,
  celebrate: 2,
  warning: 3,
  error: 4,
};

const cooldowns = new Map<string, number>();
let activeReviewSession = false;
let windowFocused = true;
let activeSound: { role: SoundRole; priority: number; until: number } | null = null;

function withDebug(eventId: FeedbackEventId, resolution: FeedbackResolution): FeedbackResolution {
  try {
    if (localStorage.getItem(DEBUG_KEY) !== "1") return resolution;
    const channels = resolution.channels.length > 0 ? resolution.channels.join(",") : "none";
    const suppressedBy = resolution.suppressedBy ?? "none";
    console.debug(`[feedback] ${eventId} → ${channels} | suppressed-by=${suppressedBy}`);
  } catch {
    // Debug output must never affect feedback delivery.
  }
  return resolution;
}

if (typeof document !== "undefined") {
  windowFocused = typeof document.hasFocus === "function" ? document.hasFocus() : true;
}

if (typeof window !== "undefined") {
  window.addEventListener("focus", () => {
    windowFocused = true;
  });
  window.addEventListener("blur", () => {
    windowFocused = false;
  });
}

/** Set while a review session is mounted so reminders do not interrupt it. */
export function setActiveReviewSession(active: boolean): void {
  activeReviewSession = active;
}

/** Descriptive alias for call sites that prefer the state-oriented name. */
export const setReviewSessionActive = setActiveReviewSession;

function isForeground(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible" && windowFocused;
}

function isInQuietHours(settings: NotificationSettings, now = new Date()): boolean {
  if (!settings.quietHoursEnabled) return false;

  const [startHour, startMinute] = settings.quietHoursStart.split(":").map(Number);
  const [endHour, endMinute] = settings.quietHoursEnd.split(":").map(Number);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return false;

  const currentTime = now.getHours() * 60 + now.getMinutes();
  const startTime = startHour * 60 + startMinute;
  const endTime = endHour * 60 + endMinute;

  if (startTime < endTime) {
    return currentTime >= startTime && currentTime < endTime;
  }
  return currentTime >= startTime || currentTime < endTime;
}

function calendarDay(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hasReminderFiredToday(): boolean {
  try {
    return localStorage.getItem(LAST_REMINDER_KEY) === calendarDay();
  } catch {
    return false;
  }
}

function markReminderFiredToday(): void {
  try {
    localStorage.setItem(LAST_REMINDER_KEY, calendarDay());
  } catch {
    // Storage is optional; the in-memory cooldown still applies.
  }
}

function getSettingsGate(
  eventId: FeedbackEventId,
  settings: NotificationSettings,
  payload: FeedbackEventPayloads[FeedbackEventId],
  options?: FeedbackEmitOptions,
): boolean {
  if (eventId === "reminder.reviews-due") {
    return settings.enabled && settings.studyReminders;
  }
  if (eventId === "focus.phase-completed" && options?.notificationsEnabled === false) {
    return false;
  }
  void payload;
  return settings.enabled;
}

function canUseOsNotification(
  eventId: FeedbackEventId,
  policy: FeedbackPolicy,
  settings: NotificationSettings,
  capabilities: AsyncFeedbackCapabilities,
  payload: FeedbackEventPayloads[FeedbackEventId],
  options?: FeedbackEmitOptions,
): boolean {
  if (policy.osNotification === "never") return false;
  if (!getSettingsGate(eventId, settings, payload, options)) return false;
  if (capabilities.notificationPermission !== "granted") return false;

  if (policy.osVisibility === "hidden-only" && isForeground()) return false;
  if (policy.osVisibility === "never") return false;
  return true;
}

function roleIsEnabled(role: SoundRole, settings: NotificationSettings): boolean {
  return SOUND_ROLE_GATE[role] === "feedback"
    ? settings.feedbackSoundsEnabled
    : settings.soundEnabled;
}

function getPayloadPresentation(payload: FeedbackEventPayloads[FeedbackEventId]): PresentablePayload {
  return payload as unknown as PresentablePayload;
}

function defaultToast(eventId: FeedbackEventId, payload: FeedbackEventPayloads[FeedbackEventId]): FeedbackToastOptions {
  const presentable = getPayloadPresentation(payload);
  const payloadTitle = typeof presentable.title === "string" ? presentable.title : undefined;
  const payloadMessage = typeof presentable.message === "string" ? presentable.message : undefined;

  if (eventId === "reminder.reviews-due") {
    const dueCount = (payload as FeedbackEventPayloads["reminder.reviews-due"]).dueCount;
    return {
      type: ToastType.Info,
      title: payloadTitle ?? "Reviews due",
      message: payloadMessage ?? `You have ${dueCount} cards due for review.`,
    };
  }
  if (eventId === "sync.corruption") {
    return {
      type: ToastType.Error,
      title: payloadTitle ?? "Sync needs attention",
      message: payloadMessage ?? "Your local data is safe. Open settings to review recovery options.",
      duration: 0,
    };
  }
  if (eventId === "db.recovered-after-quarantine") {
    return {
      type: ToastType.Error,
      title: payloadTitle ?? "Database recovered",
      message: payloadMessage,
      duration: 0,
    };
  }
  if (eventId === "backup.auto-backup-found") {
    return {
      type: ToastType.Success,
      title: payloadTitle ?? "Backup found",
      message: payloadMessage,
      duration: 0,
    };
  }
  if (eventId === "update.available") {
    return {
      type: ToastType.Info,
      title: payloadTitle ?? "Update available",
      message: payloadMessage,
      duration: 15000,
    };
  }
  if (eventId === "import.failed" || eventId === "transcription.failed") {
    return {
      type: ToastType.Error,
      title: payloadTitle ?? "Something went wrong",
      message: payloadMessage,
    };
  }
  if (eventId === "review.card-action") {
    const actionPayload = payload as FeedbackEventPayloads["review.card-action"];
    return {
      type: actionPayload.succeeded ? ToastType.Success : ToastType.Error,
      title: actionPayload.title,
      message: actionPayload.message,
      action: typeof actionPayload.onUndo === "function"
        ? { label: "Undo", onClick: actionPayload.onUndo }
        : undefined,
    };
  }

  return {
    type: ToastType.Info,
    title: payloadTitle ?? "Incrementum",
    message: payloadMessage,
  };
}

function defaultNotification(
  eventId: FeedbackEventId,
  payload: FeedbackEventPayloads[FeedbackEventId],
): FeedbackNotificationOptions {
  const toast = defaultToast(eventId, payload);
  if (eventId === "focus.phase-completed") {
    const phase = payload as FeedbackEventPayloads["focus.phase-completed"];
    return { title: "Focus phase complete", body: phase.phaseLabel };
  }
  if (eventId === "review.session-completed") {
    const session = payload as FeedbackEventPayloads["review.session-completed"];
    return {
      title: "Review complete",
      body: `${session.reviewsCompleted} reviews completed.`,
    };
  }
  if (eventId === "reminder.reviews-due") {
    const reminder = payload as FeedbackEventPayloads["reminder.reviews-due"];
    return {
      title: "Reviews due",
      body: `You have ${reminder.dueCount} cards due for review.`,
    };
  }
  return { title: toast.title, body: toast.message };
}

function shouldStartSound(role: SoundRole): boolean {
  const now = Date.now();
  const priority = ROLE_PRIORITY[role];
  if (activeSound && activeSound.until > now) {
    const canLayerMilestone = role === "celebrate" && activeSound.role === "complete";
    if (!canLayerMilestone && priority < activeSound.priority) return false;
  }

  activeSound = {
    role,
    priority,
    until: now + ROLE_DURATION_MS[role],
  };
  return true;
}

function deliverSound(role: SoundRole, settings: NotificationSettings): boolean {
  if (!roleIsEnabled(role, settings)) return false;
  if (role === "attention" && settings.notificationSound === "none") return false;
  if (!shouldStartSound(role)) return false;

  const volume = (SOUND_ROLE_GATE[role] === "feedback"
    ? settings.feedbackVolume
    : settings.soundVolume) * ROLE_LOUDNESS[role];

  if (role === "attention") {
    if (settings.notificationSound === "default") {
      playNotificationDefaultTone(volume);
      return true;
    }
    const soundUrl = NOTIFICATION_SOUND_FILES[settings.notificationSound];
    if (!soundUrl) {
      playNotificationDefaultTone(volume);
      return true;
    }
    void playFile(soundUrl, volume);
    return true;
  }

  const feedbackType = SOUND_ROLE_TO_FEEDBACK_TYPE[role];
  const soundUrl = FEEDBACK_SOUND_FILES[feedbackType];
  if (!soundUrl) return false;
  void playFile(soundUrl, volume);
  return true;
}

function hapticTypeForRole(role: SoundRole): FeedbackType | null {
  if (role === "attention") return null;
  return SOUND_ROLE_TO_FEEDBACK_TYPE[role];
}

function payloadDedupeKey(payload: FeedbackEventPayloads[FeedbackEventId]): string | undefined {
  const value = getPayloadPresentation(payload).dedupeKey;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function eventToast(
  eventId: FeedbackEventId,
  payload: FeedbackEventPayloads[FeedbackEventId],
  options?: FeedbackEmitOptions,
): FeedbackToastOptions {
  return { ...defaultToast(eventId, payload), ...options?.toast };
}

function eventNotification(
  eventId: FeedbackEventId,
  payload: FeedbackEventPayloads[FeedbackEventId],
  options?: FeedbackEmitOptions,
): FeedbackNotificationOptions {
  return { ...defaultNotification(eventId, payload), ...options?.notification };
}

function quietHoursSuppressesSound(policy: FeedbackPolicy, role: SoundRole, settings: NotificationSettings): boolean {
  return policy.quietHours && role === "attention" && isInQuietHours(settings);
}

export async function emitFeedback<Event extends FeedbackEventId>(
  eventId: Event,
  payload: FeedbackEventPayloads[Event],
  options?: FeedbackEmitOptions,
): Promise<FeedbackResolution> {
  const policy = FEEDBACK_POLICY_REGISTRY[eventId];
  if (!policy) return withDebug(eventId, { channels: [], suppressedBy: "policy" });

  const settings = useSettingsStore.getState().settings.notifications;
  const typedPayload = payload as FeedbackEventPayloads[FeedbackEventId];

  if (policy.suppressDuringReview && activeReviewSession) {
    return withDebug(eventId, { channels: [], suppressedBy: "active-review" });
  }

  const eventKey = options?.dedupeKey ?? payloadDedupeKey(typedPayload) ?? eventId;
  const now = Date.now();
  const lastDelivery = cooldowns.get(eventKey);
  if (lastDelivery !== undefined && policy.cooldownMs > 0 && now - lastDelivery < policy.cooldownMs) {
    return withDebug(eventId, { channels: [], suppressedBy: "cooldown" });
  }

  if (eventId === "reminder.reviews-due" && hasReminderFiredToday()) {
    return withDebug(eventId, { channels: [], suppressedBy: "daily-cooldown" });
  }

  let capabilities: AsyncFeedbackCapabilities;
  try {
    capabilities = await queryAsyncCapabilities();
  } catch {
    capabilities = {
      notificationPermission: "unsupported",
      periodicSyncAvailable: false,
      badgeAvailable: false,
      hapticsAvailable: false,
    };
  }

  const quietHours = policy.quietHours && isInQuietHours(settings);
  const os = canUseOsNotification(eventId, policy, settings, capabilities, typedPayload, options) && !quietHours;
  const toastAllowed = policy.toast === "default-on"
    || (policy.toast === "opt-in" && settings.enabled);
  const toast = toastAllowed && !os;
  const role = policy.sound;
  const sound = role !== null
    && roleIsEnabled(role, settings)
    && !quietHoursSuppressesSound(policy, role, settings)
    && !os;
  const haptic = policy.haptic
    && capabilities.hapticsAvailable
    && role !== null
    && roleIsEnabled(role, settings)
    && !os;

  const channels: FeedbackChannel[] = [];
  if (toast) channels.push("toast");
  if (sound) channels.push("sound");
  if (haptic) channels.push("haptic");
  if (os) channels.push("os");

  if (channels.length === 0) {
    return withDebug(eventId, {
      channels,
      suppressedBy: quietHours && role === "attention" ? "quiet-hours" : "settings",
    });
  }

  cooldowns.set(eventKey, now);
  if (eventId === "reminder.reviews-due") markReminderFiredToday();

  if (toast) {
    const toastOptions = eventToast(eventId, typedPayload, options);
    useToastStore.getState().addToast({
      type: toastOptions.type ?? ToastType.Info,
      title: toastOptions.title ?? "Incrementum",
      message: toastOptions.message,
      duration: toastOptions.duration,
      action: toastOptions.action,
    });
  }

  if (sound && role !== null) {
    deliverSound(role, settings);
  }

  if (haptic && role !== null) {
    const hapticType = hapticTypeForRole(role);
    if (hapticType) vibrate(hapticType);
  }

  if (os) {
    const notification = eventNotification(eventId, typedPayload, options);
    void sendNotification({
      title: notification.title ?? "Incrementum",
      body: notification.body,
      tag: policy.osTag,
      requireInteraction: notification.requireInteraction,
      actions: notification.actions,
      data: notification.data,
      // The orchestrator owns webview sounds. Passing silent prevents the
      // existing notification service from producing a second sound.
      silent: true,
    }).catch(() => {
      // Notification delivery is best-effort; the foreground downgrade has
      // already been resolved before delivery.
    });
  }

  return withDebug(eventId, { channels });
}

/** Test/support hook for clearing only in-memory cooldowns on a reload boundary. */
export function resetFeedbackCooldowns(): void {
  cooldowns.clear();
  activeSound = null;
}
