import { describe, expect, it } from "vitest";
import { inferAudioMimeFromUrl, classifyMediaElementError } from "../audioErrors";

describe("inferAudioMimeFromUrl", () => {
  it("resolves basic file extensions", () => {
    expect(inferAudioMimeFromUrl("https://cdn.example.com/podcast.mp3")).toBe("audio/mpeg");
    expect(inferAudioMimeFromUrl("https://cdn.example.com/podcast.m4a")).toBe("audio/mp4");
    expect(inferAudioMimeFromUrl("https://cdn.example.com/podcast.aac")).toBe("audio/aac");
    expect(inferAudioMimeFromUrl("https://cdn.example.com/podcast.ogg")).toBe("audio/ogg");
  });

  it("handles audio mpeg, mpg, mpga, and mp4 extensions", () => {
    expect(inferAudioMimeFromUrl("/path/to/file.mpeg")).toBe("audio/mpeg");
    expect(inferAudioMimeFromUrl("/path/to/file.mpg")).toBe("audio/mpeg");
    expect(inferAudioMimeFromUrl("/path/to/file.mpga")).toBe("audio/mpeg");
    expect(inferAudioMimeFromUrl("/path/to/file.mp4")).toBe("audio/mp4");
  });

  it("extracts extension from query parameters on loopback stream urls", () => {
    expect(
      inferAudioMimeFromUrl("http://127.0.0.1:15173/stream?path=/home/user/podcast-audio/ep1.mp3")
    ).toBe("audio/mpeg");
    expect(
      inferAudioMimeFromUrl("http://localhost:15173/stream?path=/home/user/podcast-audio/ep1.mpeg")
    ).toBe("audio/mpeg");
    expect(
      inferAudioMimeFromUrl("http://127.0.0.1:15173/stream?path=/home/user/podcast-audio/ep1.m4a")
    ).toBe("audio/mp4");
  });

  it("classifies loopback stream errors accurately when mime is resolved from query path", () => {
    const error = classifyMediaElementError(
      "http://127.0.0.1:15173/stream?path=/home/user/podcast-audio/ep1.mp3",
      { code: 4, message: "Format error" },
      (mime) => (mime === "audio/mpeg" ? "maybe" : "")
    );
    expect(error.code).toBe("source_missing");
  });
});
