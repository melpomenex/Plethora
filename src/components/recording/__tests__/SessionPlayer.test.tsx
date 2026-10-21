import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SessionPlayer, formatTime } from "../SessionPlayer";
import type { RecordingSession, SessionMediaAsset } from "../../../types/recordingSession";

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => false,
  invokeCommand: vi.fn(),
}));

describe("SessionPlayer Component", () => {
  const baseSession: RecordingSession = {
    id: "sess-test-1",
    version: 1,
    documentId: "doc-1",
    origin: "recorded",
    contentType: "lecture",
    profileJson: "{}",
    mediaAssetId: null,
    transcriptId: null,
    transcriptRevision: 0,
    overviewJson: null,
    overviewRevision: null,
    ingestionState: "saved",
    captureState: "saved",
    createdAt: "2026-10-20T12:00:00Z",
    updatedAt: "2026-10-20T12:00:00Z",
  };

  it("formats time correctly for MM:SS and HH:MM:SS", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(3665)).toBe("1:01:05");
    expect(formatTime(-5)).toBe("0:00");
    expect(formatTime(NaN)).toBe("0:00");
  });

  it("renders State 1: transcript-only when no mediaAsset exists", () => {
    render(<SessionPlayer session={baseSession} mediaAsset={null} />);
    expect(screen.getByTestId("session-player-transcript-only")).toBeInTheDocument();
    expect(screen.getByText("Transcript-only session")).toBeInTheDocument();
  });

  it("renders State 2: missing media when media asset is missing", () => {
    const missingAsset: SessionMediaAsset = {
      id: "asset-1",
      sessionId: "sess-test-1",
      kind: "original",
      relativePath: "missing.wav",
      state: "missing",
      durationMs: null,
      byteLength: 0,
      mime: "audio/wav",
      sha256: null,
      sourceUrl: null,
      sourceAdapter: null,
      createdAt: "2026-10-20T12:00:00Z",
    };
    render(
      <SessionPlayer
        session={{ ...baseSession, mediaAssetId: "asset-1" }}
        mediaAsset={missingAsset}
      />
    );
    expect(screen.getByTestId("session-player-missing-media")).toBeInTheDocument();
    expect(screen.getByText("Audio unavailable")).toBeInTheDocument();
  });

  it("renders State 3: partial status badge when session is actively recording or partial", () => {
    const partialAsset: SessionMediaAsset = {
      id: "asset-partial",
      sessionId: "sess-test-1",
      kind: "capture",
      relativePath: "audio.wav",
      sourceUrl: "http://localhost/test.wav",
      sourceAdapter: null,
      sha256: null,
      state: "partial",
      durationMs: 120000,
      byteLength: 1024,
      mime: "audio/wav",
      createdAt: "2026-10-20T12:00:00Z",
    };
    render(
      <SessionPlayer
        session={{ ...baseSession, captureState: "recording", mediaAssetId: "asset-partial" }}
        mediaAsset={partialAsset}
      />
    );
    expect(screen.getByTestId("session-player")).toBeInTheDocument();
    expect(screen.getByText("Partial")).toBeInTheDocument();
  });

  it("renders State 4: full media playback when media asset is ready and supports speed cycling", () => {
    const readyAsset: SessionMediaAsset = {
      id: "asset-ready",
      sessionId: "sess-test-1",
      kind: "original",
      relativePath: "audio.wav",
      sourceUrl: "http://localhost/audio.wav",
      sourceAdapter: null,
      sha256: null,
      state: "ready",
      durationMs: 180000,
      byteLength: 2048,
      mime: "audio/wav",
      createdAt: "2026-10-20T12:00:00Z",
    };
    render(
      <SessionPlayer
        session={{ ...baseSession, mediaAssetId: "asset-ready" }}
        mediaAsset={readyAsset}
      />
    );

    expect(screen.getByTestId("session-player")).toBeInTheDocument();
    const speedButton = screen.getByRole("button", { name: "Playback speed: 1x" });
    expect(speedButton).toBeInTheDocument();

    // Cycle speed
    fireEvent.click(speedButton);
    expect(screen.getByRole("button", { name: "Playback speed: 1.25x" })).toBeInTheDocument();

    // Verify rewind and forward buttons exist
    expect(screen.getByRole("button", { name: "Rewind 10 seconds" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fast forward 30 seconds" })).toBeInTheDocument();
  });
});
