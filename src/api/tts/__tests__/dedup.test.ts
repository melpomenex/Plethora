import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTTSDeduper, getOrCreateTTSGeneration, getTTSInFlightCount } from "../dedup";

function deferred() {
  let resolve!: (value: { audioUrl: string; rawOutput: Record<string, unknown> }) => void;
  const promise = new Promise<{ audioUrl: string; rawOutput: Record<string, unknown> }>((r) => { resolve = r; });
  return { promise, resolve };
}
afterEach(clearTTSDeduper);
describe("speech consumer cancellation", () => {
  it("keeps the producer alive for another consumer", async () => {
    const work = deferred();
    let producer!: AbortSignal;
    const factory = vi.fn((signal: AbortSignal) => { producer = signal; return work.promise; });
    const first = new AbortController();
    const a = getOrCreateTTSGeneration("same", factory, first.signal);
    const b = getOrCreateTTSGeneration("same", factory);
    await Promise.resolve();
    first.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    expect(producer.aborted).toBe(false);
    work.resolve({ audioUrl: "clip.wav", rawOutput: {} });
    await expect(b).resolves.toMatchObject({ audioUrl: "clip.wav" });
    expect(factory).toHaveBeenCalledTimes(1);
  });
  it("aborts native production when every consumer withdraws", async () => {
    const work = deferred();
    let producer!: AbortSignal;
    const one = new AbortController();
    const two = new AbortController();
    const factory = (signal: AbortSignal) => { producer = signal; return work.promise; };
    const a = getOrCreateTTSGeneration("same", factory, one.signal);
    const b = getOrCreateTTSGeneration("same", factory, two.signal);
    await Promise.resolve();
    one.abort(); two.abort();
    await Promise.allSettled([a, b]);
    expect(producer.aborted).toBe(true);
    expect(getTTSInFlightCount()).toBe(0);
    work.resolve({ audioUrl: "old.wav", rawOutput: {} });
  });
  it("does not start already cancelled work", async () => {
    const controller = new AbortController(); controller.abort();
    const factory = vi.fn();
    await expect(getOrCreateTTSGeneration("cancelled", factory, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(factory).not.toHaveBeenCalled();
  });
});
