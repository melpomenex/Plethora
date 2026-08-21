import { describe, expect, it } from "vitest";
import { canStartCapture, cancelShadowingCapture, createShadowingSession } from "../index";

describe("shadowing session", () => {
  it("keeps recording permission and retention explicit", () => {
    const session = createShadowingSession({ id: "s", profileId: "p", flow: "listen-first", source: { sourceId: "doc" }, promptText: "Hola", recordingPolicy: { allowMicrophone: true, persistRecording: false, privacy: "local-only" } });
    expect(session.active).toBe(true);
    expect(canStartCapture(session.recordingPolicy, true)).toBe(true);
    expect(cancelShadowingCapture({ status: "recording", microphoneAvailable: true }).status).toBe("cancelled");
  });

  it("keeps all capture flows explicit instead of hiding a default in the session", () => {
    for (const flow of ["listen-first", "immediate", "continuous"] as const) {
      expect(createShadowingSession({ id: flow, profileId: "p", flow, source: { sourceId: "doc" }, promptText: "Hola", recordingPolicy: { allowMicrophone: true, persistRecording: false, privacy: "local-only" } }).flow).toBe(flow);
    }
    expect(canStartCapture({ allowMicrophone: false, persistRecording: false, privacy: "local-only" }, true)).toBe(false);
  });
});
