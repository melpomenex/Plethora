import { describe, expect, it } from "vitest";
import { comparePracticeResponse } from "../index";

describe("dictation mode", () => {
  it("keeps the raw response and exposes a derived comparison", () => {
    const rawAnswer = "Hola, mundo!";
    const comparison = comparePracticeResponse("Hola mundo", rawAnswer);
    expect(rawAnswer).toBe("Hola, mundo!");
    expect(comparison.normalizedActual).toBe("hola mundo");
    expect(comparison.exact).toBe(true);
  });
});
