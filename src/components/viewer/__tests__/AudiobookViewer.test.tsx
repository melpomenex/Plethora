import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AudiobookPlaybackErrorNotice,
  classifyAudiobookPlaybackError,
} from "../AudiobookViewer";

describe("Audiobook playback error classification", () => {
  it("treats decode and unsupported-source errors as codec failures", () => {
    expect(classifyAudiobookPlaybackError(3)).toBe("codec");
    expect(classifyAudiobookPlaybackError(4)).toBe("codec");
  });

  it("treats network and unknown media errors as source failures", () => {
    expect(classifyAudiobookPlaybackError(2)).toBe("source");
    expect(classifyAudiobookPlaybackError(undefined)).toBe("source");
  });

  it("renders a retryable error state and invokes the retry action", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <AudiobookPlaybackErrorNotice
        error={null}
        retryLabel="Retry play"
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(
      <AudiobookPlaybackErrorNotice
        error={{ kind: "codec", message: "Unsupported audio format" }}
        retryLabel="Retry play"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Unsupported audio format");
    fireEvent.click(screen.getByRole("button", { name: "Retry play" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
