import { afterEach, describe, expect, it } from "vitest";
import { hasActiveMediaPlayback } from "../mediaPlayback";

function createMediaElement(overrides: Partial<HTMLMediaElement> = {}): HTMLAudioElement {
  const audio = document.createElement("audio");
  for (const [property, value] of Object.entries(overrides)) {
    Object.defineProperty(audio, property, { configurable: true, value });
  }
  document.body.appendChild(audio);
  return audio;
}

describe("hasActiveMediaPlayback", () => {
  afterEach(() => {
    document.querySelectorAll("audio, video").forEach((element) => element.remove());
  });

  it("detects media that is playing with buffered data", () => {
    createMediaElement({ paused: false, ended: false, readyState: 3 });

    expect(hasActiveMediaPlayback()).toBe(true);
  });

  it.each([
    ["paused", { paused: true, ended: false, readyState: 4 }],
    ["ended", { paused: false, ended: true, readyState: 4 }],
    ["not yet playable", { paused: false, ended: false, readyState: 2 }],
  ])("does not treat %s media as actively playing", (_label, overrides) => {
    createMediaElement(overrides);

    expect(hasActiveMediaPlayback()).toBe(false);
  });

  it("returns false when there are no media elements", () => {
    expect(hasActiveMediaPlayback()).toBe(false);
  });
});
