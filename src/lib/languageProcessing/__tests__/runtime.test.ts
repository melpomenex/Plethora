import { baselineAdapter } from "../baseline";
import { MemoryLanguageProcessingStore } from "../persistence";
import { LanguageProcessingRuntime } from "../runtime";
import { LanguageProcessingError, type LanguageProcessingAdapter } from "../types";
import { LanguageProcessingAdapterRegistry } from "../registry";

describe("background language processing runtime", () => {
  it("chunks, checkpoints, pages, and resumes deterministically", async () => {
    const store = new MemoryLanguageProcessingStore();
    const progress: number[] = [];
    const runtime = new LanguageProcessingRuntime({
      store,
      defaultChunkCodeUnits: 8,
      sleep: async () => undefined,
    });
    const text = Array.from({ length: 80 }, (_, index) => `word${index}`).join(" ");
    const result = await runtime.process({ text, languageTag: "en" }, { jobId: "large-job", onProgress: (item) => progress.push(item.percent) });
    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.tokens.length).toBe(80);
    expect(progress.at(-1)).toBe(100);
    const page = await runtime.pageTokens(result.version.processingKey, 10, 5);
    expect(page?.tokens).toHaveLength(5);
    expect((await runtime.checkpoint("large-job"))?.state).toBe("completed");
  });

  it("retries typed transient provider failures", async () => {
    let attempts = 0;
    const flaky: LanguageProcessingAdapter = {
      ...baselineAdapter,
      id: "flaky-local",
      manifest: { ...baselineAdapter.manifest, adapterId: "flaky-local" },
      supports: () => true,
      analyze: async (request, signal) => {
        attempts += 1;
        if (attempts === 1) throw new LanguageProcessingError("network", "temporary", { retryable: true, providerId: "flaky-local" });
        const result = await baselineAdapter.analyze(request, signal);
        return { ...result, version: { ...result.version, adapterId: "flaky-local", processingKey: result.version.processingKey.replace("adapter=intl-baseline", "adapter=flaky-local") } };
      },
    };
    const registry = new LanguageProcessingAdapterRegistry([flaky, baselineAdapter]);
    const runtime = new LanguageProcessingRuntime({ registry, store: new MemoryLanguageProcessingStore(), sleep: async () => undefined });
    await expect(runtime.process({ text: "retry me", languageTag: "en" }, { maxRetries: 1 })).resolves.toBeTruthy();
    expect(attempts).toBe(2);
  });

  it("persists cancellation and resumes at the checkpoint", async () => {
    const controller = new AbortController();
    let calls = 0;
    const cancellable: LanguageProcessingAdapter = {
      ...baselineAdapter,
      id: "cancellable-local",
      manifest: { ...baselineAdapter.manifest, adapterId: "cancellable-local" },
      supports: () => true,
      analyze: async (request, signal) => {
        calls += 1;
        const result = await baselineAdapter.analyze(request, signal);
        if (calls === 1) controller.abort();
        return { ...result, version: { ...result.version, adapterId: "cancellable-local", processingKey: result.version.processingKey.replace("adapter=intl-baseline", "adapter=cancellable-local") } };
      },
    };
    const registry = new LanguageProcessingAdapterRegistry([cancellable, baselineAdapter]);
    const store = new MemoryLanguageProcessingStore();
    const runtime = new LanguageProcessingRuntime({ registry, store, defaultChunkCodeUnits: 5, sleep: async () => undefined });
    const request = { text: "one two three four five six", languageTag: "en" };
    await expect(runtime.process(request, { jobId: "resume-job", signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
    expect((await runtime.checkpoint("resume-job"))?.state).toBe("cancelled");
    const result = await runtime.resume(request, "resume-job");
    expect(result.tokens.length).toBeGreaterThan(0);
  });
});
