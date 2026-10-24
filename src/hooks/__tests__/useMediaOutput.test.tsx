import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMediaOutput } from "../useMediaOutput";
import { appAudioFocus } from "../../services/audio/audioFocus";

vi.mock("../../services/audio/audioPlaybackRollout", () => ({ GLOBAL_AUDIO_PLAYBACK_ENABLED: true }));
afterEach(cleanup);

function element() {
  const media = { paused: true, play: vi.fn(async () => { media.paused = false; }), pause: vi.fn(() => { media.paused = true; }) };
  return { media, ref: { current: media as unknown as HTMLMediaElement } };
}

it("revocation acknowledges pause before another output is granted", async () => {
  const { media, ref } = element();
  const { result } = renderHook(() => useMediaOutput(ref, "fixture:a"));
  await act(async () => { expect(await result.current.play()).toBe(true); });
  expect(media.paused).toBe(false);
  const capture = await appAudioFocus.acquire("test-media-capture", () => undefined);
  expect(media.paused).toBe(true);
  expect(media.pause).toHaveBeenCalledTimes(1);
  capture.release();
});

it("an unmounted pending request cannot start its media element", async () => {
  let acknowledge!: () => void;
  const prior = await appAudioFocus.acquire("test-slow-output", () => new Promise<void>(resolve => { acknowledge = resolve; }));
  const { media, ref } = element();
  const { result, unmount } = renderHook(() => useMediaOutput(ref, "fixture:a"));
  const playing = result.current.play();
  await vi.waitFor(() => expect(acknowledge).toBeTypeOf("function"));
  unmount();
  acknowledge();
  expect(await playing).toBe(false);
  expect(media.play).not.toHaveBeenCalled();
  prior.release();
});

it("unmount pauses the captured element even after React clears the ref", async () => {
  const { media, ref } = element();
  const { result, unmount } = renderHook(() => useMediaOutput(ref, "fixture:a"));
  await act(async () => { await result.current.play(); });
  ref.current = null!;
  unmount();
  expect(media.paused).toBe(true);
});
