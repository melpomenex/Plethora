/**
 * Regression tests for the mobile Queue first-load gate (fresh-install bug:
 * "Queue opens empty; visiting another view and coming back finally loads").
 *
 * `loadedQueryKey` must be set ONLY after `ensureStartup` delivered a
 * snapshot. It used to be set synchronously before the request, so a first
 * pass that raced backend setup (resolve → null) left the queue empty with
 * the key claiming "loaded", and every later activation skipped the reload.
 */
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

const ensureStartup = vi.fn();
const setLoadedQueryKey = vi.fn();
let loadedQueryKey: string | null = null;

vi.mock("../../../stores/queueStore", () => ({
  useQueueStore: Object.assign(
    (selector) =>
      selector({
        items: [],
        loadedQueryKey,
        setLoadedQueryKey: (key: string | null) => {
          loadedQueryKey = key;
          setLoadedQueryKey(key);
        },
        setQueueFilterMode: vi.fn(),
        loadDueQueueItems: vi.fn(),
        filters: {},
      }),
    { getState: () => ({
      items: [],
      loadedQueryKey,
      setLoadedQueryKey: (key: string | null) => {
        loadedQueryKey = key;
        setLoadedQueryKey(key);
      },
      setQueueFilterMode: vi.fn(),
      loadDueQueueItems: vi.fn(),
      filters: {},
    }) }
  ),
}));

vi.mock("../../../stores/startupStore", () => ({
  useStartupStore: (selector) =>
    selector({
      status: "idle",
      error: null,
      snapshot: null,
      collectionId: null,
      lastSurface: null,
      lastQueueMode: null,
      ensureStartup,
      retryStartup: vi.fn(),
    }),
}));

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: (selector) =>
    selector({ settings: { general: {}, queue: {}, smartQueue: {} } }),
}));

vi.mock("../../common/Tabs", () => ({
  useIsActiveTab: () => true,
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("../../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("../../schedule/MobileScheduleView", () => ({
  MobileScheduleView: () => React.createElement("div"),
}));

vi.mock("../../queue/QueueItemActionSheet", () => ({
  QueueItemActionSheet: () => null,
}));

vi.mock("../SwipeableItem", () => ({
  SwipeableItem: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("../PullToRefresh", () => ({
  PullToRefresh: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

vi.mock("../../common/VirtualList", () => ({
  DynamicVirtualList: () => null,
}));

vi.mock("../../../api/queue", () => ({
  bulkSuspendItems: vi.fn(),
  bulkUnsuspendItems: vi.fn(),
}));

vi.mock("../../../api/documents", () => ({
  dismissDocument: vi.fn(),
}));

import { MobileQueueView } from "../MobileQueueView";

describe("MobileQueueView first-load gating", () => {
  beforeEach(() => {
    ensureStartup.mockReset();
    setLoadedQueryKey.mockReset();
    loadedQueryKey = null;
  });

  it("does not mark the filter loaded when the startup snapshot fails (fresh-install race)", async () => {
    ensureStartup.mockResolvedValue(null);
    render(React.createElement(MobileQueueView));

    await waitFor(() => expect(ensureStartup).toHaveBeenCalled());
    // Give the .then a tick to (wrongly) mark loaded.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(setLoadedQueryKey).not.toHaveBeenCalled();
  });

  it("marks the filter loaded only after a successful snapshot", async () => {
    ensureStartup.mockResolvedValue({ queue: { items: [] }, documents: { items: [] } });
    render(React.createElement(MobileQueueView));

    await waitFor(() => expect(setLoadedQueryKey).toHaveBeenCalledWith("mobile:today"));
  });

  it("retries a stalled first pass on its own and marks loaded once a retry succeeds", async () => {
    vi.useFakeTimers();
    try {
      ensureStartup
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ queue: { items: [] }, documents: { items: [] } });
      render(React.createElement(MobileQueueView));

      // First attempt resolves null — nothing may be marked loaded.
      await vi.advanceTimersByTimeAsync(10);
      expect(setLoadedQueryKey).not.toHaveBeenCalled();

      // The 3s retry timer fires the second attempt, which succeeds.
      await vi.advanceTimersByTimeAsync(3_000);
      expect(ensureStartup).toHaveBeenCalledTimes(2);
      expect(setLoadedQueryKey).toHaveBeenCalledWith("mobile:today");
    } finally {
      vi.useRealTimers();
    }
  });
});
