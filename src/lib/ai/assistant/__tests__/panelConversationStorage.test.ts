import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invokeCommand: vi.fn(), mobile: false }));

vi.mock("../../../tauri", () => ({
  invokeCommand: mocks.invokeCommand,
  isNativeMobile: () => mocks.mobile,
  isTauri: () => true,
}));

const key = "assistant-panel-conversations-v1";
const largeSnapshot = JSON.stringify({ general: { input: "界".repeat(300_000) } });

beforeEach(() => {
  localStorage.clear();
  mocks.invokeCommand.mockReset();
  mocks.mobile = false;
  vi.resetModules();
});

describe("desktop assistant history storage", () => {
  it("releases an exact SQLite duplicate and restores history on the next load", async () => {
    localStorage.setItem(key, largeSnapshot);
    mocks.invokeCommand.mockResolvedValue(largeSnapshot);
    const storage = await import("../panelConversationStorage");

    await storage.compactNativeAssistantPanelCache();

    expect(localStorage.getItem(key)).toBeNull();
    expect(storage.readAssistantPanelSnapshot()).toBe(largeSnapshot);
    storage.writeAssistantPanelSnapshot('{"new_chat":{}}');
    expect(localStorage.getItem(key)).toBeNull();
    expect(storage.readAssistantPanelSnapshot()).toBe('{"new_chat":{}}');

    vi.resetModules();
    const restarted = await import("../panelConversationStorage");
    expect(restarted.needsAssistantPanelSnapshotHydration()).toBe(true);
    await restarted.loadNativeAssistantPanelSnapshot();
    expect(restarted.readAssistantPanelSnapshot()).toBe(largeSnapshot);
  });

  it("keeps a legacy cache when SQLite has different data", async () => {
    localStorage.setItem(key, largeSnapshot);
    mocks.invokeCommand.mockResolvedValue('{"different_chat":{}}');
    const storage = await import("../panelConversationStorage");

    await storage.compactNativeAssistantPanelCache();

    expect(localStorage.getItem(key)).toBe(largeSnapshot);
    expect(storage.readAssistantPanelSnapshot()).toBe(largeSnapshot);
  });

  it("keeps the native mobile Local Storage path", async () => {
    mocks.mobile = true;
    localStorage.setItem(key, largeSnapshot);
    const storage = await import("../panelConversationStorage");

    await storage.compactNativeAssistantPanelCache();

    expect(mocks.invokeCommand).not.toHaveBeenCalled();
    expect(storage.needsAssistantPanelSnapshotHydration()).toBe(false);
    expect(localStorage.getItem(key)).toBe(largeSnapshot);
  });
});
