/**
 * Pause/resume correctness (#5) and cross-feature sequence tests for
 * ReaderTTSControls: pausing at a mid-session chunk keeps the position (mouse),
 * resume never re-anchors to the auto-follow viewport top, deliberate scroll
 * while paused re-anchors with a sentence look-behind, text re-extraction
 * while paused preserves the session position, and the full
 * start → reach → pause → no-jump → resume → restart → restore sequence works
 * end to end through listening-position persistence.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { useSettingsStore } from "../../../stores/settingsStore";
import { ReaderTTSControls, type ReaderTTSHandle } from "../ReaderTTSControls";
import type { SpeechSectionInput, SourceAnchor } from "../../../utils/readerSpeechIndex";

const generateSpeechMock = vi.hoisted(() => vi.fn());
const resolveTTSMaxChunkSizeMock = vi.hoisted(() => vi.fn(async () => 120));

vi.mock("../../../api/tts", () => ({
  generateSpeech: generateSpeechMock,
  resolveTTSMaxChunkSize: resolveTTSMaxChunkSizeMock,
}));

const SECTION_COUNT = 60;
const TEXT = Array.from(
  { length: SECTION_COUNT },
  (_, i) => `Section ${i} alpha beta gamma delta epsilon zeta. Eta theta iota kappa lambda mu nu xi omicron pi.`,
).join(" ");

function sectionsFor(text: string): SpeechSectionInput[] {
  return [
    {
      key: "doc",
      text,
      anchorAt: (offset) => ({ kind: "text", surface: "test", startOffset: offset }),
      offsetForAnchor: (anchor) =>
        anchor.kind === "text" && anchor.surface === "test" ? anchor.startOffset : null,
    },
  ];
}

function anchorAtWord(word: string): SourceAnchor {
  return { kind: "text", surface: "test", startOffset: TEXT.indexOf(word) };
}

interface SpeechHarness {
  speakMock: ReturnType<typeof vi.fn>;
  pauseMock: ReturnType<typeof vi.fn>;
  resumeMock: ReturnType<typeof vi.fn>;
  cancelMock: ReturnType<typeof vi.fn>;
}

function mockSystemSpeech(): SpeechHarness {
  const speakMock = vi.fn();
  const pauseMock = vi.fn();
  const resumeMock = vi.fn();
  const cancelMock = vi.fn();
  (window as any).speechSynthesis = {
    speak: speakMock,
    cancel: cancelMock,
    pause: pauseMock,
    resume: resumeMock,
    getVoices: () => [],
    onvoiceschanged: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  (window as any).SpeechSynthesisUtterance = class {
    text: string;
    rate: number = 1;
    voice: unknown = null;
    lang: string = "";
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onboundary: ((event: { charIndex: number }) => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  };
  return { speakMock, pauseMock, resumeMock, cancelMock };
}

interface FakeAudio {
  url: string;
  played: boolean;
  play(): Promise<void>;
  pause(): void;
}

function mockWindowAudio(played: FakeAudio[]) {
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
}

describe("ReaderTTSControls pause/resume correctness (#5)", () => {
  let harness: SpeechHarness;

  beforeEach(() => {
    localStorage.clear();
    harness = mockSystemSpeech();
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        tts: {
          ...useSettingsStore.getState().settings.tts,
          enabled: true,
          provider: "system",
        },
      },
    } as any);
  });

  afterEach(async () => {
    cleanup();
    delete (window as any).speechSynthesis;
    delete (window as any).SpeechSynthesisUtterance;
    delete (window as any).Audio;
    vi.restoreAllMocks();
  });

  function pressPlayPause() {
    const buttons = screen.getAllByRole("button");
    buttons[1].click();
  }

  function chunkCounter(): string {
    const el = screen.getByText(/\d+\/\d+/);
    return el.textContent ?? "";
  }

  /** Fire `onstart` so the system provider is in the playing state. */
  async function makePlaying() {
    harness.speakMock.mock.calls.at(-1)?.[0]?.onstart?.();
    await new Promise((r) => setTimeout(r, 0));
  }

  /**
   * Auto-advance from the current chunk until `onChunkStart` reports a chunk
   * whose text contains `needle`; returns that chunk index.
   */
  async function advanceToTextContaining(
    onChunkStart: ReturnType<typeof vi.fn>,
    needle: string,
  ): Promise<number> {
    for (let i = 0; i < 300; i++) {
      const last = onChunkStart.mock.calls.at(-1);
      if (last && String(last[1]).includes(needle)) {
        await makePlaying();
        return last[0] as number;
      }
      const u = harness.speakMock.mock.calls.at(-1)?.[0];
      if (!u) throw new Error(`no utterance available while seeking ${needle}`);
      u.onstart?.();
      u.onend?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    throw new Error(`timed out seeking chunk containing ${needle}`);
  }

  it("pause at a mid-session chunk keeps the current position (mouse)", async () => {
    const onChunkStart = vi.fn();
    render(
      <ReaderTTSControls
        text={TEXT}
        sections={sectionsFor(TEXT)}
        resolveViewportAnchor={() => null}
        onChunkStart={onChunkStart}
      />,
    );
    pressPlayPause();
    await waitFor(() => expect(harness.speakMock).toHaveBeenCalled());
    const at = await advanceToTextContaining(onChunkStart, "Section 5");
    const beforePause = chunkCounter();
    expect(beforePause).toMatch(new RegExp(`^${at + 1}/`));

    pressPlayPause();
    await waitFor(() => expect(harness.pauseMock).toHaveBeenCalled());

    // Position is frozen: same chunk counter, no reset to the session start.
    expect(chunkCounter()).toBe(beforePause);
  });

  it("resume does NOT re-anchor to the auto-follow viewport top (#5)", async () => {
    const onChunkStart = vi.fn();
    let viewportWord = "Section 0";
    render(
      <ReaderTTSControls
        text={TEXT}
        sections={sectionsFor(TEXT)}
        resolveViewportAnchor={() => anchorAtWord(viewportWord)}
        onChunkStart={onChunkStart}
      />,
    );
    pressPlayPause();
    await waitFor(() => expect(harness.speakMock).toHaveBeenCalled());
    const at = await advanceToTextContaining(onChunkStart, "Section 5");

    // Simulate the auto-follow viewport top sitting back at the session start
    // while the active chunk is later.
    viewportWord = "Section 0";

    pressPlayPause();
    await waitFor(() => expect(harness.pauseMock).toHaveBeenCalled());
    const speaksBeforeResume = harness.speakMock.mock.calls.length;
    const counterBeforeResume = chunkCounter();

    pressPlayPause();
    await waitFor(() => expect(harness.resumeMock).toHaveBeenCalled());

    // Exact resume: no new utterance (no re-anchor to chunk 0), position kept.
    expect(harness.speakMock.mock.calls.length).toBe(speaksBeforeResume);
    expect(chunkCounter()).toBe(counterBeforeResume);
    expect(chunkCounter()).toMatch(new RegExp(`^${at + 1}/`));
  });

  it("deliberate scroll while paused re-anchors to the viewport with sentence look-behind", async () => {
    const scrollText =
      "Alpha beta gamma delta. Epsilon zeta eta theta iota kappa. Lambda mu nu xi omicron pi rho. " +
      "Sigma tau upsilon phi chi psi omega.";
    const sections = [
      {
        key: "doc",
        text: scrollText,
        anchorAt: (offset: number) => ({ kind: "text" as const, surface: "test", startOffset: offset }),
        offsetForAnchor: (anchor: SourceAnchor) =>
          anchor.kind === "text" && anchor.surface === "test" ? anchor.startOffset : null,
      },
    ];
    let viewportOffset = scrollText.indexOf("delta");
    render(
      <ReaderTTSControls
        text={scrollText}
        sections={sections}
        autoScrollPaused={true}
        resolveViewportAnchor={() => ({ kind: "text", surface: "test", startOffset: viewportOffset })}
      />,
    );
    pressPlayPause();
    await waitFor(() => expect(harness.speakMock).toHaveBeenCalled());
    await makePlaying();
    pressPlayPause();
    await waitFor(() => expect(harness.pauseMock).toHaveBeenCalled());

    // The user scrolled while paused to a different part of the document.
    viewportOffset = scrollText.indexOf("upsilon");
    pressPlayPause();
    await waitFor(() => expect(harness.speakMock.mock.calls.length).toBeGreaterThan(1));
    const resumed = harness.speakMock.mock.calls.at(-1)![0].text;
    // Sentence look-behind: starts at the beginning of the sentence containing
    // "upsilon" (Sigma…), not at the word itself, and not at the document start.
    expect(resumed.startsWith("Sigma")).toBe(true);
    expect(resumed).not.toContain("Alpha");
  });

  it("mouse and touch/keyboard share one pause path (toggle parity)", async () => {
    const onChunkStart = vi.fn();
    const ref = { current: null as ReaderTTSHandle | null };
    render(
      <ReaderTTSControls
        ref={ref as React.RefObject<ReaderTTSHandle>}
        text={TEXT}
        sections={sectionsFor(TEXT)}
        resolveViewportAnchor={() => null}
        onChunkStart={onChunkStart}
      />,
    );
    // Any activation device dispatches the same click to the single play/pause
    // button; assert the toggle is device-independent.
    screen.getAllByRole("button")[1].click();
    await waitFor(() => expect(harness.speakMock).toHaveBeenCalled());
    await makePlaying();
    await waitFor(() => expect(ref.current!.playbackState()).toBe("playing"));

    screen.getAllByRole("button")[1].click();
    await waitFor(() => expect(harness.pauseMock).toHaveBeenCalled());
    expect(ref.current!.playbackState()).toBe("paused");

    screen.getAllByRole("button")[1].click();
    await waitFor(() => expect(harness.resumeMock).toHaveBeenCalled());
    await waitFor(() => expect(ref.current!.playbackState()).toBe("playing"));
  });

  it("text re-extraction while paused preserves the session position", async () => {
    const onChunkStart = vi.fn();
    const { rerender } = render(
      <ReaderTTSControls
        text={TEXT}
        sections={sectionsFor(TEXT)}
        resolveViewportAnchor={() => null}
        onChunkStart={onChunkStart}
      />,
    );
    pressPlayPause();
    await waitFor(() => expect(harness.speakMock).toHaveBeenCalled());
    await advanceToTextContaining(onChunkStart, "Section 5");
    pressPlayPause();
    await waitFor(() => expect(harness.pauseMock).toHaveBeenCalled());
    const pausedCounter = chunkCounter();
    const speaksBeforeReextract = harness.speakMock.mock.calls.length;

    // A genuinely different fingerprint arrives while paused (EPUB relocated /
    // DOM re-extraction that changes the text identity).
    const reextractedText = Array.from(
      { length: SECTION_COUNT },
      (_, i) => `Rev ${i} alpha beta gamma delta epsilon zeta. Eta theta iota kappa lambda mu nu xi omicron pi.`,
    ).join(" ");
    rerender(
      <ReaderTTSControls
        text={reextractedText}
        sections={sectionsFor(reextractedText)}
        resolveViewportAnchor={() => null}
        onChunkStart={onChunkStart}
      />,
    );

    // Never reset while paused: no new utterance, canonical position intact.
    expect(harness.speakMock.mock.calls.length).toBe(speaksBeforeReextract);
    expect(chunkCounter()).toBe(pausedCounter);
  });

  it("genuine document text change while playing resets safely (no stale audio, no crash)", async () => {
    const onChunkStart = vi.fn();
    const { rerender } = render(
      <ReaderTTSControls
        text={TEXT}
        sections={sectionsFor(TEXT)}
        resolveViewportAnchor={() => null}
        onChunkStart={onChunkStart}
      />,
    );
    pressPlayPause();
    await waitFor(() => expect(harness.speakMock).toHaveBeenCalled());
    await advanceToTextContaining(onChunkStart, "Section 5");

    const speaksBefore = harness.speakMock.mock.calls.length;
    const differentText =
      "Completely different document with new content entirely. " +
      "Nothing shared with the previous text except the anchor surface.";
    rerender(
      <ReaderTTSControls
        text={differentText}
        sections={sectionsFor(differentText)}
        resolveViewportAnchor={() => null}
        onChunkStart={onChunkStart}
      />,
    );

    // Playback restarted into the new document (no stale audio left playing),
    // reconciled to the nearest resolvable position rather than the session
    // start, and the session did not throw.
    await waitFor(() =>
      expect(harness.speakMock.mock.calls.length).toBeGreaterThan(speaksBefore),
    );
    const resumed = harness.speakMock.mock.calls.at(-1)![0].text;
    expect(resumed).toMatch(/Completely different|Nothing shared/);
    expect(resumed).not.toContain("Section");
  });
});

describe("ReaderTTSControls cross-feature sequence + audio parity", () => {
  let harness: SpeechHarness;

  beforeEach(() => {
    localStorage.clear();
    harness = mockSystemSpeech();
    generateSpeechMock.mockImplementation(async (_s: unknown, req: { text: string }) => ({
      audioUrl: `blob:${req.text.slice(0, 12)}`,
      durationSec: 5,
      wordTimings: undefined,
    }));
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        tts: {
          ...useSettingsStore.getState().settings.tts,
          enabled: true,
          provider: "system",
        },
      },
    } as any);
  });

  afterEach(async () => {
    cleanup();
    delete (window as any).speechSynthesis;
    delete (window as any).SpeechSynthesisUtterance;
    delete (window as any).Audio;
    vi.restoreAllMocks();
  });

  function pressPlayPause() {
    screen.getAllByRole("button")[1].click();
  }

  function pressStop() {
    screen.getAllByRole("button")[2].click();
  }

  function chunkCounter(): string {
    const el = screen.getByText(/\d+\/\d+/);
    return el.textContent ?? "";
  }

  it("start ~37 → reach ~51 → pause (no jump) → resume → restart → restore from saved position", async () => {
    const onChunkStart = vi.fn();
    let viewportWord = "Section 37";
    const ref = { current: null as ReaderTTSHandle | null };
    render(
      <ReaderTTSControls
        ref={ref as React.RefObject<ReaderTTSHandle>}
        documentId="doc-sequence"
        text={TEXT}
        sections={sectionsFor(TEXT)}
        resolveViewportAnchor={() => anchorAtWord(viewportWord)}
        onChunkStart={onChunkStart}
      />,
    );

    // 1. Start around segment 37.
    pressPlayPause();
    await waitFor(() => expect(harness.speakMock).toHaveBeenCalled());
    harness.speakMock.mock.calls[0][0].onstart?.();
    await waitFor(() => expect(ref.current!.playbackState()).toBe("playing"));
    expect(harness.speakMock.mock.calls[0][0].text).toContain("Section 37");

    // 2. Reader follows narration and playback reaches segment 51.
    const at51 = await advanceToTextContainingSeq(onChunkStart, "Section 51");
    expect(at51).toBeGreaterThanOrEqual(0);

    // 3. Pause → nothing jumps backward.
    pressPlayPause();
    await waitFor(() => expect(harness.pauseMock).toHaveBeenCalled());
    expect(chunkCounter()).toMatch(new RegExp(`^${at51 + 1}/`));

    // 4. Resume → continues near segment 51 (never back to 37).
    const speaksBeforeResume = harness.speakMock.mock.calls.length;
    pressPlayPause();
    await waitFor(() => expect(harness.resumeMock).toHaveBeenCalled());
    expect(harness.speakMock.mock.calls.length).toBe(speaksBeforeResume);
    expect(chunkCounter()).toMatch(new RegExp(`^${at51 + 1}/`));

    // 5. User closes Plethora (stop + unmount flushes) → reopens → resumes
    //    from the correct listening location.
    await waitFor(() => expect(ref.current!.playbackState()).toBe("playing"));
    pressStop(); // stop (flushes position)
    await new Promise((r) => setTimeout(r, 20));
    cleanup();

    render(
      <ReaderTTSControls
        documentId="doc-sequence"
        text={TEXT}
        sections={sectionsFor(TEXT)}
        resolveViewportAnchor={() => null}
        resolvePositionAnchor={() => null}
        onChunkStart={onChunkStart}
      />,
    );
    // Let the async saved-position load settle before pressing Play.
    await new Promise((r) => setTimeout(r, 30));
    pressPlayPause();
    await waitFor(() =>
      expect(harness.speakMock.mock.calls.at(-1)![0].text).toContain("Section 51"),
    );
    expect(harness.speakMock.mock.calls.at(-1)![0].text).not.toContain("Section 0");
  });

  it("audio (cloud) provider: pause/resume keeps the same audio element (no re-anchor)", async () => {
    const played: FakeAudio[] = [];
    mockWindowAudio(played);
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        tts: { ...useSettingsStore.getState().settings.tts, enabled: true, provider: "groq" },
      },
    } as any);
    const ref = { current: null as ReaderTTSHandle | null };
    render(
      <ReaderTTSControls
        ref={ref as React.RefObject<ReaderTTSHandle>}
        text={TEXT}
        sections={sectionsFor(TEXT)}
        resolveViewportAnchor={() => null}
      />,
    );
    // Wait for the first chunk's audio to buffer (the play button is disabled
    // while the current chunk is loading).
    await waitFor(() =>
      expect((screen.getAllByRole("button")[1] as HTMLButtonElement).disabled).toBe(false),
    );
    screen.getAllByRole("button")[1].click();
    await waitFor(() => expect(played.some((a) => a.played)).toBe(true), { timeout: 2000 });
    await waitFor(() => expect(ref.current!.playbackState()).toBe("playing"));
    const audioCount = played.length;

    screen.getAllByRole("button")[1].click(); // pause
    await waitFor(() => expect(ref.current!.playbackState()).toBe("paused"));

    screen.getAllByRole("button")[1].click(); // resume
    await waitFor(() => expect(ref.current!.playbackState()).toBe("playing"));
    // Exact resume: same <audio> cursor continues, no new element for a
    // re-anchored start.
    expect(played.length).toBe(audioCount);
  });

  // Local helper mirroring advanceToTextContaining but scoped to this describe
  // block (needs the local `harness`).
  async function advanceToTextContainingSeq(
    onChunkStart: ReturnType<typeof vi.fn>,
    needle: string,
  ): Promise<number> {
    for (let i = 0; i < 300; i++) {
      const last = onChunkStart.mock.calls.at(-1);
      if (last && String(last[1]).includes(needle)) {
        harness.speakMock.mock.calls.at(-1)?.[0]?.onstart?.();
        await new Promise((r) => setTimeout(r, 0));
        return last[0] as number;
      }
      const u = harness.speakMock.mock.calls.at(-1)?.[0];
      if (!u) throw new Error(`no utterance available while seeking ${needle}`);
      u.onstart?.();
      u.onend?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    throw new Error(`timed out seeking chunk containing ${needle}`);
  }
});
