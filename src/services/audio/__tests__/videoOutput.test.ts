import { afterEach, expect, it, vi } from "vitest";
import { acknowledgeVideoPause } from "../videoOutput";

afterEach(() => vi.useRealTimers());
it("waits for actual iframe pause instead of treating command dispatch as acknowledgement", async () => {
  vi.useFakeTimers();
  const getPlayerState = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(3).mockResolvedValue(2);
  let stopped = false;
  const pending = acknowledgeVideoPause({ pauseVideo: vi.fn(), getPlayerState }).then(() => { stopped = true; });
  await vi.advanceTimersByTimeAsync(40);
  expect(stopped).toBe(false);
  await vi.advanceTimersByTimeAsync(40);
  await pending;
  expect(stopped).toBe(true);
});
it("rejects a player that keeps producing audio", async () => {
  vi.useFakeTimers();
  const pending = acknowledgeVideoPause({ pauseVideo: vi.fn(), getPlayerState: vi.fn().mockResolvedValue(1) });
  const rejected = expect(pending).rejects.toThrow("acknowledge pause");
  await vi.advanceTimersByTimeAsync(2000);
  await rejected;
});
