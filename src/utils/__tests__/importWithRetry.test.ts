import { describe, expect, it, vi } from "vitest";
import { importWithRetry } from "../importWithRetry";

function never(): Promise<never> {
  return new Promise(() => undefined);
}

describe("importWithRetry", () => {
  it("returns immediately when the import resolves", async () => {
    const loader = vi.fn().mockResolvedValue({ default: 1 });
    await expect(importWithRetry("fast", loader, { timeoutMs: 50 })).resolves.toEqual({
      default: 1,
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("retries a stalled import and succeeds on a later attempt", async () => {
    // First call hangs forever (the WebView stall); second resolves.
    const loader = vi
      .fn()
      .mockImplementationOnce(() => never())
      .mockImplementationOnce(() => Promise.resolve({ default: 2 }));
    await expect(
      importWithRetry("stalled", loader, { timeoutMs: 10, retries: 2 })
    ).resolves.toEqual({ default: 2 });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    const loader = vi.fn().mockImplementation(() => never());
    await expect(
      importWithRetry("dead", loader, { timeoutMs: 10, retries: 2 })
    ).rejects.toThrow(/timed out/);
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it("propagates real import errors after retries", async () => {
    const loader = vi.fn().mockRejectedValue(new Error("404 chunk missing"));
    await expect(
      importWithRetry("missing", loader, { timeoutMs: 10, retries: 1 })
    ).rejects.toThrow("404 chunk missing");
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
