import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const settingsState = {
    settings: {
      general: { language: "en" },
      haptics: { enabled: false, intensity: "subtle" },
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
    subscribe: vi.fn(() => vi.fn()),
    addToast: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue(true),
    playFile: vi.fn(),
    playNotificationDefaultTone: vi.fn(),
    performAdmittedHaptic: vi.fn(),
    queryAsyncCapabilities: vi.fn(),
    hapticsSnapshot: { configured: false, enabled: false, capabilities: { hardware: "unavailable" } },
  };
});

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => mocks.settingsState,
    subscribe: mocks.subscribe,
  },
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
}));
vi.mock("../haptics/service", () => ({
  getHapticsSnapshot: () => mocks.hapticsSnapshot,
  performAdmittedHaptic: mocks.performAdmittedHaptic,
}));
vi.mock("../capabilities", () => ({
  queryAsyncCapabilities: mocks.queryAsyncCapabilities,
}));

import {
  emitInteractionFeedback,
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
    mocks.performAdmittedHaptic.mockClear();
    mocks.queryAsyncCapabilities.mockClear();
    mocks.queryAsyncCapabilities.mockResolvedValue(supportedCapabilities);
    Object.assign(mocks.hapticsSnapshot, { configured: false, enabled: false, capabilities: { hardware: "unavailable" } });
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

  it("honors the persisted once-per-calendar-day reminder cooldown", async () => {
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    localStorage.setItem("plethora-feedback:last-reminder", day);

    const result = await emitFeedback("reminder.reviews-due", { dueCount: 4 });

    expect(result).toEqual({ channels: [], suppressedBy: "daily-cooldown" });
    expect(mocks.addToast).not.toHaveBeenCalled();
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
    localStorage.setItem("plethora-feedback:debug", "1");

    await emitFeedback("update.available", { latestVersion: "2.0.0" });

    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining("update.available → toast | suppressed-by=none"),
    );
    debug.mockRestore();
  });

  it.each(["review.answer-revealed", "navigation.destination-opened"] as const)("admits %s haptics synchronously without notification capability queries", (event) => {
    Object.assign(mocks.hapticsSnapshot, { configured: true, enabled: true, capabilities: { hardware: "available" } });
    mocks.settingsState.settings.haptics.enabled = true;

    const result = emitInteractionFeedback(event, {}, {
      interactionId: "review:session-1:card-2:visit-1:reveal",
      sessionId: "session-1",
      origin: "user",
    });

    expect(result.channels).toEqual(["haptic"]);
    expect(mocks.performAdmittedHaptic).toHaveBeenCalledExactlyOnceWith("activation", "review:session-1:card-2:visit-1:reveal");
    expect(mocks.queryAsyncCapabilities).not.toHaveBeenCalled();
  });

  it.each(["review.answer-revealed", "navigation.destination-opened"] as const)("silences %s immediately when its independent preference is disabled", (event) => {
    // The driver can still hold the old configuration while the opt-out is
    // being applied; policy must suppress delivery immediately.
    Object.assign(mocks.hapticsSnapshot, { configured: true, enabled: true, capabilities: { hardware: "available" } });
    mocks.settingsState.settings.haptics.enabled = false;

    const result = emitInteractionFeedback(event, {}, {
      interactionId: "review:session-1:card-2:visit-1:reveal-disabled",
      origin: "user",
    });

    expect(result.channels).toEqual([]);
    expect(mocks.performAdmittedHaptic).not.toHaveBeenCalled();
  });

  it("admits a haptic before delayed notification work and ignores sound gates", async () => {
    Object.assign(mocks.hapticsSnapshot, { configured: true, enabled: true, capabilities: { hardware: "available" } });
    mocks.settingsState.settings.haptics.enabled = true;
    mocks.settingsState.settings.notifications.feedbackSoundsEnabled = false;
    let resolveCapabilities!: (value: typeof supportedCapabilities) => void;
    mocks.queryAsyncCapabilities.mockReturnValue(new Promise((resolve) => { resolveCapabilities = resolve; }));

    const resultPromise = emitFeedback("review.card-graded", { rating: 3 }, {
      interactionId: "review:session-1:card-2:visit-1:grade",
      origin: "user",
    });
    expect(mocks.performAdmittedHaptic).toHaveBeenCalledExactlyOnceWith("commit", "review:session-1:card-2:visit-1:grade");
    resolveCapabilities(supportedCapabilities);
    const result = await resultPromise;
    expect(result.channels).toContain("haptic");
    expect(result.channels).not.toContain("sound");
  });

  describe("queue document rating and orb haptics", () => {
    beforeEach(() => {
      Object.assign(mocks.hapticsSnapshot, { configured: true, enabled: true, capabilities: { hardware: "available" } });
      mocks.settingsState.settings.haptics.enabled = true;
    });

    it.each([
      [1, "warning"],
      [2, "commit"],
      [3, "success"],
      [4, "celebration"],
    ] as const)("delivers grade-differentiated haptic effect '%s' -> '%s' for queue.document-rated", (rating, expectedEffect) => {
      const interactionId = `queue:rate:doc-1:${rating}:${Date.now()}`;
      const result = emitInteractionFeedback("queue.document-rated", { rating, documentId: "doc-1" }, {
        interactionId,
        origin: "user",
      });

      expect(result.channels).toEqual(["haptic"]);
      expect(mocks.performAdmittedHaptic).toHaveBeenCalledWith(expectedEffect, interactionId);
    });

    it("delivers selection tick on queue.orb-pressed", () => {
      const interactionId = `queue:orb-press:again:${Date.now()}`;
      const result = emitInteractionFeedback("queue.orb-pressed", { orbType: "again" }, {
        interactionId,
        origin: "user",
      });

      expect(result.channels).toEqual(["haptic"]);
      expect(mocks.performAdmittedHaptic).toHaveBeenCalledWith("selection", interactionId);
    });

    it("delivers activation click on queue.orbs-docked", () => {
      const interactionId = `queue:orb-dock:right:${Date.now()}`;
      const result = emitInteractionFeedback("queue.orbs-docked", { position: "right" }, {
        interactionId,
        origin: "user",
      });

      expect(result.channels).toEqual(["haptic"]);
      expect(mocks.performAdmittedHaptic).toHaveBeenCalledWith("activation", interactionId);
    });

    it("delivers threshold detent on queue.orbs-drag-threshold", () => {
      const interactionId = `queue:orb-drag:top:${Date.now()}`;
      const result = emitInteractionFeedback("queue.orbs-drag-threshold", { position: "top" }, {
        interactionId,
        origin: "user",
      });

      expect(result.channels).toEqual(["haptic"]);
      expect(mocks.performAdmittedHaptic).toHaveBeenCalledWith("threshold", interactionId);
    });
  });
  describe("Assistant interaction admission", () => {
    beforeEach(() => {
      vi.useFakeTimers(); vi.setSystemTime(1000);
      Object.assign(mocks.hapticsSnapshot, { configured: true, enabled: true, busy: false, capabilities: { hardware: "available" } });
      mocks.settingsState.settings.haptics.enabled = true;
    });
    afterEach(() => { vi.useRealTimers(); Object.assign(mocks.hapticsSnapshot, { busy: false }); });
    const emit = (event: "assistant.invoke-armed" | "assistant.opened" | "assistant.detent-settled", id: string) => emitInteractionFeedback(event, {}, { interactionId: id, origin: "user" });
    it("deduplicates phase identities and enforces exact threshold and tap cooldown boundaries", () => {
      expect(emit("assistant.invoke-armed", "one:armed").channels).toEqual(["haptic"]);
      expect(emit("assistant.invoke-armed", "one:armed").suppressedBy).toBe("duplicate");
      vi.setSystemTime(1249); expect(emit("assistant.invoke-armed", "two:armed").suppressedBy).toBe("cooldown");
      vi.setSystemTime(1250); expect(emit("assistant.invoke-armed", "three:armed").channels).toEqual(["haptic"]);
      vi.setSystemTime(1500); expect(emit("assistant.opened", "tap:opened").channels).toEqual(["haptic"]);
      vi.setSystemTime(1749); expect(emit("assistant.opened", "fast:opened").suppressedBy).toBe("cooldown");
      vi.setSystemTime(1750); expect(emit("assistant.opened", "next:opened").channels).toEqual(["haptic"]);
      expect(mocks.performAdmittedHaptic.mock.calls.map(call => call[0])).toEqual(["threshold", "threshold", "activation", "activation"]);
    });
    it("enforces 120ms detent cooldown and phase separation across event aliases", () => {
      expect(emit("assistant.detent-settled", "one:detent").channels).toEqual(["haptic"]);
      vi.setSystemTime(1119); expect(emit("assistant.detent-settled", "fast:detent").suppressedBy).toBe("cooldown");
      vi.setSystemTime(1120); expect(emit("assistant.detent-settled", "next:detent").channels).toEqual(["haptic"]);
      vi.setSystemTime(1400); expect(emit("assistant.opened", "one:detent").suppressedBy).toBe("duplicate");
      expect(emit("assistant.opened", "one:opened").channels).toEqual(["haptic"]);
    });
    it("ignores sound and quiet-hours settings without querying asynchronous capabilities", () => {
      mocks.settingsState.settings.notifications.soundEnabled = false; mocks.settingsState.settings.notifications.quietHoursEnabled = true;
      expect(emit("assistant.invoke-armed", "silent:armed").channels).toEqual(["haptic"]);
      expect(mocks.addToast).not.toHaveBeenCalled(); expect(mocks.playFile).not.toHaveBeenCalled(); expect(mocks.sendNotification).not.toHaveBeenCalled(); expect(mocks.queryAsyncCapabilities).not.toHaveBeenCalled();
    });
    it.each(["busy", "configuration", "capability", "settings"] as const)("drops %s output without replay", reason => {
      if (reason === "busy") Object.assign(mocks.hapticsSnapshot, { busy: true });
      if (reason === "configuration") Object.assign(mocks.hapticsSnapshot, { configured: false });
      if (reason === "capability") Object.assign(mocks.hapticsSnapshot, { capabilities: { hardware: "unknown" } });
      if (reason === "settings") mocks.settingsState.settings.haptics.enabled = false;
      expect(emit("assistant.invoke-armed", "dropped:armed").suppressedBy).toBe(reason);
      Object.assign(mocks.hapticsSnapshot, { configured: true, busy: false, capabilities: { hardware: "available" } }); mocks.settingsState.settings.haptics.enabled = true;
      vi.advanceTimersByTime(1000); expect(mocks.performAdmittedHaptic).not.toHaveBeenCalled();
      expect(emit("assistant.invoke-armed", "fresh:armed").channels).toEqual(["haptic"]);
    });
  });

});
