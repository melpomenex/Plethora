import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FEEDBACK_SOUND_FILES, playDocumentRatedSound, resolveSoundUrl } from "../soundService";

describe("soundService", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    document.head.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("resolves public sound assets against document base URI", () => {
    const base = document.createElement("base");
    base.href = "https://example.com/app/";
    document.head.appendChild(base);

    expect(resolveSoundUrl("/sounds/click.mp3")).toBe("https://example.com/app/sounds/click.mp3");
  });

  it("leaves absolute data URLs unchanged", () => {
    expect(resolveSoundUrl("data:audio/mp3;base64,AAAA")).toBe("data:audio/mp3;base64,AAAA");
  });

  it("plays the confirmation sound by default when rating a document or marking it read", async () => {
    const playMock = vi.fn().mockResolvedValue(undefined);
    const loadMock = vi.fn();
    const audioInstances: Array<{ src: string; volume: number }> = [];
    vi.stubGlobal(
      "Audio",
      class MockAudio {
        src: string;
        volume = 1;
        preload = "";
        onended: (() => void) | null = null;
        onpause: (() => void) | null = null;
        onerror: (() => void) | null = null;
        ended = false;
        constructor(src = "") {
          this.src = src;
          audioInstances.push(this);
        }
        load = loadMock;
        play = playMock;
      },
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    vi.stubGlobal("fetch", fetchMock);

    playDocumentRatedSound(3);

    await vi.waitFor(() => {
      const playedViaFetch = fetchMock.mock.calls.some((args) =>
        String(args[0]).includes(FEEDBACK_SOUND_FILES.success),
      );
      const playedViaHtmlAudio =
        playMock.mock.calls.length > 0 &&
        audioInstances.some((a) => a.src.includes(FEEDBACK_SOUND_FILES.success) && a.volume === 0.5);
      expect(playedViaFetch || playedViaHtmlAudio).toBe(true);
    });
  });

  it("does not play document-rated sound when notifications.soundEnabled is false", () => {
    localStorage.setItem(
      "plethora-settings",
      JSON.stringify({
        state: {
          settings: {
            notifications: {
              soundEnabled: false,
              soundVolume: 0.8,
            },
          },
        },
      }),
    );

    const fetchMock = vi.fn();
    const playMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(playMock);

    playDocumentRatedSound(3);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(playMock).not.toHaveBeenCalled();
  });

  it("does not play document-rated sound when notifications.soundVolume is 0", () => {
    localStorage.setItem(
      "plethora-settings",
      JSON.stringify({
        state: {
          settings: {
            notifications: {
              soundEnabled: true,
              soundVolume: 0,
            },
          },
        },
      }),
    );

    const fetchMock = vi.fn();
    const playMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(playMock);

    playDocumentRatedSound(4);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(playMock).not.toHaveBeenCalled();
  });
});
