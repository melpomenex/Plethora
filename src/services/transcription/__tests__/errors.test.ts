import { describe, expect, it } from "vitest";
import { mapHttpStatusToTranscriptionError } from "../errors";

describe("mapHttpStatusToTranscriptionError", () => {
  it.each([
    [401, "AUTH_FAILED", false],
    [403, "AUTH_FAILED", false],
    [429, "RATE_LIMITED", true],
    [402, "INSUFFICIENT_BALANCE", false],
    [408, "TIMEOUT", true],
    [504, "TIMEOUT", true],
    [415, "UNSUPPORTED_AUDIO", false],
    [422, "UNSUPPORTED_LANGUAGE", false],
    [502, "PROVIDER_UNAVAILABLE", true],
    [503, "PROVIDER_UNAVAILABLE", true],
    [500, "PROVIDER_UNAVAILABLE", true],
    [400, "UNKNOWN", false],
  ] as const)("maps HTTP %s to %s (recoverable=%s)", (status, code, recoverable) => {
    const error = mapHttpStatusToTranscriptionError(status, "fixture failure");
    expect(error.code).toBe(code);
    expect(error.recoverable).toBe(recoverable);
    expect(error.message).toBe("fixture failure");
  });

  it("uses default messages when none are provided", () => {
    const error = mapHttpStatusToTranscriptionError(429);
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.message.toLowerCase()).toContain("rate limit");
  });
});
