import { afterEach, expect, it, vi } from "vitest";
import type { AudioCheckpoint } from "../../../types/audioEdition";
import { AudioPlaybackPersistence } from "../audioPlaybackPersistence";

function checkpoint(position: number, sourceId = "book"): AudioCheckpoint {
  return { schemaVersion: 1, sourceKey: { profileKey: "test", kind: "audiobook", sourceId }, ownerEpoch: "owner", sessionId: "session", checkpointSequence: position + 1, mediaRevision: "v1", partIndex: 0, timeInPart: position, positionSec: position, durationSec: 100, playbackRate: 1, updatedAt: Date.now() };
}
afterEach(() => vi.useRealTimers());

it("coalesces slider saves while one commit is in flight without dropping a retired identity", async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const commit = vi.fn().mockImplementationOnce(() => blocked).mockResolvedValue(undefined);
  const writer = new AudioPlaybackPersistence({ commit });
  const first = writer.enqueue(checkpoint(1));
  for (let position = 2; position <= 100; position++) void writer.enqueue(checkpoint(position));
  void writer.enqueue(checkpoint(6, "podcast"));
  release();
  await first;
  expect(commit.mock.calls.map(([value]) => [value.sourceKey.sourceId, value.positionSec])).toEqual([["book", 1], ["book", 100], ["podcast", 6]]);
  await writer.enqueue(checkpoint(100));
  expect(commit).toHaveBeenCalledTimes(3);
  writer.dispose();
});

it("retains dirty progress on failure and uses bounded backoff before successful retry", async () => {
  vi.useFakeTimers();
  const commit = vi.fn().mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const onError = vi.fn();
  const writer = new AudioPlaybackPersistence({ commit, onError });
  await writer.enqueue(checkpoint(1));
  expect(writer.getDirty()).toHaveLength(1);
  expect(() => writer.dispose()).toThrow("pending");
  await vi.advanceTimersByTimeAsync(999);
  expect(commit).toHaveBeenCalledTimes(1);
  await writer.enqueue(checkpoint(4));
  expect(commit).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2001);
  expect(commit).toHaveBeenCalledTimes(3);
  expect(commit.mock.calls[2][0].positionSec).toBe(4);
  expect(writer.getDirty()).toHaveLength(0);
  expect(onError).toHaveBeenCalledTimes(2);
  writer.dispose();
});

it("rejects capacity overflow rather than discarding unacknowledged source progress", async () => {
  vi.useFakeTimers();
  const writer = new AudioPlaybackPersistence({ commit: vi.fn().mockRejectedValue(new Error("offline")) });
  for (let index = 0; index < 128; index++) await writer.enqueue(checkpoint(1, String(index)));
  await expect(writer.enqueue(checkpoint(1, "overflow"))).rejects.toThrow("capacity");
  expect(writer.getDirty()).toHaveLength(128);
  vi.clearAllTimers();
});

it("stops retrying after the bounded budget and retries on the next explicit transition", async () => {
  vi.useFakeTimers();
  const commit = vi.fn().mockRejectedValue(new Error("storage unavailable"));
  const writer = new AudioPlaybackPersistence({ commit });
  await writer.enqueue(checkpoint(1));
  await vi.advanceTimersByTimeAsync(45_000);
  expect(commit).toHaveBeenCalledTimes(6);
  await writer.enqueue(checkpoint(8));
  await vi.advanceTimersByTimeAsync(300_000);
  expect(commit).toHaveBeenCalledTimes(6);
  commit.mockResolvedValue(undefined);
  await writer.enqueue(checkpoint(9), true);
  expect(commit).toHaveBeenCalledTimes(7);
  expect(writer.getDirty()).toHaveLength(0);
  writer.dispose();
});

it("preserves an intentional rewind to the last saved position during a newer in-flight write", async () => {
  let release!: () => void;
  const commit = vi.fn().mockResolvedValue(undefined);
  const writer = new AudioPlaybackPersistence({ commit });
  await writer.enqueue(checkpoint(10));
  commit.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const pending = writer.enqueue(checkpoint(20));
  void writer.enqueue(checkpoint(10));
  release();
  await pending;
  expect(commit.mock.calls.map(([value]) => value.positionSec)).toEqual([10, 20, 10]);
  writer.dispose();
});
