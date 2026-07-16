import { describe, expect, it } from "vitest";
import { syncActivePaneTabId } from "../activePaneSync";

describe("active pane synchronization", () => {
  it("does not change state when the first pane is already active", () => {
    expect(syncActivePaneTabId("tab-1", "tab-1")).toBe("tab-1");
  });

  it("updates state when the first pane changes", () => {
    expect(syncActivePaneTabId("tab-1", "tab-2")).toBe("tab-2");
    expect(syncActivePaneTabId(null, "tab-1")).toBe("tab-1");
  });
});
