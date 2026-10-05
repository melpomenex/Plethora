import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { useSettingsStore } from "../../../stores/settingsStore";
import { ReaderTTSControls } from "../ReaderTTSControls";

const TEXT =
  "First sentence of our study document. " +
  "Second sentence with important key insights. " +
  "Third sentence to finalize the reading passage.";

describe("ReaderTTSControls study hotkeys and DAQE synchronization", () => {
  let speakMock: ReturnType<typeof vi.fn>;
  let cancelMock: ReturnType<typeof vi.fn>;
  let pauseMock: ReturnType<typeof vi.fn>;
  let resumeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    speakMock = vi.fn();
    cancelMock = vi.fn();
    pauseMock = vi.fn();
    resumeMock = vi.fn();

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

  afterEach(() => {
    cleanup();
    delete (window as any).speechSynthesis;
    delete (window as any).SpeechSynthesisUtterance;
    vi.restoreAllMocks();
  });

  it("toggles play/pause with Space key", async () => {
    render(<ReaderTTSControls text={TEXT} />);

    // Press Space to start playback
    await act(async () => {
      fireEvent.keyDown(window, { key: " ", code: "Space" });
    });

    expect(speakMock).toHaveBeenCalledTimes(1);

    // Simulate utterance started
    const firstUtterance = speakMock.mock.calls[0][0];
    await act(async () => {
      firstUtterance.onstart?.();
    });

    // Press Space again to pause
    await act(async () => {
      fireEvent.keyDown(window, { key: " ", code: "Space" });
    });

    expect(pauseMock).toHaveBeenCalledTimes(1);

    // Press Space again to resume
    await act(async () => {
      fireEvent.keyDown(window, { key: " ", code: "Space" });
    });

    expect(resumeMock).toHaveBeenCalledTimes(1);
  });

  it("adjusts playback rate with [ and ] keys", async () => {
    render(<ReaderTTSControls text={TEXT} />);

    // Default rate is 1
    // Press ] to increase
    await act(async () => {
      fireEvent.keyDown(window, { key: "]" });
    });

    const speedSelect = screen.getByRole("combobox", { name: /playback speed/i }) as HTMLSelectElement;
    expect(Number(speedSelect.value)).toBe(1.1);

    // Press [ twice to decrease to 0.9
    await act(async () => {
      fireEvent.keyDown(window, { key: "[" });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "[" });
    });

    expect(Number(speedSelect.value)).toBe(0.9);
  });

  it("triggers extract creation and callback with E key", async () => {
    const onCreateExtract = vi.fn();
    render(<ReaderTTSControls text={TEXT} onCreateExtract={onCreateExtract} />);

    await act(async () => {
      fireEvent.keyDown(window, { key: "e" });
    });

    expect(onCreateExtract).toHaveBeenCalledTimes(1);
    expect(onCreateExtract.mock.calls[0][0]).toContain("First sentence");
  });

  it("ignores hotkeys when typing in input elements", async () => {
    render(
      <div>
        <input data-testid="test-input" type="text" />
        <ReaderTTSControls text={TEXT} />
      </div>
    );

    const input = screen.getByTestId("test-input");
    input.focus();

    await act(async () => {
      fireEvent.keyDown(input, { key: " ", code: "Space" });
    });

    // Did not trigger TTS play
    expect(speakMock).not.toHaveBeenCalled();
  });

  it("reports onDaqeProgress upon completion", async () => {
    const onDaqeProgress = vi.fn();
    const onComplete = vi.fn();

    render(
      <ReaderTTSControls
        text="Single chunk text to finish."
        onDaqeProgress={onDaqeProgress}
        onComplete={onComplete}
      />
    );

    // Play
    await act(async () => {
      fireEvent.keyDown(window, { key: " ", code: "Space" });
    });

    expect(speakMock).toHaveBeenCalled();
    const utterance = speakMock.mock.calls[0][0];

    await act(async () => {
      utterance.onstart?.();
      utterance.onend?.();
    });

    expect(onComplete).toHaveBeenCalled();
    expect(onDaqeProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        completed: true,
      })
    );
  });
});
