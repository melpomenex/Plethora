import { describe, expect, it } from "vitest";
import { acceptPracticeEvidence, createPracticeAttempt, isPracticeAttemptCurrent, revealPracticeAttempt, submitPracticeAttempt } from "../session";
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

  it("marks revealed dictation as assisted and blocks active evidence", () => {
    const attempt = createPracticeAttempt({ id: "revealed", profileId: "p", mode: "dictation", source: {}, promptText: "hola", now: 1 });
    const submitted = submitPracticeAttempt(revealPracticeAttempt(attempt, 4), "hola", 5);
    expect(submitted.comparison?.assisted).toBe(true);
    expect(acceptPracticeEvidence(submitted).activeEvidenceAccepted).toBe(false);
  });

  it("keeps large local histories exportable and purges only expired attempts", () => {
    const values = new Map<string, string>();
    const store = new LanguagePracticeAttemptStore({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) });
    const attempts = [] as ReturnType<typeof createPracticeAttempt>[];
    for (let index = 0; index < 2_000; index += 1) {
      const attempt = createPracticeAttempt({ id: `history-${index}`, profileId: "p", mode: "dictation", source: { sourceId: "doc" }, promptText: "hola", now: index });
      attempts.push({ ...attempt, recordingPolicy: { ...attempt.recordingPolicy, retentionExpiresAt: index % 2 === 0 ? 100 : 10_000 } });
    }
    values.set("plethora.language-practice.attempts", JSON.stringify(attempts));
    expect(store.load()).toHaveLength(2_000);
    expect(store.export(false)).toHaveLength(2_000);
    expect(store.purgeExpired(100)).toBe(1_000);
    expect(store.load()).toHaveLength(1_000);
  });

  it("recovers from a truncated local history without inventing attempts", () => {
    const values = new Map<string, string>([["practice", "{broken}"]]);
    const store = new LanguagePracticeAttemptStore({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }, "practice");
    expect(store.load()).toEqual([]);
  });
});
