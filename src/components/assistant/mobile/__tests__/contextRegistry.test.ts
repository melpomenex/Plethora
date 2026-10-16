import { describe, expect, it, vi } from "vitest";
import { MobileAssistantRegistry } from "../contextRegistry";
import type { MobileAssistantRegistration } from "../contracts";
const registration = (revision: string, priority = 0): MobileAssistantRegistration => ({ ownerPaneId: "pane", ownerTabId: "tab", revision, priority, context: { type: "document", documentId: revision } });
describe("mobile active-view context registration", () => {
  it("ignores inactive tabs and panes and gives Queue precedence", () => {
    const registry = new MobileAssistantRegistry();
    registry.register(registration("reader"));
    const clearQueue = registry.register(registration("queue", 10));
    expect(registry.resolve({ paneId: "pane", tabId: "inactive" })).toBeUndefined();
    expect(registry.resolve({ paneId: "other", tabId: "tab" })).toBeUndefined();
    expect(registry.resolve({ paneId: "pane", tabId: "tab" })?.revision).toBe("queue");
    clearQueue();
    expect(registry.resolve({ paneId: "pane", tabId: "tab" })?.revision).toBe("reader");
  });
  it("stale token cleanup cannot erase a newer owner", () => {
    const registry = new MobileAssistantRegistry();
    const old = registry.register(registration("a"));
    registry.register(registration("b", 10));
    old(); old();
    expect(registry.resolve({ paneId: "pane", tabId: "tab" })?.revision).toBe("b");
  });
  it("context removal survives position ticks until explicit restore or new revision", () => {
    const registry = new MobileAssistantRegistry();
    const first = registration("source");
    registry.remove(first);
    expect(registry.isRemoved({ ...first, context: { ...first.context, position: { currentTime: 35 } } })).toBe(true);
    expect(registry.isRemoved(registration("next"))).toBe(false);
    registry.restore(first);
    expect(registry.isRemoved(first)).toBe(false);
  });
  it("notifies subscribers with stable snapshots between semantic changes", () => {
    const registry = new MobileAssistantRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    const before = registry.getSnapshot();
    const cleanup = registry.register(registration("a"));
    expect(registry.getSnapshot()).toBe(before + 1);
    unsubscribe(); cleanup();
    expect(listener).toHaveBeenCalledOnce();
  });
});
