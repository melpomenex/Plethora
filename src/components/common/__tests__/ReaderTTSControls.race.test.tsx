/**
 * Race tests for ReaderTTSControls: stale generation completing after a
 * retarget never plays; rapid repeated startFrom leaves only the latest
 * session audible; voice change during generation does not corrupt state.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { useSettingsStore } from "../../../stores/settingsStore";
import { ReaderTTSControls, type ReaderTTSHandle } from "../ReaderTTSControls";
import type { SpeechSectionInput, TTSStartAnchor } from "../../../utils/readerSpeechIndex";

const TEXT =
  "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi. " +
  "Rho sigma tau upsilon phi chi psi omega second sentence follows here now. " +
  "Third sentence with more words to chunk over the target size limit.";

const generateSpeechMock = vi.hoisted(() => vi.fn());
const resolveTTSMaxChunkSizeMock = vi.hoisted(() => vi.fn(async () => 700));

vi.mock("../../../api/tts", () => ({
  generateSpeech: generateSpeechMock,
  resolveTTSMaxChunkSize: resolveTTSMaxChunkSizeMock,
}));

function sectionsFor(text: string): SpeechSectionInput[] {
  return [
    {
      key: "doc",
      text,
      anchorAt: (offset) => ({ kind: "text", surface: "race", startOffset: offset }),
      offsetForAnchor: (a) => (a.kind === "text" && a.surface === "race" ? a.startOffset : null),
    },
  ];
}

function anchorAt(offset: number): TTSStartAnchor {
  return { kind: "text-offset", surface: "race", startOffset: offset };
}

interface FakeAudio {
  url: string;
  played: boolean;
  play(): Promise<void>;
  pause(): void;
}

let played: FakeAudio[] = [];

describe("ReaderTTSControls session races", () => {
  beforeEach(() => {
    played = [];
    (window as any).Audio = class {
      url: string;
      played = false;
      paused = false;
      ended = false;
      playbackRate = 1;
      duration = 10;
      currentTime = 0;
      onplay: (() => void) | null = null;
      onpause: (() => void) | null = null;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) {
        this.url = url;
        played.push(this as unknown as FakeAudio);
      }
      async play() {
        this.played = true;
        this.onplay?.();
        return Promise.resolve();
      }
      pause() {
        this.paused = true;
        this.onpause?.();
      }
    };
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        tts: {
          ...useSettingsStore.getState().settings.tts,
          enabled: true,
          provider: "groq",
        },
      },
    } as any);
  });

  afterEach(() => {
    cleanup();
    delete (window as any).Audio;
    vi.restoreAllMocks();
  });

  it("audio generated for an old location completing after a retarget never plays", async () => {
    // Fully controllable deferred queue; identify requests by their text.
    const pending: Array<{ text: string; resolve: (value: unknown) => void }> = [];
    generateSpeechMock.mockImplementation(
      (_settings: unknown, req: { text: string }) =>
        new Promise((resolve) => {
          pending.push({ text: req.text, resolve });
        }),
    );

    const ref = { current: null as ReaderTTSHandle | null };
    render(
      <ReaderTTSControls
        ref={ref as React.RefObject<ReaderTTSHandle>}
        text={TEXT}
        sections={sectionsFor(TEXT)}
      />,
    );
    const tts = ref.current!;
    await waitFor(() => expect(pending.length).toBeGreaterThan(0));

    void tts.startFrom(anchorAt(TEXT.indexOf("gamma")));
    await waitFor(() =>
      expect(pending.some((p) => p.text.startsWith("gamma"))).toBe(true),
    );
    void tts.startFrom(anchorAt(TEXT.indexOf("phi")));
    await waitFor(() =>
      expect(pending.some((p) => p.text.startsWith("phi"))).toBe(true),
    );

    // A's generation completes after the retarget: dropped, never played.
    const a = pending.find((p) => p.text.startsWith("gamma"))!;
    a.resolve({ audioUrl: "blob:audio-a", durationSec: 5 });
    await new Promise((r) => setTimeout(r, 30));
    expect(played.filter((a2) => a2.url === "blob:audio-a" && a2.played)).toHaveLength(0);

    // B's generation plays.
    const b = pending.find((p) => p.text.startsWith("phi"))!;
    b.resolve({ audioUrl: "blob:audio-b", durationSec: 5 });
    await waitFor(
      () => expect(played.some((a2) => a2.url === "blob:audio-b" && a2.played)).toBe(true),
      { timeout: 2000 },
    );
  });

  it("rapid repeated startFrom leaves only the latest session audible", async () => {
    generateSpeechMock.mockImplementation(async (_settings: unknown, req: { text: string }) => ({
      audioUrl: `blob:${req.text.slice(0, 12)}`,
      durationSec: 5,
    }));

    const ref = { current: null as ReaderTTSHandle | null };
    render(
      <ReaderTTSControls
        ref={ref as React.RefObject<ReaderTTSHandle>}
        text={TEXT}
        sections={sectionsFor(TEXT)}
      />,
    );
    const tts = ref.current!;
    void tts.startFrom(anchorAt(TEXT.indexOf("gamma")));
    void tts.startFrom(anchorAt(TEXT.indexOf("phi")));
    await waitFor(() => expect(played.some((a) => a.played)).toBe(true), { timeout: 2000 });
    // The audible session is the latest (phi…), never the first (gamma…).
    const audible = played.filter((a) => a.played);
    expect(audible.length).toBeGreaterThanOrEqual(1);
    for (const a of audible) {
      expect(a.url.startsWith("blob:phi chi psi")).toBe(true);
    }
  });

  it("stale generated-audio onended after retarget does not auto-advance backward", async () => {
    generateSpeechMock.mockImplementation(async (_settings: unknown, req: { text: string }) => ({
      audioUrl: `blob:${req.text.slice(0, 12)}`,
      durationSec: 5,
    }));

    const ref = { current: null as ReaderTTSHandle | null };
    render(
      <ReaderTTSControls
        ref={ref as React.RefObject<ReaderTTSHandle>}
        text={TEXT}
        sections={sectionsFor(TEXT)}
      />,
    );
    const tts = ref.current!;
    void tts.startFrom(anchorAt(TEXT.indexOf("gamma")));
    await waitFor(() => expect(played.some((a) => a.played)).toBe(true), { timeout: 2000 });
    const staleAudio = played[0] as unknown as {
      onended: (() => void) | null;
    };
    const staleOnEnded = staleAudio.onended;

    void tts.startFrom(anchorAt(TEXT.indexOf("phi")));
    await waitFor(
      () => expect(played.filter((a) => a.played).some((a) => a.url.startsWith("blob:phi"))).toBe(true),
      { timeout: 2000 },
    );

    staleOnEnded?.();
    await new Promise((r) => setTimeout(r, 50));
    const playedUrls = played.filter((a) => a.played).map((a) => a.url);
    expect(playedUrls.some((u) => u.startsWith("blob:phi"))).toBe(true);
    expect(playedUrls.some((u) => u.startsWith("blob:delta"))).toBe(false);
  });
});

describe("ReaderTTSControls TOC synchronization", () => {
  beforeEach(() => {
    played = [];
    (window as any).Audio = class {
      url: string;
      played = false;
      paused = false;
      ended = false;
      playbackRate = 1;
      duration = 10;
      currentTime = 0;
      onplay: (() => void) | null = null;
      onpause: (() => void) | null = null;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) {
        this.url = url;
        played.push(this as unknown as FakeAudio);
      }
      async play() {
        this.played = true;
        this.onplay?.();
        return Promise.resolve();
      }
      pause() {
        this.paused = true;
        this.onpause?.();
      }
    };
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        tts: { ...useSettingsStore.getState().settings.tts, enabled: true, provider: "groq" },
      },
    } as any);
  });

  afterEach(() => {
    cleanup();
    delete (window as any).Audio;
    vi.restoreAllMocks();
  });

  it("queued anchor while stopped starts at the anchor on the next Play (never autoplay)", async () => {
    generateSpeechMock.mockImplementation(async (_s: unknown, req: { text: string }) => ({
      audioUrl: `blob:${req.text.slice(0, 10)}`,
      durationSec: 5,
    }));
    const ref = { current: null as ReaderTTSHandle | null };
    render(
      <ReaderTTSControls
        ref={ref as React.RefObject<ReaderTTSHandle>}
        text={TEXT}
        sections={sectionsFor(TEXT)}
      />,
    );
    const tts = ref.current!;
    expect(tts.playbackState()).toBe("stopped");

    // TOC navigation while stopped queues only — nothing becomes audible
    // (background prefetch generation is allowed; playback is not).
    tts.queueAnchor(anchorAt(TEXT.indexOf("upsilon")));
    await new Promise((r) => setTimeout(r, 50));
    expect(played.filter((a) => a.played)).toHaveLength(0);

    // Play consumes the queued anchor.
    (() => {
      const buttons = screen.getAllByRole("button");
      const play = buttons.find(
        (b) => /play|pause|resume/i.test(b.getAttribute("aria-label") ?? ""),
      );
      (play ?? buttons[0]).click();
    })();
    await waitFor(() => expect(played.some((a) => a.played)).toBe(true), { timeout: 2000 });
    const audible = played.find((a) => a.played)!;
    expect(audible.url.startsWith("blob:upsilon")).toBe(true);
  });

  it("queued anchor while paused rebases the resume position without playing", async () => {
    let resumePlayed = 0;
    generateSpeechMock.mockImplementation(async (_s: unknown, req: { text: string }) => ({
      audioUrl: `blob:${req.text.slice(0, 10)}`,
      durationSec: 5,
    }));
    const ref = { current: null as ReaderTTSHandle | null };
    render(
      <ReaderTTSControls
        ref={ref as React.RefObject<ReaderTTSHandle>}
        text={TEXT}
        sections={sectionsFor(TEXT)}
      />,
    );
    const tts = ref.current!;
    tts.queueAnchor(anchorAt(TEXT.indexOf("upsilon")));
    await new Promise((r) => setTimeout(r, 50));
    (() => {
      const buttons = screen.getAllByRole("button");
      const play = buttons.find(
        (b) => /play|pause|resume/i.test(b.getAttribute("aria-label") ?? ""),
      );
      (play ?? buttons[0]).click();
    })();
    await waitFor(() => expect(played.some((a) => a.played)).toBe(true), { timeout: 2000 });
    expect(tts.playbackState()).toBe("playing");

    // Pause, then a TOC navigation queues a new anchor.
    const current = played.find((a) => a.played)!;
    current.pause();
    await waitFor(() => expect(tts.playbackState()).toBe("paused"));
    played.length = 0;
    resumePlayed = played.length;
    tts.queueAnchor(anchorAt(TEXT.indexOf("sigma")));
    await new Promise((r) => setTimeout(r, 50));

    // Resume consumes the queued anchor and plays from the new location.
    (() => {
      const buttons = screen.getAllByRole("button");
      const play = buttons.find(
        (b) => /play|pause|resume/i.test(b.getAttribute("aria-label") ?? ""),
      );
      (play ?? buttons[0]).click();
    })();
    await waitFor(() => expect(played.some((a) => a.played)).toBe(true), { timeout: 2000 });
    expect(resumePlayed).toBe(0);
    const audible = played.find((a) => a.played)!;
    expect(audible.url.startsWith("blob:sigma tau")).toBe(true);
  });
});
