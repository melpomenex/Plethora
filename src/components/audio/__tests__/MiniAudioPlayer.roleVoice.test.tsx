import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  useAudioPlaybackStore,
  getActiveRoleVoiceId,
} from "../../../stores/audioPlaybackStore";
import { MiniAudioPlayer } from "../MiniAudioPlayer";

describe("MiniAudioPlayer roleVoice, PiP, speed & [B] 30s bookmark", () => {
  beforeEach(() => {
    useAudioPlaybackStore.setState({
      snapshot: {
        sourceKey: { kind: "audiobook", id: "book-1" },
        metadata: { sessionId: "sess-1", title: "Cognitive Science Ch. 4" },
        state: "playing",
        playIntent: true,
        positionSec: 125,
        durationSec: 600,
        capabilities: {
          canPlay: true,
          canPause: true,
          canSeekAbsolute: true,
          canSeekRelative: true,
          canStop: true,
          canExpand: true,
        },
        section: { index: 0, title: "Memory Systems" },
      } as unknown as ReturnType<typeof useAudioPlaybackStore.getState>["snapshot"],
      playbackRate: 1.0,
      pipCollapsed: false,
      contentRole: "extract",
      voiceRoleConfig: {
        extractVoiceId: "af_bella",
        promptVoiceId: "am_adam",
        chimeEnabled: false,
      },
      recentTranscriptText: "Working memory capacity is bounded by chunking.",
      bookmarks: [],
    });
  });

  it("cycles playback rate from 1x through 2.5x", () => {
    render(<MiniAudioPlayer mobile={false} onExpand={() => {}} />);
    const speedBtn = screen.getByRole("button", { name: "Playback speed" });
    expect(speedBtn).toHaveTextContent("1x");

    fireEvent.click(speedBtn);
    expect(useAudioPlaybackStore.getState().playbackRate).toBe(1.25);

    fireEvent.click(speedBtn);
    expect(useAudioPlaybackStore.getState().playbackRate).toBe(1.5);

    fireEvent.click(speedBtn);
    expect(useAudioPlaybackStore.getState().playbackRate).toBe(2);

    fireEvent.click(speedBtn);
    expect(useAudioPlaybackStore.getState().playbackRate).toBe(2.5);

    fireEvent.click(speedBtn);
    expect(useAudioPlaybackStore.getState().playbackRate).toBe(1);
  });

  it("toggles collapsible PiP chrome and preserves bookmark action", () => {
    render(<MiniAudioPlayer mobile={false} onExpand={() => {}} />);

    const collapseBtn = screen.getByRole("button", { name: "Collapse to PiP pill" });
    fireEvent.click(collapseBtn);

    expect(useAudioPlaybackStore.getState().pipCollapsed).toBe(true);
    expect(document.querySelector('[data-pip-collapsed="true"]')).toBeTruthy();

    const expandBtn = screen.getByRole("button", { name: "Expand PiP player" });
    fireEvent.click(expandBtn);
    expect(useAudioPlaybackStore.getState().pipCollapsed).toBe(false);
  });

  it("switches active role voice between extract and qa_prompt/summary", () => {
    expect(getActiveRoleVoiceId()).toBe("af_bella");
    useAudioPlaybackStore.getState().setContentRole("qa_prompt");
    expect(getActiveRoleVoiceId()).toBe("am_adam");
    useAudioPlaybackStore.getState().setContentRole("summary");
    expect(getActiveRoleVoiceId()).toBe("am_adam");
    useAudioPlaybackStore.getState().setContentRole("extract");
    expect(getActiveRoleVoiceId()).toBe("af_bella");
  });

  it("bookmarks last 30s on [B] keydown and ignores editable targets", () => {
    render(
      <div>
        <input aria-label="Search notes" />
        <MiniAudioPlayer mobile={false} onExpand={() => {}} />
      </div>
    );

    const input = screen.getByLabelText("Search notes");
    fireEvent.keyDown(input, { key: "b" });
    expect(useAudioPlaybackStore.getState().bookmarks).toHaveLength(0);

    fireEvent.keyDown(window, { key: "b" });
    const bookmarks = useAudioPlaybackStore.getState().bookmarks;
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]).toEqual({
      startTime: 95,
      endTime: 125,
      text: "Working memory capacity is bounded by chunking.",
    });
  });
});
