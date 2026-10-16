import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestDestinationAction, settleDestinationAction, useDestinationAction, useDestinationActionStore } from "../destinationActions";
import { useTabsStore } from "../../stores/tabsStore";
import { TabContent } from "../../components/common/Tabs/TabContent";

describe("acknowledged destination requests", () => {
  beforeEach(() => {
    const old = useDestinationActionStore.getState().pending;
    if (old) settleDestinationAction(old.id);
    useTabsStore.setState({ rootPane: { id: "pane", type: "tabs", tabIds: [], activeTabId: null }, tabs: [], navigationPaneId: "pane" });
  });
  it("delivers only to the addressed tab when two matching views are mounted", async () => {
    const first = vi.fn();
    const second = vi.fn();
    function First() { useDestinationAction("queue", first); return <div>First</div>; }
    function Second() { useDestinationAction("queue", second); return <div>Second</div>; }
    const tabs = [
      { id: "first", type: "queue", title: "Queue", content: First, closable: true, icon: null },
      { id: "second", type: "queue", title: "Queue", content: Second, closable: true, icon: null },
    ] as const;
    useTabsStore.setState({ tabs: [...tabs], rootPane: { id: "root", type: "split", direction: "horizontal", sizes: [50, 50], children: [
      { id: "pane", type: "tabs", tabIds: ["first"], activeTabId: "first" },
      { id: "other", type: "tabs", tabIds: ["second"], activeTabId: "second" },
    ] } });
    render(<><TabContent tabs={[...tabs]} activeTabId="first" paneId="pane" /><TabContent tabs={[...tabs]} activeTabId="second" paneId="other" /></>);
    await act(async () => { await requestDestinationAction({ destination: "queue", action: "manage" }); });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
  it("cancels an abandoned request instead of replaying on a later mount", async () => {
    const result = requestDestinationAction({ destination: "queue", action: "manage" }).catch((error) => error.name);
    window.dispatchEvent(new CustomEvent("navigate", { detail: "/documents" }));
    expect(await result).toBe("AbortError");
    expect(useDestinationActionStore.getState().pending).toBeNull();
  });
  it("supersedes a pending request and does not acknowledge the new one with an old ID", async () => {
    const first = requestDestinationAction({ destination: "queue", action: "manage" }).catch((error) => error.name);
    const oldId = useDestinationActionStore.getState().pending!.id;
    const second = requestDestinationAction({ destination: "queue", action: "new" });
    expect(await first).toBe("AbortError");
    settleDestinationAction(oldId);
    expect(useDestinationActionStore.getState().pending?.action).toBe("new");
    settleDestinationAction(useDestinationActionStore.getState().pending!.id);
    await second;
  });
});
