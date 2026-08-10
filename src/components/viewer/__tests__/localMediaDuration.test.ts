import { describe, expect, it } from "vitest";
import { getFiniteMediaDuration } from "../localMediaSources";

describe("local media duration", () => {
  it("accepts the real runtime once the browser reports it", () => {
    expect(getFiniteMediaDuration(367.42)).toBe(367.42);
  });

  it("ignores temporary invalid values reported while MP4 metadata is loading", () => {
    expect(getFiniteMediaDuration(0)).toBeNull();
    expect(getFiniteMediaDuration(Number.NaN)).toBeNull();
    expect(getFiniteMediaDuration(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
