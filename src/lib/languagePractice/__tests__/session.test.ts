import { describe, expect, it } from "vitest";
import { acceptPracticeEvidence, createPracticeAttempt, isPracticeAttemptCurrent, submitPracticeAttempt } from "../session";
import { LanguagePracticeAttemptStore } from "../storage";

describe("practice session lifecycle", () => {
  it("preserves the source and rejects duplicate submissions", () => {
    const attempt = createPracticeAttempt({ id: "a", profileId: "p", mode: "dictation", source: { sourceFingerprint: "v1" }, promptText: "hola", now: 1 });
    const submitted = submitPracticeAttempt(attempt, "hola", 2);
    expect(submitPracticeAttempt(submitted, "wrong", 3).rawResponse).toBe("hola");
    expect(acceptPracticeEvidence(submitted, 4).activeEvidenceAccepted).toBe(true);
    expect(isPracticeAttemptCurrent(submitted, "v1")).toBe(true);
    expect(isPracticeAttemptCurrent(submitted, "v2")).toBe(false);
  });

  it("persists, exports without recordings, and removes attempts", () => {
    const values = new Map<string, string>();
    const store = new LanguagePracticeAttemptStore({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) });
    const attempt = createPracticeAttempt({ id: "a", profileId: "p", mode: "shadowing", source: {}, promptText: "hola", now: 1 });
    store.save({ ...attempt, rawResponse: "audio", recordingPolicy: { ...attempt.recordingPolicy, persistRecording: true } });
    expect(store.export(false)[0]?.rawResponse).toBeUndefined();
    store.delete("a");
    expect(store.load()).toEqual([]);
  });
});
