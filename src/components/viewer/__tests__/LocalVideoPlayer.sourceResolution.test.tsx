/**
 * Regression tests for the local video player's source-resolution effect.
 *
 * Opening a transcribed local video used to crash with React's "Maximum
 * update depth exceeded": DocumentViewer passed an inline `src` descriptor
 * object, so every parent re-render gave the player a fresh-looking candidate
 * array, re-running the probe cycle and firing its state resets from the
 * effect phase. These tests pin the fix: the probe is keyed on the stable
 * `sourceKey` string, so content-identical re-renders never re-probe.
 */
import { render, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  invokeCommand: vi.fn(async () => null),
}));

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return { ...actual, isTauri: tauriMocks.isTauri, invokeCommand: tauriMocks.invokeCommand };
});

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

vi.mock("../../../api/position", () => ({
  getDocumentPosition: vi.fn(async () => null),
  saveDocumentPosition: vi.fn(),
  timePosition: vi.fn(),
}));

vi.mock("../../../api/documents", () => ({
  getDocumentAuto: vi.fn(async () => ({ id: "doc-1", filePath: "/tmp/video.mp4", currentPage: 0 })),
  updateDocumentProgressAuto: vi.fn(async () => undefined),
}));

vi.mock("../../../api/sponsorblock", () => ({
  getSponsorBlockCuts: vi.fn(async () => []),
  fetchSponsorBlockSegments: vi.fn(async () => []),
  extractVideoID: vi.fn(() => null),
  getCategoryDisplayName: vi.fn((c: string) => c),
}));

const transcriptMocks = vi.hoisted(() => ({
  getVideoTranscript: vi.fn(),
}));

vi.mock("../../../api/video-extracts", () => ({
  getVideoTranscript: transcriptMocks.getVideoTranscript,
  setVideoTranscript: vi.fn(),
  generateVideoTranscript: vi.fn(),
}));

vi.mock("../../../lib/videoTranscriptionQueue", () => ({
  getVideoTranscriptionStatus: vi.fn(() => "completed"),
  subscribeVideoTranscriptionStatus: vi.fn(() => () => {}),
  setVideoPlaybackActive: vi.fn(),
  getTranscriptionError: vi.fn(() => null),
}));

vi.mock("../../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));

vi.mock("../transcription", () => ({
  TranscriptionButton: () => null,
}));

vi.mock("../../video/VideoFeatures", () => ({
  VideoFeatures: () => null,
}));

vi.mock("../../video/VideoExtracts", () => ({
  CreateVideoExtractDialog: () => null,
  VideoExtractsList: () => null,
}));

const probeMocks = vi.hoisted(() => ({ calls: 0 as number }));

vi.mock("../localMediaSources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../localMediaSources")>();
  return {
    ...actual,
    probeLocalMediaSource: vi.fn(async (...args: Parameters<typeof actual.probeLocalMediaSource>) => {
      probeMocks.calls += 1;
      return actual.probeLocalMediaSource(...args);
    }),
  };
});

import { LocalVideoPlayer } from "../LocalVideoPlayer";
import type { LocalMediaSourceInput } from "../localMediaSources";

const groqSegments = Array.from({ length: 8 }, (_, i) => ({
  time: i * 4.5,
  text: `segment ${i + 1}`,
}));

beforeAll(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
});

/** Mirrors how DocumentViewer renders the player: a fresh descriptor object
 *  on every parent render, with the same underlying source. */
function Harness({ sourceUrl }: { sourceUrl: string }) {
  const [, setNonce] = useState(0);
  harnessBump = () => setNonce((n) => n + 1);
  const src: LocalMediaSourceInput = {
    src: sourceUrl,
    mimeType: "video/mp4",
    strategy: "blob",
    alreadyPlayable: true,
  };
  return (
    <LocalVideoPlayer
      src={src}
      documentId="doc-1"
      title="Twitter video"
      mediaType="video"
    />
  );
}

let harnessBump: () => void = () => {};

describe("LocalVideoPlayer source resolution stability", () => {
  beforeEach(() => {
    probeMocks.calls = 0;
    transcriptMocks.getVideoTranscript.mockResolvedValue({
      transcript: groqSegments.map((s) => s.text).join(" "),
      segments: groqSegments,
    });
  });

  it("does not re-probe the source when the parent re-renders with an identical inline descriptor", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<Harness sourceUrl="http://127.0.0.1:41777/media/stream" />);

    await waitFor(() => expect(probeMocks.calls).toBe(1), { timeout: 2000 });

    // A burst of parent re-renders — each passes a NEW descriptor object with
    // the same content, exactly what DocumentViewer does on every re-render.
    for (let i = 0; i < 12; i += 1) harnessBump();
    await new Promise((r) => setTimeout(r, 150));

    expect(probeMocks.calls).toBe(1);

    const depthErrors = consoleError.mock.calls.filter((c) =>
      String(c[0]).includes("Maximum update depth"),
    );
    consoleError.mockRestore();
    unmount();
    expect(depthErrors).toEqual([]);
  });

  it("re-probes when the source content actually changes", async () => {
    const { rerender, unmount } = render(
      <Harness sourceUrl="http://127.0.0.1:41777/media/one" />,
    );
    await waitFor(() => expect(probeMocks.calls).toBe(1), { timeout: 2000 });

    rerender(<Harness sourceUrl="http://127.0.0.1:41777/media/two" />);
    await waitFor(() => expect(probeMocks.calls).toBe(2), { timeout: 2000 });

    unmount();
  });

  it("loads the transcript segments for a transcribed video", async () => {
    const { container, unmount } = render(
      <Harness sourceUrl="http://127.0.0.1:41777/media/stream" />,
    );
    await waitFor(
      () => {
        expect(container.querySelectorAll("[role='option']").length).toBe(groqSegments.length);
      },
      { timeout: 2000 },
    );
    unmount();
  });
});
