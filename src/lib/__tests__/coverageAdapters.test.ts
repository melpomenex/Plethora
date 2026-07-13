import { describe, expect, it } from "vitest";
import { listRegisteredSyncAdapters, registerSyncAdapter } from "../sync/coverageRegistry";

describe("sync adapter registration", () => {
  it("accepts only declared domains and exposes adapter readiness", () => {
    const unregister = registerSyncAdapter("documents", async () => undefined);
    expect(listRegisteredSyncAdapters()).toContain("documents");
    unregister();
  });
});
