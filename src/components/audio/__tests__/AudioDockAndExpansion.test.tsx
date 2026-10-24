import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioPlaybackSnapshot, AudioSourceKey, ResolvedAudioItem } from "../../../types/audioEdition";
import type { AudioPlaybackOwner } from "../../../services/audio/audioPlaybackOwner";
import { AudioDockPresentation } from "../MiniAudioPlayer";
import { useAudioPlaybackStore } from "../../../stores/audioPlaybackStore";
import { resetAudioRuntimeForTests } from "../../../services/audio/audioRuntime";
import { dispatchApplicationBack, resetApplicationBackForTests } from "../../../lib/applicationBack";
import { registerOverlayDismissal, resetOverlayStackForTests } from "../../../lib/overlayStack";
import { withAudioBoundaries } from "../../../services/audio/audioCoordinates";
import { loadLocale } from "../../../lib/i18n";
import { useSettingsStore } from "../../../stores/settingsStore";

async function setTestLocale(locale: "en" | "de") {
  await loadLocale(locale);
  useSettingsStore.getState().updateSettingsCategory("general", { language: locale });
}

function baseSnapshot(overrides: Partial<AudioPlaybackSnapshot> = {}): AudioPlaybackSnapshot {
  const sourceKey: AudioSourceKey = overrides.sourceKey ?? {
    profileKey: "local",
    kind: "audiobook",
    sourceId: "book-1",
  };
  return {
    schemaVersion: 1,
    sourceKey,
    generation: 1,
    revision: 1,
    metadata: {
      sourceId: sourceKey.sourceId,
      sourceKind: sourceKey.kind,
      sessionId: "sess-1",
      title: "Deep Work: Rules for Focused Success in a Distracted World",
    },
    section: { id: "ch-1", index: 0, title: "Chapter 1: Deep Work Is Valuable" },
    state: "playing",
    playIntent: true,
    pauseReason: null,
    positionSec: 42,
    globalPositionSec: 42,
    sleepDeadlineMs: null,
    timeInPart: 42,
    partIndex: 0,
    durationSec: 120,
    playbackRate: 1,
    volume: 0.8,
    mediaRevision: "rev-1",
    checkpointSequence: 1,
    updatedAt: 1000,
    queue: [sourceKey],
    capabilities: {
      canPlay: true,
      canPause: true,
      canResume: true,
      canSeekRelative: true,
      canSeekAbsolute: true,
      precisePosition: true,
      canNext: true,
      canPrevious: false,
    },
    ...overrides,
  };
}

function createFakeOwner(initialSnapshot: AudioPlaybackSnapshot | null, resolvedItem?: ResolvedAudioItem) {
  let snap = initialSnapshot;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(fn => fn());
  const item: ResolvedAudioItem | null =
    resolvedItem ??
    (snap
      ? {
          sourceKey: snap.sourceKey,
          title: snap.metadata.title,
          documentId: snap.sourceKey.kind === "podcast" ? undefined : snap.sourceKey.sourceId,
          mediaRevision: "rev-1",
          complete: true,
          parts: withAudioBoundaries([
            { partId: "p1", sourceRevision: "rev-1", browserUrl: "/p1.mp3", durationSec: 60, title: "Part 1" },
            { partId: "p2", sourceRevision: "rev-1", browserUrl: "/p2.mp3", durationSec: 60, title: "Part 2" },
          ]),
        }
      : null);

  const owner: AudioPlaybackOwner = {
    initialize: vi.fn(),
    getSnapshot: () => snap,
    getIntentVersion: () => 1,
    getItem: vi.fn(() => item),
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: vi.fn(async (key, options) => {
      snap = baseSnapshot({
        sourceKey: key,
        state: options.intent === "play" ? "playing" : "paused",
        playIntent: options.intent === "play",
      });
      notify();
    }),
    play: vi.fn(async () => {
      if (snap) {
        snap = { ...snap, state: "playing", playIntent: true, revision: snap.revision + 1 };
        notify();
      }
    }),
    pause: vi.fn(async () => {
      if (snap) {
        snap = { ...snap, state: "paused", playIntent: false, revision: snap.revision + 1 };
        notify();
      }
    }),
    pauseForFocus: vi.fn(async () => {}),
    toggle: vi.fn(async () => {}),
    seekTo: vi.fn(async seconds => {
      if (snap) {
        snap = { ...snap, positionSec: seconds, globalPositionSec: seconds, timeInPart: seconds, revision: snap.revision + 1 };
        notify();
      }
    }),
    seekRelative: vi.fn(async delta => {
      if (snap) {
        const next = Math.max(0, snap.positionSec + delta);
        snap = { ...snap, positionSec: next, globalPositionSec: next, timeInPart: next, revision: snap.revision + 1 };
        notify();
      }
    }),
    selectChapter: vi.fn(async index => {
      if (snap) {
        snap = { ...snap, partIndex: index, revision: snap.revision + 1 };
        notify();
      }
    }),
    queueNext: vi.fn(async () => {}),
    queuePrevious: vi.fn(async () => {}),
    setRate: vi.fn(async rate => {
      if (snap) {
        snap = { ...snap, playbackRate: rate, revision: snap.revision + 1 };
        notify();
      }
    }),
    setVolume: vi.fn(async volume => {
      if (snap) {
        snap = { ...snap, volume, revision: snap.revision + 1 };
        notify();
      }
    }),
    setSleepTimer: vi.fn(deadlineMs => {
      if (snap) {
        snap = { ...snap, sleepDeadlineMs: deadlineMs, revision: snap.revision + 1 };
        notify();
      }
    }),
    flush: vi.fn(async () => {}),
    stopAndClose: vi.fn(async () => {
      snap = null;
      notify();
    }),
    command: vi.fn(async () => ({ disposition: "accepted" as const, snapshot: snap })),
    dispose: vi.fn(async () => {}),
  };

  return {
    owner,
    emitSnapshot: (next: AudioPlaybackSnapshot | null) => {
      snap = next;
      notify();
    },
  };
}

class ImmediateResizeObserver {
  private callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

beforeEach(async () => {
  localStorage.clear();
  resetOverlayStackForTests();
  resetApplicationBackForTests();
  await setTestLocale("en");
  globalThis.ResizeObserver = ImmediateResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(async () => {
  vi.restoreAllMocks();
  resetOverlayStackForTests();
  resetApplicationBackForTests();
  await setTestLocale("en");
  await resetAudioRuntimeForTests(null);
});

describe("Tasks 6.1–6.5 — AudioDock, ExpandedAudioPlayer, accessibility, geometry & errors", () => {
  it("6.1 & 6.5: reserves measured desktop height, adapts -30/+30 vs -10/+30, renders source-specific fallback art, and keeps ExpandedAudioPlayer lazy until opened", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("audio-dock-slot")) {
        return { top: 656, bottom: 720, left: 0, right: 853, width: 853, height: 64, x: 0, y: 656, toJSON() {} };
      }
      return { top: 0, bottom: 40, left: 0, right: 40, width: 40, height: 40, x: 0, y: 0, toJSON() {} };
    });

    const { owner, emitSnapshot } = createFakeOwner(baseSnapshot());
    await resetAudioRuntimeForTests(owner);

    render(
      <div className="adaptive-shell-root">
        <main>Workspace</main>
        <AudioDockPresentation mobile={false} fullscreen={false} />
      </div>,
    );

    const shell = document.querySelector<HTMLElement>(".adaptive-shell-root")!;
    expect(shell.style.getPropertyValue("--shell-audio-player-height")).toBe("64px");

    // ExpandedAudioPlayer never queried getItem while collapsed!
    expect(owner.getItem).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();

    // Audiobook uses -30s / +30s and audiobook fallback icon
    const region = screen.getByRole("region", { name: "Audio player" });
    expect(region.querySelector('[data-fallback-kind="audiobook"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back 30 seconds" }));
    await waitFor(() => expect(owner.seekRelative).toHaveBeenCalledWith(-30));
    fireEvent.click(screen.getByRole("button", { name: "Forward 30 seconds" }));
    await waitFor(() => expect(owner.seekRelative).toHaveBeenCalledWith(30));

    // Switch to recording -> -10s / +30s and recording fallback icon; podcast & audio_edition fallbacks
    act(() => {
      emitSnapshot(
        baseSnapshot({
          sourceKey: { profileKey: "local", kind: "recording", sourceId: "rec-1" },
          metadata: { sourceId: "rec-1", sourceKind: "recording", sessionId: "sess-2", title: "Lecture 1" },
        }),
      );
    });
    expect(region.querySelector('[data-fallback-kind="recording"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back 10 seconds" }));
    await waitFor(() => expect(owner.seekRelative).toHaveBeenCalledWith(-10));

    act(() => {
      emitSnapshot(
        baseSnapshot({
          sourceKey: { profileKey: "local", kind: "podcast", sourceId: "pod-1" },
          metadata: {
            sourceId: "pod-1",
            sourceKind: "podcast",
            sessionId: "sess-3",
            title: "Episode 1",
            artworkUrl: "https://broken.example.test/art.jpg",
          },
        }),
      );
    });
    const artImg = region.querySelector(".audio-player-art img") as HTMLImageElement;
    expect(artImg).not.toBeNull();
    // Broken artwork falls back once without re-mounting <img>
    fireEvent.error(artImg);
    expect(region.querySelector(".audio-player-art img")).toBeNull();
    expect(region.querySelector('[data-fallback-kind="podcast"]')).not.toBeNull();

    // Stop and close clears dock and --shell-audio-player-height
    fireEvent.click(screen.getByRole("button", { name: "Stop and close" }));
    await waitFor(() => expect(owner.stopAndClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("region", { name: "Audio player" })).toBeNull();
    expect(shell.style.getPropertyValue("--shell-audio-player-height")).toBe("");
  });

  it("6.2: suppresses mobile dock visibility on cramped keyboard while keeping reserved height, inerts under modals, and compensates selected reading anchor", async () => {
    let scrollerTop = 0;
    let scrollerHeight = 700;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("audio-dock-slot")) {
        return { top: 618, bottom: 682, left: 0, right: 360, width: 360, height: 64, x: 0, y: 618, toJSON() {} };
      }
      if (this.dataset.testid === "reader-scroller") {
        return { top: 0, bottom: scrollerHeight, left: 0, right: 360, width: 360, height: scrollerHeight, x: 0, y: 0, toJSON() {} };
      }
      return { top: 0, bottom: 48, left: 0, right: 48, width: 48, height: 48, x: 0, y: 0, toJSON() {} };
    });

    const { owner, emitSnapshot } = createFakeOwner(null);
    await resetAudioRuntimeForTests(owner);

    // Android WebView exposes visualViewport for the lifetime of the page; define it
    // before mount so the dock subscribes to the real virtual-keyboard source.
    const listeners = new Set<() => void>();
    const fakeViewport = {
      height: 800,
      offsetTop: 0,
      addEventListener: (_type: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_type: string, cb: () => void) => listeners.delete(cb),
    };
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    Object.defineProperty(window, "visualViewport", { value: fakeViewport, configurable: true });

    render(
      <div className="adaptive-shell-root" data-mobile-shell="true">
        <div
          data-testid="reader-scroller"
          style={{ overflowY: "auto", height: "700px" }}
          ref={el => {
            if (el) {
              Object.defineProperty(el, "scrollHeight", { value: 2000, configurable: true });
              Object.defineProperty(el, "clientHeight", { value: 700, configurable: true });
              Object.defineProperty(el, "scrollTop", {
                get: () => scrollerTop,
                set: v => {
                  scrollerTop = v;
                },
                configurable: true,
              });
            }
          }}
        >
          <p data-testid="selected-para">Selected paragraph near bottom edge</p>
        </div>
        <AudioDockPresentation mobile fullscreen={false} />
      </div>,
    );

    // Select the paragraph positioned at y=660..690 (visible inside 0..700 before 64px dock mounts,
    // covered once effective bottom shrinks to 636!).
    const para = screen.getByTestId("selected-para");
    const range = document.createRange();
    range.selectNodeContents(para);
    range.getBoundingClientRect = () =>
      ({ top: 660, bottom: 690, left: 16, right: 340, width: 324, height: 30, x: 16, y: 660, toJSON() {} }) as DOMRect;
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    act(() => {
      emitSnapshot(baseSnapshot());
    });

    const shell = document.querySelector<HTMLElement>(".adaptive-shell-root")!;
    expect(shell.style.getPropertyValue("--shell-audio-player-height")).toBe("64px");
    // Compensated scrollTop by (690 - (700 - 64) + 8) = 62px so selected paragraph stays visible!
    expect(scrollerTop).toBe(62);
    sel.removeAllRanges();

    const slot = document.querySelector<HTMLElement>(".audio-dock-slot")!;
    expect(slot.style.visibility).toBe("");

    // Modal overlay inerts dock without hiding its surface
    let dismissModal!: () => void;
    act(() => {
      dismissModal = registerOverlayDismissal(() => {}, { priority: 100, owner: { scope: "global" } });
    });
    expect(slot.getAttribute("aria-hidden")).toBe("true");
    act(() => {
      dismissModal();
    });
    expect(slot.getAttribute("aria-hidden")).toBeNull();

    // Cramped virtual keyboard hides presentation while retaining --shell-audio-player-height = 64px!
    act(() => {
      fakeViewport.height = 300;
      window.dispatchEvent(new Event("resize"));
    });
    expect(slot.style.visibility).toBe("hidden");
    expect(slot.getAttribute("aria-hidden")).toBe("true");
    expect(shell.style.getPropertyValue("--shell-audio-player-height")).toBe("64px");

    act(() => {
      fakeViewport.height = 800;
      window.dispatchEvent(new Event("resize"));
    });
    expect(slot.style.visibility).toBe("");
    expect(slot.getAttribute("aria-hidden")).toBeNull();
  });

  it("6.2: fullscreen presentation hides the dock while the session stays active", async () => {
    const { owner } = createFakeOwner(baseSnapshot());
    await resetAudioRuntimeForTests(owner);
    const { rerender } = render(
      <div className="adaptive-shell-root">
        <AudioDockPresentation mobile fullscreen={false} />
      </div>,
    );
    const shell = document.querySelector<HTMLElement>(".adaptive-shell-root")!;
    expect(document.querySelector<HTMLElement>(".audio-dock-slot")!.hidden).toBe(false);

    rerender(
      <div className="adaptive-shell-root">
        <AudioDockPresentation mobile fullscreen />
      </div>,
    );
    expect(document.querySelector<HTMLElement>(".audio-dock-slot")!.hidden).toBe(true);
    expect(shell.style.getPropertyValue("--shell-audio-player-height")).toBe("");
    expect(owner.stopAndClose).not.toHaveBeenCalled();
    expect(useAudioPlaybackStore.getState().snapshot).not.toBeNull();
  });

  it("6.3: Back/Escape collapses ExpandedAudioPlayer before leaving review task, preserves flashcard state, and restores invoker focus", async () => {
    const { owner } = createFakeOwner(
      baseSnapshot({
        queue: [
          { profileKey: "local", kind: "audiobook", sourceId: "book-1" },
          { profileKey: "local", kind: "audiobook", sourceId: "book-2" },
        ],
      }),
    );
    await resetAudioRuntimeForTests(owner);

    let cardAnswerRevealed = true;
    let cardGraded = false;

    render(
      <div className="adaptive-shell-root" data-mobile-shell="true">
        <section data-testid="flashcard-review">
          <p>{cardAnswerRevealed ? "Answer: Active recall" : "Hidden"}</p>
          <button
            type="button"
            onClick={() => {
              cardGraded = true;
            }}
          >
            Grade Good
          </button>
        </section>
        <AudioDockPresentation mobile fullscreen={false} />
      </div>,
    );

    const expandButton = screen.getByRole("button", { name: /^Expand audio player:/ });
    expandButton.focus();
    fireEvent.click(expandButton);

    const dialog = await screen.findByRole("dialog", { name: "Audio player" });
    expect(dialog).toBeInTheDocument();
    // No second engine or reload triggered by opening expansion
    expect(owner.initialize).not.toHaveBeenCalled();
    expect(owner.load).not.toHaveBeenCalled();

    // Operate speed, sleep, chapter, and bookmark inside expanded player
    fireEvent.change(screen.getByLabelText("Playback speed"), { target: { value: "1.5" } });
    await waitFor(() => expect(owner.setRate).toHaveBeenCalledWith(1.5));

    fireEvent.change(screen.getByLabelText("Chapter"), { target: { value: "1" } });
    await waitFor(() => expect(owner.selectChapter).toHaveBeenCalledWith(1));

    // Android system Back collapses expanded player FIRST without grading card or leaving view
    let backOutcome!: ReturnType<typeof dispatchApplicationBack>;
    act(() => {
      backOutcome = dispatchApplicationBack({ source: "android-system", id: "android-back-1" });
    });
    expect(backOutcome.kind).toBe("consumed");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Audio player" })).toBeNull());
    expect(cardGraded).toBe(false);
    expect(screen.getByText("Answer: Active recall")).toBeInTheDocument();
    // Playback and mini player stay active after collapse!
    expect(owner.stopAndClose).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Audio player" })).toBeInTheDocument();

    await waitFor(() => {
      expect(document.activeElement).toBe(expandButton);
    });
  });

  it("6.4: localizes labels, exposes slider aria-valuetext, suppresses tick announcements, and never steals typing or review keys", async () => {
    await setTestLocale("de");
    const { owner, emitSnapshot } = createFakeOwner(baseSnapshot({ durationSec: null, capabilities: {
      canPlay: true,
      canPause: true,
      canResume: true,
      canSeekRelative: true,
      canSeekAbsolute: false,
      precisePosition: true,
      canNext: false,
      canPrevious: false,
    } }));
    await resetAudioRuntimeForTests(owner);

    render(
      <div className="adaptive-shell-root">
        <textarea aria-label="Editor" defaultValue="Initial note" />
        <div data-testid="editable" contentEditable suppressContentEditableWarning>
          Article paragraph
        </div>
        <AudioDockPresentation mobile={false} fullscreen={false} />
      </div>,
    );

    // Localized German landmark & controls
    expect(screen.getByRole("region", { name: "Audioplayer" })).toBeInTheDocument();
    const liveStatus = screen.getByTestId("audio-player-live-status");
    const initialAnnouncement = liveStatus.textContent;
    expect(initialAnnouncement).toContain("Wiedergabe läuft");

    // Position ticks do NOT alter the live status announcement!
    act(() => {
      emitSnapshot(baseSnapshot({ positionSec: 43, timeInPart: 43, globalPositionSec: 43, durationSec: null }));
      emitSnapshot(baseSnapshot({ positionSec: 44, timeInPart: 44, globalPositionSec: 44, durationSec: null }));
    });
    expect(liveStatus.textContent).toBe(initialAnnouncement);

    // Typing Space / ArrowRight in textarea or contenteditable NEVER triggers play/pause/seek!
    const editor = screen.getByLabelText("Editor");
    editor.focus();
    fireEvent.keyDown(editor, { key: " ", code: "Space" });
    fireEvent.keyDown(editor, { key: "ArrowRight", code: "ArrowRight" });
    const editable = screen.getByTestId("editable");
    fireEvent.keyDown(editable, { key: " ", code: "Space" });
    expect(owner.pause).not.toHaveBeenCalled();
    expect(owner.play).not.toHaveBeenCalled();
    expect(owner.seekRelative).not.toHaveBeenCalled();

    // Open expanded view and verify unknown-duration slider disabled + localized aria-valuetext
    fireEvent.click(screen.getByRole("button", { name: "Audioplayer erweitern" }));
    const dialog = await screen.findByRole("dialog", { name: "Audioplayer" });
    const sliders = dialog.querySelectorAll('input[type="range"]');
    const progressSlider = sliders[0] as HTMLInputElement;
    const volumeSlider = sliders[1] as HTMLInputElement;
    expect(progressSlider.disabled).toBe(true);
    expect(progressSlider.getAttribute("aria-valuetext")).toContain("Dauer nicht verfügbar");
    expect(volumeSlider.getAttribute("aria-valuetext")).toContain("80");
  });
});
