/**
 * Tests for the memory-scenario surface (task 3.3): the surface is inert
 * under a production configuration and when the environment variables are
 * missing.
 *
 * Runs under vitest (`npm run test:run`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { markBusy, isBusy, resetBusy } from "../activity";
import { startMemoryScenario } from "../host";
import { normalizeStep } from "../client";
import { executeStep } from "../executor";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("../../tauri", () => ({
  invokeCommand: invokeMock,
  isTauri: () => true,
}));

// The executor pulls in real stores; mock the store modules so no real
// store/indexed-db machinery initializes in these unit tests.
vi.mock("../../../stores/documentStore", () => ({
  useDocumentStore: { getState: () => ({ documents: [], loadDocuments: async () => {}, importGenericFile: async () => ({ id: "doc-1" }) }) },
}));
vi.mock("../../../stores/tabsStore", () => ({
  useTabsStore: { getState: () => ({ addTab: () => "tab-1", closeTab: () => {}, closeAllTabs: () => {}, tabs: [] }) },
}));
vi.mock("../../../utils/openDocumentAtLocation", () => ({
  openDocumentAtLocation: () => {},
}));

describe("memory scenario surface inertness", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetBusy();
    delete (window as unknown as { __memoryScenarioEnabled?: boolean }).__memoryScenarioEnabled;
    vi.restoreAllMocks();
  });

  it("startMemoryScenario does nothing when the backend reports no config (no harness env)", async () => {
    invokeMock.mockResolvedValue(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("fetch must not be called");
    });

    await startMemoryScenario();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      (window as unknown as { __memoryScenarioEnabled?: boolean }).__memoryScenarioEnabled,
    ).toBeUndefined();
  });

  it("startMemoryScenario does nothing when the config command fails", async () => {
    invokeMock.mockRejectedValue(new Error("command unavailable"));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("fetch must not be called");
    });

    await startMemoryScenario();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("markBusy is a no-op unless the scenario is enabled", () => {
    expect(isBusy()).toBe(false);
    markBusy(true);
    markBusy(true);
    markBusy(false);
    expect(isBusy()).toBe(false);
  });

  it("markBusy counts only when the scenario is enabled", () => {
    (window as unknown as { __memoryScenarioEnabled?: boolean }).__memoryScenarioEnabled = true;
    expect(isBusy()).toBe(false);
    markBusy(true);
    expect(isBusy()).toBe(true);
    markBusy(false);
    expect(isBusy()).toBe(false);
    // Never goes negative.
    markBusy(false);
    expect(isBusy()).toBe(false);
    delete (window as unknown as { __memoryScenarioEnabled?: boolean }).__memoryScenarioEnabled;
  });

  it("normalizeStep rejects unrecognized op strings (defense in depth)", () => {
    expect(normalizeStep({ step: 1, op: "deleteAllDocuments" })).toBeNull();
    expect(normalizeStep({ step: "1", op: "open", corpusId: "pdf-1" })).toBeNull();
    expect(normalizeStep(null)).toBeNull();
  });

  it("executeStep surfaces errors from the store actions instead of throwing", async () => {
    const result = await executeStep(
      { step: 99, op: "open", corpusId: "missing" },
      { items: {}, corpusDir: "/corpus" },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not in the manifest/);
  });
});
