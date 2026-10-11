import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyAndroidStartupFailure,
  recordAndroidStartupDiagnostic,
} from "../startupDiagnostics";

describe("Android startup diagnostics", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps diagnostic payloads to approved counts, timings, and state labels", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    recordAndroidStartupDiagnostic("snapshot-request-complete", {
      surface: "documents",
      durationMs: 120,
      outcome: "populated",
      documents: 2,
      queueItems: 0,
      title: "Private book title",
      documentId: "private-document-id",
    } as Parameters<typeof recordAndroidStartupDiagnostic>[1]);

    expect(info).toHaveBeenCalledWith("[startup:android]", {
      phase: "snapshot-request-complete",
      surface: "documents",
      durationMs: 120,
      outcome: "populated",
      documents: 2,
      queueItems: 0,
    });
  });

  it("distinguishes timeout, bridge, and database failures without retaining their messages", () => {
    expect(classifyAndroidStartupFailure(new Error("request timed out"))).toBe("timeout");
    expect(classifyAndroidStartupFailure(new Error("IPC callback was dropped"))).toBe("transport");
    expect(classifyAndroidStartupFailure(new Error("SQLite database is locked"))).toBe("database");
  });
});
