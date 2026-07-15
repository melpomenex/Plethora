import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const settingsState = {
    settings: {
      notifications: {
        enabled: true,
        studyReminders: true,
        reminderTime: "09:00",
        dueDateReminders: true,
        soundEnabled: true,
        notificationSound: "default",
        soundVolume: 0.5,
        quietHoursEnabled: false,
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
        showBadge: true,
        feedbackSoundsEnabled: true,
        feedbackVolume: 0.3,
      },
    },
  };

  return {
    settingsState,
    addToast: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue(true),
    playFile: vi.fn(),
    playNotificationDefaultTone: vi.fn(),
    vibrate: vi.fn(),
    queryAsyncCapabilities: vi.fn(),
  };
});

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: { getState: () => mocks.settingsState },
}));
vi.mock("../../../components/common/Toast", () => ({
  ToastType: {
    Success: "success",
    Error: "error",
    Warning: "warning",
    Info: "info",
  },
  useToastStore: { getState: () => ({ addToast: mocks.addToast }) },
}));
vi.mock("../../../utils/notificationService", () => ({
  sendNotification: mocks.sendNotification,
}));
vi.mock("../../../utils/soundService", () => ({
  FEEDBACK_SOUND_FILES: {
    click: "/click.wav",
    success: "/success.wav",
    error: "/error.wav",
    warning: "/warning.wav",
    "review-complete": "/review-complete.wav",
    milestone: "/milestone.wav",
  },
  NOTIFICATION_SOUND_FILES: { glass: "/glass.mp3" },
  playFile: mocks.playFile,
  playNotificationDefaultTone: mocks.playNotificationDefaultTone,
  vibrate: mocks.vibrate,
}));
vi.mock("../capabilities", () => ({
  queryAsyncCapabilities: mocks.queryAsyncCapabilities,
}));

import {
  emitFeedback,
  resetFeedbackCooldowns,
  setActiveReviewSession,
} from "../orchestrator";

const supportedCapabilities = {
  notificationPermission: "granted" as const,
  periodicSyncAvailable: false,
  badgeAvailable: false,
  hapticsAvailable: false,
};

describe("emitFeedback", () => {
  beforeEach(() => {
    resetFeedbackCooldowns();
    setActiveReviewSession(false);
    mocks.addToast.mockClear();
    mocks.sendNotification.mockClear();
    mocks.playFile.mockClear();
    mocks.playNotificationDefaultTone.mockClear();
    mocks.vibrate.mockClear();
    mocks.queryAsyncCapabilities.mockResolvedValue(supportedCapabilities);
    Object.assign(mocks.settingsState.settings.notifications, {
      enabled: true,
      studyReminders: true,
      soundEnabled: true,
      notificationSound: "default",
      quietHoursEnabled: false,
      feedbackSoundsEnabled: true,
    });
    localStorage.clear();
    window.dispatchEvent(new Event("focus"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("downgrades a foreground reminder to one toast", async () => {
    const result = await emitFeedback("reminder.reviews-due", { dueCount: 4 });

    expect(result.channels).toEqual(["toast", "sound"]);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(mocks.addToast).toHaveBeenCalledOnce();
  });

  it("downgrades a denied hidden reminder without requesting permission", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    mocks.queryAsyncCapabilities.mockResolvedValue({
      ...supportedCapabilities,
      notificationPermission: "denied",
    });

    const result = await emitFeedback("reminder.reviews-due", { dueCount: 4 });

    expect(result.channels).toEqual(["toast", "sound"]);
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(mocks.addToast).toHaveBeenCalledOnce();
  });

  it("suppresses attention sound during quiet hours but still delivers the toast", async () => {
    Object.assign(mocks.settingsState.settings.notifications, {
      quietHoursEnabled: true,
      quietHoursStart: "00:00",
      quietHoursEnd: "23:59",
    });

    const result = await emitFeedback("reminder.reviews-due", { dueCount: 4 });

    expect(result.channels).toEqual(["toast"]);
    expect(mocks.playNotificationDefaultTone).not.toHaveBeenCalled();

    const errorResult = await emitFeedback("import.failed", {
      title: "Import failed",
      message: "Try again",
    });
    expect(errorResult.channels).toEqual(["toast", "sound"]);
    expect(mocks.addToast).toHaveBeenCalledTimes(2);
  });

  it("suppresses duplicate events using the dedupe key and cooldown", async () => {
    const first = await emitFeedback(
      "import.failed",
      { title: "Import failed" },
      { dedupeKey: "import:batch-1" },
    );
    const duplicate = await emitFeedback(
      "import.failed",
      { title: "Import failed" },
      { dedupeKey: "import:batch-1" },
    );

    expect(first.channels).toEqual(["toast", "sound"]);
    expect(duplicate).toEqual({ channels: [], suppressedBy: "cooldown" });
    expect(mocks.addToast).toHaveBeenCalledOnce();
  });

  it("uses the OS path for hidden completion without adding a second sound", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });

    const result = await emitFeedback("review.session-completed", {
      reviewsCompleted: 3,
      correctCount: 2,
      durationMs: 1000,
    });

    expect(result.channels).toEqual(["os"]);
    expect(mocks.sendNotification).toHaveBeenCalledWith(expect.objectContaining({ silent: true }));
    expect(mocks.playFile).not.toHaveBeenCalled();
  });

  it("does not layer a sound when the caller owns delivery", async () => {
    const result = await emitFeedback("focus.phase-completed", {
      phase: "work",
      phaseLabel: "Focus",
    }, { soundHandledExternally: true, notificationsEnabled: false });

    expect(result.channels).toEqual([]);
    expect(mocks.playFile).not.toHaveBeenCalled();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("logs resolutions only when feedback debug mode is enabled", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    localStorage.setItem("incrementum-feedback:debug", "1");

    await emitFeedback("update.available", { latestVersion: "2.0.0" });

    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining("update.available → toast | suppressed-by=none"),
    );
    debug.mockRestore();
  });
});
