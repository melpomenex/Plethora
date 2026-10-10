import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hydrated: true,
  finishHydration: undefined as undefined | (() => void),
  settings: {
    learning: {
      postpone: { autoPostponeEnabled: false } as Record<string, unknown> & { autoPostponeEnabled: boolean },
    },
  },
  collectionId: "collection-1",
  whenBackendReady: vi.fn(),
  ensureStartup: vi.fn(),
  loadCollections: vi.fn(),
  reloadForCurrentMode: vi.fn(),
  loadStats: vi.fn(),
  getCandidates: vi.fn(),
  applyPlan: vi.fn(),
  addToast: vi.fn(),
}));

vi.mock("../../api/autoPostpone", () => ({
  getAutoPostponeCandidates: mocks.getCandidates,
  applyAutoPostponePlan: mocks.applyPlan,
}));
vi.mock("../tauri", () => ({ whenBackendReady: mocks.whenBackendReady }));
vi.mock("../../stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({ settings: mocks.settings }),
    persist: {
      hasHydrated: () => mocks.hydrated,
      onFinishHydration: (callback: () => void) => {
        mocks.finishHydration = callback;
        return () => { mocks.finishHydration = undefined; };
      },
    },
  },
}));
vi.mock("../../stores/startupStore", () => ({
  useStartupStore: { getState: () => ({ ensureStartup: mocks.ensureStartup }) },
}));
vi.mock("../../stores/collectionStore", () => ({
  useCollectionStore: { getState: () => ({ activeCollectionId: mocks.collectionId, loaded: true, loadCollections: mocks.loadCollections }) },
}));
vi.mock("../../stores/queueStore", () => ({
  useQueueStore: { getState: () => ({ reloadForCurrentMode: mocks.reloadForCurrentMode, loadStats: mocks.loadStats }) },
}));
vi.mock("../../components/common/Toast", () => ({
  ToastType: { Success: "success", Error: "error", Warning: "warning", Info: "info" },
  useToastStore: { getState: () => ({ addToast: mocks.addToast }) },
}));
vi.mock("../i18n", () => ({ t: (key: string) => key }));

import { defaultPostponeConfig } from "../postpone";
import type { AutoPostponeCandidateSet } from "../../api/autoPostpone";
import { resetAutoPostponeSessionForTests, runAutoPostponeSession } from "../autoPostponeSession";

function emptyCandidateSet(): AutoPostponeCandidateSet {
  return { candidates: [], scheduledDates: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAutoPostponeSessionForTests();
  mocks.hydrated = true;
  mocks.finishHydration = undefined;
  mocks.collectionId = "collection-1";
  mocks.settings = {
    learning: {
      postpone: {
        ...defaultPostponeConfig,
        autoPostponeEnabled: true,
        randomize: false,
      },
    },
  };
  mocks.whenBackendReady.mockResolvedValue(undefined);
  mocks.ensureStartup.mockResolvedValue(null);
  mocks.loadCollections.mockResolvedValue(undefined);
  mocks.reloadForCurrentMode.mockResolvedValue(undefined);
  mocks.loadStats.mockResolvedValue(undefined);
  mocks.applyPlan.mockResolvedValue({ outcomes: [] });
  mocks.getCandidates.mockResolvedValue(emptyCandidateSet());
});

describe("runAutoPostponeSession", () => {
  it("does nothing when the visible setting is disabled", async () => {
    mocks.settings.learning.postpone.autoPostponeEnabled = false;

    const result = await runAutoPostponeSession();

    expect(result.status).toBe("disabled");
    expect(mocks.ensureStartup).not.toHaveBeenCalled();
    expect(mocks.getCandidates).not.toHaveBeenCalled();
    expect(mocks.applyPlan).not.toHaveBeenCalled();
    expect(mocks.addToast).not.toHaveBeenCalled();
  });

  it("waits for settings hydration and shares one session attempt between callers", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);
    const dueDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
    mocks.hydrated = false;
    mocks.getCandidates
      .mockResolvedValueOnce({
        candidates: [{
          id: "overdue", entityType: "learning-item", dueDate,
          lastReviewDate: null, interval: 3, priorityScore: 50, stability: 1, difficulty: 3,
          reviewCount: 1, lapses: 0, isSuspended: false, isArchived: false,
          isDismissed: false, isInactive: false,
        }],
        scheduledDates: [],
      })
      .mockResolvedValueOnce(emptyCandidateSet());
    mocks.applyPlan.mockResolvedValue({ outcomes: [{ id: "overdue", status: "postponed" }] });

    const first = runAutoPostponeSession();
    const second = runAutoPostponeSession();
    expect(first).toBe(second);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.ensureStartup).not.toHaveBeenCalled();
    expect(mocks.getCandidates).not.toHaveBeenCalled();

    mocks.hydrated = true;
    mocks.finishHydration?.();
    const result = await first;

    expect(result.status).toBe("completed");
    expect(result.discovered).toBe(1);
    expect(result.postponed).toBe(1);
    expect(result.remainingOverdue).toBe(0);
    expect(mocks.ensureStartup).toHaveBeenCalledTimes(1);
    expect(mocks.getCandidates).toHaveBeenCalledTimes(2);
    expect(mocks.applyPlan).toHaveBeenCalledTimes(1);
    expect(mocks.reloadForCurrentMode).toHaveBeenCalledTimes(1);
    expect(mocks.loadStats).toHaveBeenCalledTimes(1);
    expect(mocks.addToast).toHaveBeenCalledTimes(1);

    const again = await runAutoPostponeSession();
    expect(again).toBe(result);
    expect(mocks.ensureStartup).toHaveBeenCalledTimes(1);

    // Returning from the background or changing collections in this process
    // does not create a second session pass; a new process gets a fresh one.
    mocks.collectionId = "collection-2";
    expect(await runAutoPostponeSession()).toBe(result);
    expect(mocks.getCandidates).toHaveBeenCalledTimes(2);
    resetAutoPostponeSessionForTests();
    await runAutoPostponeSession();
    expect(mocks.ensureStartup).toHaveBeenCalledTimes(2);
    expect(mocks.getCandidates).toHaveBeenCalledTimes(3);
    expect(mocks.getCandidates).toHaveBeenNthCalledWith(
      3,
      "collection-2",
      expect.any(String),
      expect.any(String),
    );
  });

  it("reports the plan and remaining backlog when the atomic apply fails", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);
    const dueDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
    mocks.getCandidates.mockResolvedValue({
      candidates: [{
        id: "overdue", entityType: "learning-item", dueDate,
        lastReviewDate: null, interval: 3, priorityScore: 50, stability: 1, difficulty: 3,
        reviewCount: 1, lapses: 0, isSuspended: false, isArchived: false,
        isDismissed: false, isInactive: false,
      }, {
        id: "unsupported-video", entityType: "video-extract", dueDate,
        lastReviewDate: null, interval: 3, priorityScore: 50, stability: 1, difficulty: 3,
        reviewCount: 1, lapses: 0, isSuspended: false, isArchived: false,
        isDismissed: false, isInactive: false,
      }],
      scheduledDates: [],
    });
    mocks.applyPlan.mockRejectedValue(new Error("transaction rolled back"));

    const result = await runAutoPostponeSession();

    expect(result).toMatchObject({
      status: "failed", discovered: 2, postponed: 0, skipped: 1, failed: 1, remainingOverdue: 2,
      skipReasons: { "unsupported-video-extract": 1 },
    });
    expect(mocks.addToast).toHaveBeenCalledWith(expect.objectContaining({
      type: "error",
      message: "postpone.autoPostponeResultMessage",
    }));
  });

  it("counts a stale conditional write as an explained skip instead of a failure", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);
    const dueDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
    const candidate = {
      id: "overdue", entityType: "learning-item" as const, dueDate,
      lastReviewDate: null, interval: 3, priorityScore: 50, stability: 1, difficulty: 3,
      reviewCount: 1, lapses: 0, isSuspended: false, isArchived: false,
      isDismissed: false, isInactive: false,
    };
    mocks.getCandidates.mockResolvedValue({ candidates: [candidate], scheduledDates: [] });
    mocks.applyPlan.mockResolvedValue({ outcomes: [{ id: "overdue", status: "skipped", reason: "changed-or-inactive-before-commit" }] });

    const result = await runAutoPostponeSession();

    expect(result).toMatchObject({
      status: "completed", discovered: 1, postponed: 0, skipped: 1, failed: 0,
      remainingOverdue: 1, skipReasons: { "changed-before-commit": 1 },
    });
    expect(mocks.reloadForCurrentMode).not.toHaveBeenCalled();
    expect(mocks.getCandidates).toHaveBeenCalledTimes(2);
  });
});
