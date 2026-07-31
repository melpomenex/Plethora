import { describe, expect, it } from "vitest";
import { digestText128, makeCacheKey } from "../ttsCache";

describe("tts cache keys", () => {
  it("uses a 128-bit-class text digest", () => {
    expect(digestText128("hello")).toHaveLength(32);
    expect(digestText128("hello")).not.toBe(digestText128("hello!"));
  });

  it("separates models and response formats", () => {
    const base = ["openrouter", "voice", 1, "mp3", "same text"] as const;
    expect(makeCacheKey(base[0], "model-a", base[1], base[2], base[3], base[4]))
      .not.toBe(makeCacheKey(base[0], "model-b", base[1], base[2], base[3], base[4]));
    expect(makeCacheKey(base[0], "model-a", base[1], base[2], "wav", base[4]))
      .not.toBe(makeCacheKey(base[0], "model-a", base[1], base[2], base[3], base[4]));
  });

  it("is stable for identical requests and does not match the old format", () => {
    const key = makeCacheKey("fal", "model", "Vivian", 1, "mp3", "hello");
    expect(key).toBe(makeCacheKey("fal", "model", "Vivian", 1, "mp3", "hello"));
    expect(key).not.toBe("fal:Vivian:1:3:hello");
  });
});
