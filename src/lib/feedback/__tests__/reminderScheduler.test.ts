import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: {
    settings: {
      notifications: {
        enabled: true,
        studyReminders: true,
        reminderTime: "09:00",
      },
    },
  },
  getQueueStats: vi.fn(),
  emitFeedback: vi.fn().mockResolvedValue({ channels: ["toast"] }),
  subscribe: vi.fn(),
}));

vi.mock("../../../api/queue", () => ({ getQueueStats: mocks.getQueueStats }));
vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => mocks.settings,
    subscribe: mocks.subscribe,
  },
}));
vi.mock("../orchestrator", () => ({ emitFeedback: mocks.emitFeedback }));

import { getNextReminderDelay, startReminderScheduler } from "../reminderScheduler";

describe("reminderScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T08:59:00"));
    mocks.getQueueStats.mockReset();
    mocks.getQueueStats.mockResolvedValue({ due_today: 12 });
    mocks.emitFeedback.mockClear();
    mocks.subscribe.mockReset();
    mocks.subscribe.mockReturnValue(vi.fn());
    mocks.settings.settings.notifications.enabled = true;
    mocks.settings.settings.notifications.studyReminders = true;
    mocks.settings.settings.notifications.reminderTime = "09:00";
  });

  it("computes the next local reminder time and rolls to tomorrow after it", () => {
    const before = new Date("2026-07-15T08:59:00");
    const after = new Date("2026-07-15T09:00:01");

    expect(getNextReminderDelay(before, "09:00")).toBe(60_000);
    expect(getNextReminderDelay(after, "09:00")).toBe(23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 59_000);
  });

  it("loads the real due count at fire time and emits one reminder event", async () => {
    const stop = startReminderScheduler();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.getQueueStats).toHaveBeenCalledOnce();
    expect(mocks.emitFeedback).toHaveBeenCalledWith("reminder.reviews-due", { dueCount: 12 });
    stop();
  });

  it("does not query or emit when reminders are disabled", async () => {
    mocks.settings.settings.notifications.studyReminders = false;
    const stop = startReminderScheduler();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.getQueueStats).not.toHaveBeenCalled();
    expect(mocks.emitFeedback).not.toHaveBeenCalled();
    stop();
  });
});

