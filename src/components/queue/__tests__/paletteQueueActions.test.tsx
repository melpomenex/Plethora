import { useSettingsStore } from "../../../stores/settingsStore";
import { MobileQueueView } from "../../mobile/MobileQueueView";
import { useStartupStore } from "../../../stores/startupStore";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDefaultCommands } from "../../common/CommandPalette";
import { useSavedQueueActions } from "../useSavedQueueActions";
import { ManageSavedQueuesModal } from "../ManageSavedQueuesModal";
import { SessionCustomizeModal, DEFAULT_CUSTOMIZATION } from "../../review/SessionCustomizeModal";
import { useSavedQueueStore } from "../../../stores/savedQueueStore";
import { useTabsStore } from "../../../stores/tabsStore";
import { useQueueStore } from "../../../stores/queueStore";
import { applyFilters } from "../../../utils/reviewUx";
import * as api from "../../../api/savedQueues";
import { settleDestinationAction, useDestinationActionStore } from "../../../commandPalette/destinationActions";
import type { SavedQueue } from "../../../types/savedQueue";
import type { QueueItem } from "../../../types/queue";

const profile: SavedQueue = {
  id: "quick", name: "Quick Review", filters: { tags: ["study"], categories: [], priorityRange: { min: 0, max: 100 }, excludeSuspended: true },
  itemTypes: { documents: false, extracts: false, learningItems: true }, sessionDurationMinutes: 10, maxItems: 1,
  sessionGoal: "Focus on study", daqePresetId: "tired-mobile-commute", sortOrder: 0, isDefault: false, createdAt: "2026-10-16", updatedAt: "2026-10-16",
};
const items = [
  { id: "eligible", itemType: "learning-item", tags: ["study"], priority: 80 },
  { id: "wrong-type", itemType: "document", tags: ["study"], priority: 80 },
  { id: "wrong-tag", itemType: "learning-item", tags: ["other"], priority: 80 },
  { id: "low-priority", itemType: "learning-item", tags: ["excluded"], priority: 10 },
].map((item) => ({ ...item, documentId: item.id, documentTitle: item.id, estimatedTime: 2, progress: 0 })) as QueueItem[];

function QueueDestination() {
  const [configuration, setConfiguration] = useState(DEFAULT_CUSTOMIZATION);
  const [manage, setManage] = useState(false);
  const [create, setCreate] = useState(false);
  useSavedQueueActions(setConfiguration, () => setManage(true), () => setCreate(true));
  return <>
    <output aria-label="session duration">{configuration.sessionDurationMinutes}</output>
    <ul>{applyFilters(items, configuration).map((item) => <li key={item.id}>{item.id}</li>)}</ul>
    <ManageSavedQueuesModal isOpen={manage} onClose={() => setManage(false)} onCreate={() => { setManage(false); setCreate(true); }} />
    <SessionCustomizeModal isOpen={create} onClose={() => setCreate(false)} customization={configuration} onChange={setConfiguration} onApply={() => setCreate(false)} />
    <button onClick={() => setConfiguration(DEFAULT_CUSTOMIZATION)}>Temporary filters</button>
  </>;
}

describe("palette queue destination outcomes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useTabsStore.setState({ tabs: [], rootPane: { id: "root", type: "split", direction: "horizontal", children: [], sizes: [] } as never, navigationPaneId: null });
    useSavedQueueStore.setState({ savedQueues: [profile], activeQueueId: null, isLoading: false, error: null, activationRevision: 0 });
    vi.spyOn(api, "setActiveSavedQueueId").mockResolvedValue();
    useQueueStore.setState({ applyRankSnapshot: vi.fn().mockResolvedValue(undefined) });
    const pending = useDestinationActionStore.getState().pending;
    if (pending) settleDestinationAction(pending.id);
  });

  it("opens the real manager even when destination mounts after the old 150ms window", async () => {
    const command = getDefaultCommands().find((entry) => entry.id === "manage-saved-queues")!;
    let completed!: Promise<void>;
    act(() => { completed = command.action() as Promise<void>; });
    await new Promise((resolve) => setTimeout(resolve, 180));
    render(<QueueDestination />);
    expect(await screen.findByRole("dialog")).toHaveTextContent("Quick Review");
    await completed;
    fireEvent.click(screen.getByRole("button", { name: /New Queue/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent(/Customize/i);
  });

  it("opens the real creation interface from the new queue command", async () => {
    render(<QueueDestination />);
    await act(async () => { await getDefaultCommands().find((entry) => entry.id === "new-saved-queue")!.action(); });
    expect(screen.getByRole("dialog")).toHaveTextContent(/Customize/i);
  });

  it("Quick Review applies membership, types, limits, duration and reapplies the same ID", async () => {
    render(<QueueDestination />);
    const select = getDefaultCommands().find((entry) => entry.id === "switch-queue-quick")!;
    await act(async () => { await select.action(); });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem")).toHaveTextContent("eligible");
    expect(screen.getByLabelText("session duration")).toHaveTextContent("10");
    expect(useSettingsStore.getState().settings.daqe.sessionGoal).toBe("Focus on study");
    expect(useSettingsStore.getState().settings.daqe.rankingEnabled).toBe(true);
    expect(useQueueStore.getState().applyRankSnapshot).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Temporary filters"));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    await act(async () => { await select.action(); });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("applies a profile that arrives after the destination mounted", async () => {
    useSavedQueueStore.setState({ savedQueues: [], activeQueueId: "quick", isLoading: true });
    render(<QueueDestination />);
    act(() => useSavedQueueStore.setState({ savedQueues: [profile], isLoading: false }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
  });
  it("mobile primary Start carries the saved membership and item types into Scroll Mode", async () => {
    useSavedQueueStore.setState({ activeQueueId: profile.id });
    useStartupStore.setState({ ensureStartup: vi.fn().mockResolvedValue(null) });
    useQueueStore.setState({ items: [...items, { ...items[0], id: "eligible-second", documentTitle: "Second eligible card", priority: 1 }], isLoading: false, hasCompletedFirstLoad: true, loadedQueryKey: "mobile:today", setQueueFilterMode: vi.fn(), loadQueue: vi.fn().mockResolvedValue(undefined), loadDueQueueItems: vi.fn().mockResolvedValue(undefined) });
    const open = vi.fn();
    render(<MobileQueueView onOpenScrollMode={open} />);
    await waitFor(() => expect(screen.getByText("eligible", { exact: true })).toBeVisible());
    expect(screen.queryByText("Second eligible card", { exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Start Reading/i }));
    expect(open).toHaveBeenCalledWith({ items: [expect.objectContaining({ id: "eligible" })], mode: "queue-list", itemTypes: profile.itemTypes });
  });

});
