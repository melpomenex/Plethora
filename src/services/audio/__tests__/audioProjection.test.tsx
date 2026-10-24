import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  bindAudioPlaybackProjection,
  selectAudioExpanded,
  selectAudioIsPlaying,
  selectAudioPositionSec,
  selectAudioTitle,
  useAudioPlaybackStore,
} from "../../../stores/audioPlaybackStore";
import { GlobalAudioController } from "../globalAudioController";
import { AudioPlaybackPersistence } from "../audioPlaybackPersistence";
import { withAudioBoundaries } from "../audioCoordinates";
import type { AudioEngine } from "../htmlAudioEngine";
import type { AudioPlaybackSnapshot, AudioSourceKey } from "../../../types/audioEdition";
import { useTabsStore } from "../../../stores/tabsStore";

afterEach(() => {
  cleanup();
  useAudioPlaybackStore.setState({ snapshot: null, expanded: false });
});

it("position notifications do not render title-only shell consumers and detached views release subscriptions", () => {
  let snapshot = { metadata: { title: "A long audiobook" }, positionSec: 0 } as AudioPlaybackSnapshot;
  const listeners = new Set<() => void>();
  const unsubscribe = bindAudioPlaybackProjection({ getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } } as GlobalAudioController);
  const shellRender = vi.fn();
  const progressRender = vi.fn();
  function Shell() {
    const title = useAudioPlaybackStore(selectAudioTitle);
    shellRender();
    return <span>{title}</span>;
  }
  function Progress() {
    const seconds = useAudioPlaybackStore(selectAudioPositionSec);
    progressRender();
    return <span>{seconds}</span>;
  }
  const view = render(<><Shell /><Progress /></>);
  act(() => { snapshot = { ...snapshot, positionSec: 1 }; listeners.forEach(listener => listener()); });
  expect(shellRender).toHaveBeenCalledTimes(1);
  expect(progressRender).toHaveBeenCalledTimes(2);
  view.unmount();
  unsubscribe();
  expect(listeners.size).toBe(0);
});

it("preserves single-engine playback across tab eviction, tab close, split panes, and responsive wrapper swaps", async () => {
  const sample = { timeInPart: 14, durationSec: 120, paused: true, seekable: true };
  const engine: AudioEngine = {
    sample: () => ({ ...sample }),
    load: vi.fn(async () => { sample.timeInPart = 0; }),
    play: vi.fn(async () => { sample.paused = false; }),
    pause: vi.fn(async () => { sample.paused = true; }),
    seek: vi.fn(sec => { sample.timeInPart = sec; }),
    setRate: vi.fn(),
    setVolume: vi.fn(),
    unload: vi.fn(),
    dispose: vi.fn(),
  };
  const createEngine = vi.fn(() => engine);
  const sourceKey: AudioSourceKey = { profileKey: "local", kind: "audiobook", sourceId: "doc-audio-1" };
  const controller = new GlobalAudioController({
    createEngine,
    resolve: async key => ({
      sourceKey: key,
      title: "Persistent Book",
      documentId: key.sourceId,
      mediaRevision: "rev-1",
      complete: true,
      parts: withAudioBoundaries([{ partId: "p0", sourceRevision: "rev-1", browserUrl: "/stream/book.mp3", durationSec: 120 }]),
    }),
    persistence: new AudioPlaybackPersistence({ commit: async () => undefined }),
  });
  const unbind = bindAudioPlaybackProjection(controller);

  useTabsStore.getState().closeAllTabs();
  const audioTabId = useTabsStore.getState().addTab({
    title: "Audio Book",
    icon: null,
    type: "document-viewer",
    content: () => null,
    closable: true,
    data: { documentId: "doc-audio-1" },
  });

  await act(async () => {
    await controller.load(sourceKey, { intent: "play" });
    useAudioPlaybackStore.setState({ expanded: true });
  });

  function SourcePresentation() {
    const playing = useAudioPlaybackStore(selectAudioIsPlaying);
    return <div data-testid="source-view">{playing ? "playing" : "paused"}</div>;
  }

  function ResponsiveShell({ mobile }: { mobile: boolean }) {
    const tabsState = useTabsStore();
    const isEvicted = tabsState.evictedTabIds.has(audioTabId);
    const hasTab = tabsState.tabs.some(t => t.id === audioTabId);
    const title = useAudioPlaybackStore(selectAudioTitle);
    return mobile ? (
      <div data-layout="mobile">
        <span>{title}</span>
        {hasTab && !isEvicted ? <SourcePresentation /> : null}
      </div>
    ) : (
      <section data-layout="desktop">
        <span>{title}</span>
        {hasTab && !isEvicted ? <SourcePresentation /> : null}
      </section>
    );
  }

  const shell = render(<ResponsiveShell mobile={false} />);
  expect(shell.queryByTestId("source-view")?.textContent).toBe("playing");

  // 1. Reader-cap eviction: opening 2 more document-viewer tabs evicts the audiobook tab (DEFAULT_READER_TAB_CAP = 2)
  act(() => {
    useTabsStore.getState().addTab({ title: "EPUB 1", icon: null, type: "document-viewer", content: () => null, closable: true, data: { documentId: "epub-1" } });
    useTabsStore.getState().addTab({ title: "EPUB 2", icon: null, type: "document-viewer", content: () => null, closable: true, data: { documentId: "epub-2" } });
  });
  expect(useTabsStore.getState().evictedTabIds.has(audioTabId)).toBe(true);
  expect(shell.queryByTestId("source-view")).toBeNull();
  expect(controller.getSnapshot()?.state).toBe("playing");

  // 2. Split pane + responsive desktop <-> mobile branch swap
  const rootPaneId = useTabsStore.getState().rootPane.id;
  act(() => {
    useTabsStore.getState().splitPane(rootPaneId, audioTabId, "horizontal", "after");
  });
  shell.rerender(<ResponsiveShell mobile={true} />);
  shell.rerender(<ResponsiveShell mobile={false} />);

  // 3. Explicit tab close
  act(() => {
    useTabsStore.getState().closeTab(audioTabId);
  });
  expect(useTabsStore.getState().tabs.some(t => t.id === audioTabId)).toBe(false);

  expect(createEngine).toHaveBeenCalledTimes(1);
  expect(engine.load).toHaveBeenCalledTimes(1);
  expect(engine.unload).not.toHaveBeenCalled();
  expect(engine.dispose).not.toHaveBeenCalled();
  expect(controller.getSnapshot()?.state).toBe("playing");
  expect(selectAudioExpanded(useAudioPlaybackStore.getState())).toBe(true);

  // Stopping resets expanded state cleanly
  await act(async () => {
    await controller.stopAndClose();
  });
  expect(selectAudioExpanded(useAudioPlaybackStore.getState())).toBe(false);

  unbind();
  await controller.dispose();
});
