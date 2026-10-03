/**
 * The mobile queue must open whatever `smartQueue.queueStrategyPreset` holds.
 *
 * That field is the union of nine strategy ids — the five `PriorityPreset`
 * strategies plus the four DAQE learning modes — and Settings writes all nine
 * into it. The view used to cast it straight to `PriorityPreset`, so a DAQE mode
 * reached `getPriorityScore` with no matching weight vector and rendering threw
 * `Cannot read properties of undefined (reading 'retentionRisk')`. Selecting
 * "Deep Work Sprint" in Settings made the Queue tab unopenable on the phone.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

let storeItems: any[] = [];
let storedPreset: unknown = "maximize-retention";

vi.mock("../../../stores/queueStore", () => {
  const getStore = () => ({
    items: storeItems,
    isLoading: false,
    error: null,
    selectedIds: new Set<string>(),
    loadQueue: vi.fn(),
    loadDueQueueItems: vi.fn(),
    setQueueFilterMode: vi.fn(),
    setSelected: vi.fn(),
    clearSelection: vi.fn(),
    bulkSuspend: vi.fn(),
    bulkUnsuspend: vi.fn(),
    bulkDelete: vi.fn(),
    postponeItemSmart: vi.fn(),
    loadedQueryKey: null as string | null,
    setLoadedQueryKey: vi.fn(),
    rankBreakdowns: new Map<string, unknown>(),
    rankBreakdownKnobs: null,
  });
  return {
    rankBreakdowns: new Map<string, unknown>(),
    rankBreakdownKnobs: null,
    useQueueStore: Object.assign(
      (selector?: (s: ReturnType<typeof getStore>) => unknown) =>
        selector ? selector(getStore()) : getStore(),
      { getState: () => getStore() },
    ),
  };
});

vi.mock("../../../stores/startupStore", () => ({
  useStartupStore: (selector: (s: any) => unknown) =>
    selector({
      status: "idle",
      error: null,
      snapshot: null,
      collectionId: null,
      lastSurface: null,
      lastQueueMode: null,
      ensureStartup: vi.fn().mockResolvedValue(null),
      retryStartup: vi.fn(),
    }),
}));

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: (selector: (s: any) => unknown) =>
    selector({
      settings: {
        general: {},
        queue: {},
        smartQueue: { queueStrategyPreset: storedPreset },
        daqe: { knobs: { energyTarget: 3 } },
      },
    }),
}));

vi.mock("../../common/Tabs", () => ({ useIsActiveTab: () => true }));

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

vi.mock("../../common/VirtualList", () => ({ DynamicVirtualList: () => null }));

vi.mock("../../../api/queue", () => ({
  bulkSuspendItems: vi.fn(),
  bulkUnsuspendItems: vi.fn(),
}));

vi.mock("../../../api/documents", () => ({ dismissDocument: vi.fn() }));

import { MobileQueueView } from "../MobileQueueView";
import { DAQE_PRESET_IDS } from "../../../lib/daqe/presets";

const documentItem = {
  id: "doc-1",
  documentId: "doc-1",
  documentTitle: "Readable Document",
  itemType: "document",
  priority: 7,
  estimatedTime: 5,
  tags: [],
  progress: 0,
};

describe("MobileQueueView queue strategy preset", () => {
  beforeEach(() => {
    storeItems = [documentItem];
    storedPreset = "maximize-retention";
  });

  it("renders the queue for every DAQE learning mode", async () => {
    for (const presetId of DAQE_PRESET_IDS) {
      storedPreset = presetId;
      const view = render(React.createElement(MobileQueueView, {}));
      await waitFor(() => expect(screen.getAllByText("Readable Document").length).toBeGreaterThan(0));
      view.unmount();
    }
  });

  it("renders the queue for a stale or missing stored id", async () => {
    for (const stale of ["a-preset-that-was-removed", undefined, 42]) {
      storedPreset = stale;
      const view = render(React.createElement(MobileQueueView, {}));
      await waitFor(() => expect(screen.getAllByText("Readable Document").length).toBeGreaterThan(0));
      view.unmount();
    }
  });
});