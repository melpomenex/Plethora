import { describe, expect, it } from "vitest";
import { canStartCapture, cancelShadowingCapture, createShadowingSession, ShadowingRecognitionService } from "../index";

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

  it("labels missing providers and low-confidence recognition as uncertain", async () => {
    const unavailable = await new ShadowingRecognitionService().recognize({ attemptId: "a", profileId: "p", languageTag: "es", audio: new Blob(["audio"]) }, "local");
    expect(unavailable).toMatchObject({ status: "unavailable", uncertain: true });
    const service = new ShadowingRecognitionService([{ id: "fixture-stt", version: "1", route: "local", supports: () => true, recognize: async () => ({ text: "Hola", confidence: 0.4 }) }]);
    await expect(service.recognize({ attemptId: "a", profileId: "p", languageTag: "es", audio: new Blob(["audio"]) }, "local")).resolves.toMatchObject({ status: "ready", text: "Hola", uncertain: true, providerId: "fixture-stt" });
  });

  it("requires explicit cloud consent before routing captured audio", async () => {
    const service = new ShadowingRecognitionService([{ id: "cloud", version: "1", route: "cloud", supports: () => true, recognize: async () => ({ text: "Hola", confidence: 1 }) }]);
    await expect(service.recognize({ attemptId: "a", profileId: "p", languageTag: "es", audio: new Blob(["audio"]) }, "cloud")).resolves.toMatchObject({ status: "unavailable", reason: "cloud-consent-required" });
    await expect(service.recognize({ attemptId: "a", profileId: "p", languageTag: "es", audio: new Blob(["audio"]), privacy: "allow-cloud" }, "cloud")).resolves.toMatchObject({ status: "ready", text: "Hola" });
  });
});
