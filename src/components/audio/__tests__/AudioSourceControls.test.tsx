import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AudioSourceControls } from "../AudioSourceControls";
import { useAudioPlaybackStore } from "../../../stores/audioPlaybackStore";
import type { AudioPlaybackSnapshot } from "../../../types/audioEdition";

const owner = vi.hoisted(() => ({ load: vi.fn(async () => undefined), stopAndClose: vi.fn(), dispose: vi.fn(), seekTo: vi.fn(), getSnapshot: vi.fn() }));
vi.mock("../../../services/audio/audioRuntime", () => ({ getGlobalAudioController: () => owner }));
const key = { profileKey: "local", kind: "recording" as const, sourceId: "recording-one" };
afterEach(() => { cleanup(); vi.clearAllMocks(); useAudioPlaybackStore.setState({ snapshot: null, controlError: null }); });

it("an inactive source stays passive until explicit Play and unmount never stops playback", async () => {
  const view = render(<AudioSourceControls sourceKey={key} title="Recording" />);
  expect(owner.load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await waitFor(() => expect(owner.load).toHaveBeenCalledWith(key, { intent: "play" }));
  view.unmount();
  expect(owner.stopAndClose).not.toHaveBeenCalled();
  expect(owner.dispose).not.toHaveBeenCalled();
});

it("reattachment does not replay an old initial seek and reports only the matching source", async () => {
  const time = vi.fn();
  const sample = { sourceKey: key, metadata: { sessionId: "s", title: "Recording" }, positionSec: 42, durationSec: 120, state: "paused", playIntent: false, capabilities: { canSeekRelative: true } } as AudioPlaybackSnapshot;
  useAudioPlaybackStore.setState({ snapshot: sample });
  const view = render(<AudioSourceControls sourceKey={key} title="Recording" initialSeekTime={3} onTimeUpdate={time} />);
  expect(owner.load).not.toHaveBeenCalled();
  expect(time).toHaveBeenCalledWith(42);
  act(() => useAudioPlaybackStore.setState({ snapshot: { ...sample, sourceKey: { ...key, sourceId: "other" }, positionSec: 90 } }));
  expect(time).toHaveBeenCalledTimes(1);
  view.unmount();
});

it("transcript-only or unfinished sessions cannot take over from an existing source", () => {
  render(<AudioSourceControls sourceKey={key} title="Recording" autoPlay initialSeekTime={3} unavailable="Finish recording before playing" />);
  expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  expect(owner.load).not.toHaveBeenCalled();
});
