/**
 * Regression tests for the mobile Queue first-load gate (fresh-install bug:
 * "Queue opens empty; visiting another view and coming back finally loads").
 *
 * `loadedQueryKey` must be set ONLY after `ensureStartup` delivered a
 * snapshot. It used to be set synchronously before the request, so a first
 * pass that raced backend setup (resolve → null) left the queue empty with
 * the key claiming "loaded", and every later activation skipped the reload.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

const ensureStartup = vi.fn();
const setLoadedQueryKey = vi.fn();
let loadedQueryKey: string | null = null;
const queueViewState = vi.hoisted(() => ({
  items: [] as unknown[],
  isLoading: true,
  error: null as string | null,
  hasCompletedFirstLoad: false,
}));

vi.mock("../../../stores/queueStore", () => ({
  useQueueStore: Object.assign(
    (selector) =>
      selector({
        ...queueViewState,
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
      ...queueViewState,
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
    queueViewState.items = [];
    queueViewState.isLoading = true;
    queueViewState.error = null;
    queueViewState.hasCompletedFirstLoad = false;
  });

  it("does not mark the filter loaded when the startup snapshot fails (fresh-install race)", async () => {
    ensureStartup.mockResolvedValue(null);
    render(React.createElement(MobileQueueView));

    expect(screen.getByText("mobileQueue.loading")).toBeInTheDocument();
    expect(screen.queryByText("mobileQueue.noDocumentsReady")).not.toBeInTheDocument();

    await waitFor(() => expect(ensureStartup).toHaveBeenCalled());
    // Give the .then a tick to (wrongly) mark loaded.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(setLoadedQueryKey).not.toHaveBeenCalled();
  });

  it("marks the filter loaded only after a successful snapshot", async () => {
    ensureStartup.mockResolvedValue({ queue: { items: [] }, documents: { items: [] } });
    const view = render(React.createElement(MobileQueueView));

    await waitFor(() => expect(setLoadedQueryKey).toHaveBeenCalledWith("mobile:today"));
    queueViewState.isLoading = false;
    queueViewState.hasCompletedFirstLoad = true;
    view.rerender(React.createElement(MobileQueueView));
    expect(screen.getByText("mobileQueue.noDocumentsReady")).toBeInTheDocument();
    expect(screen.queryByText("mobileQueue.loading")).not.toBeInTheDocument();
  });

  it("leaves retries to the shared coordinator and marks loaded after its eventual success", async () => {
    let resolveStartup!: (value: { queue: { items: unknown[] }; documents: { items: unknown[] } }) => void;
    ensureStartup.mockReturnValueOnce(new Promise((resolve) => { resolveStartup = resolve; }));
    render(React.createElement(MobileQueueView));

    await waitFor(() => expect(ensureStartup).toHaveBeenCalledTimes(1));
    expect(setLoadedQueryKey).not.toHaveBeenCalled();

    resolveStartup({ queue: { items: [] }, documents: { items: [] } });
    await waitFor(() => expect(setLoadedQueryKey).toHaveBeenCalledWith("mobile:today"));
    expect(ensureStartup).toHaveBeenCalledTimes(1);
  });
});
