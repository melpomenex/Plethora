import { describe, expect, it } from "vitest";
import { HapticAdmission } from "../admission";

const selection = { effect: "selection" as const, cooldownMs: 0 };
const outcome = { effect: "success" as const, cooldownMs: 0 };
describe("haptic admission bounds", () => {
  it("deduplicates aliases by identity for 30 seconds and re-arms distinct steps", () => {
    const admission = new HapticAdmission();
    expect(admission.admit("reader.annotation-saved", "save:1", selection, 0)).toBeUndefined();
    expect(admission.admit("feedback.confirmed", "save:1", outcome, 3_000)).toBe("duplicate");
    expect(admission.admit("feedback.confirmed", "save:1:undo", outcome, 3_000)).toBeUndefined();
    expect(admission.admit("reader.annotation-saved", "save:1", selection, 30_001)).toBeUndefined();
  });
  it("applies eight-per-second micro and four-per-second outcome ceilings independently", () => {
    const admission = new HapticAdmission();
    for (let index = 0; index < 8; index++) expect(admission.admit("queue.refresh-armed", `micro:${index}`, selection, index * 60)).toBeUndefined();
    expect(admission.admit("queue.refresh-armed", "excess", selection, 480)).toBe("rate-limited");
    admission.reset();
    for (let index = 0; index < 4; index++) expect(admission.admit("reader.annotation-saved", `outcome:${index}`, outcome, index * 120)).toBeUndefined();
    expect(admission.admit("reader.annotation-saved", "excess", outcome, 480)).toBe("rate-limited");
    expect(admission.admit("navigation.back-completed", "next-micro", selection, 480)).toBeUndefined();
  });
  it("drops cooldown work without reserving it or replaying it", () => {
    const admission = new HapticAdmission();
    const detent = { ...selection, cooldownMs: 80 };
    admission.admit("review.grade-boundary-crossed", "first", detent, 0);
    expect(admission.admit("review.grade-boundary-crossed", "next", detent, 60)).toBe("cooldown");
    expect(admission.admit("review.grade-boundary-crossed", "next", detent, 80)).toBeUndefined();
  });
  it("evicts the oldest reservation after 256 independent operations", () => {
    const admission = new HapticAdmission();
    for (let index = 0; index < 257; index++) admission.admit("queue.refresh-armed", `id:${index}`, selection, index * 125);
    expect(admission.admit("queue.refresh-armed", "id:0", selection, 32_250)).toBeUndefined();
  });
});
