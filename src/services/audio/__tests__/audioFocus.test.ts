import { afterEach, expect, it, vi } from "vitest";
import { AudioOutputFocus } from "../audioFocus";

afterEach(() => vi.useRealTimers());

it("revokes speech generation before granting media and never resumes it on release", async () => {
  const focus = new AudioOutputFocus();
  const stopSpeech = vi.fn();
  const speech = await focus.acquire("reader", stopSpeech);
  const media = focus.acquire("media", vi.fn());
  expect(speech.signal.aborted).toBe(true);
  expect(speech.isCurrent()).toBe(false);
  const lease = await media;
  expect(stopSpeech).toHaveBeenCalledTimes(1);
  expect(lease.isCurrent()).toBe(true);
  lease.release();
  expect(speech.isCurrent()).toBe(false);
  expect(stopSpeech).toHaveBeenCalledTimes(1);
});

it("blocks competing output until stop acknowledgement and rejects a failed stop", async () => {
  const focus = new AudioOutputFocus();
  const stop = vi.fn().mockRejectedValueOnce(new Error("still audible")).mockResolvedValue(undefined);
  await focus.acquire("media", stop);
  await expect(focus.acquire("capture", vi.fn())).rejects.toThrow("still audible");
  const capture = await focus.acquire("capture", vi.fn());
  expect(capture.isCurrent()).toBe(true);
  expect(stop).toHaveBeenCalledTimes(2);
});

it("last request wins while a prior owner is stopping", async () => {
  const focus = new AudioOutputFocus();
  let acknowledge!: () => void;
  const stopped = new Promise<void>(resolve => { acknowledge = resolve; });
  await focus.acquire("A", () => stopped);
  const b = expect(focus.acquire("B", vi.fn())).rejects.toMatchObject({ name: "AbortError" });
  const c = focus.acquire("C", vi.fn());
  acknowledge();
  await b;
  expect((await c).owner).toBe("C");
});

it("bounds a hung stop and does not grant a second audible owner", async () => {
  vi.useFakeTimers();
  const focus = new AudioOutputFocus();
  const old = await focus.acquire("A", () => new Promise(() => undefined));
  const result = expect(focus.acquire("B", vi.fn())).rejects.toThrow("acknowledge stop");
  await vi.advanceTimersByTimeAsync(2000);
  await result;
  expect(old.isCurrent()).toBe(false);
  expect(old.signal.aborted).toBe(true);
});
