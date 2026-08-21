import { describe, expect, it } from "vitest";
import { buildLearnerContext, redactTutorContext, redactTutorMaterial, resolveTutorPrivacyPolicy } from "../index";

describe("language tutor privacy", () => {
  it("requires consent for cloud paths and exposes disclosure/delete/export policy", () => {
    const policy = resolveTutorPrivacyPolicy({ aiPath: "cloud", cloudConsent: null, hasByoProvider: true });
    expect(policy.path).toBe("byo-cloud");
    expect(policy.requiresConsent).toBe(true);
    expect(policy.consented).toBe(false);
    expect(policy.canExport).toBe(true);
    expect(policy.canDelete).toBe(true);
  });

  it("bounds material and strips source text from provider context", () => {
    const context = buildLearnerContext({ profile: { id: "p", targetLanguage: "es", baseLanguage: "en" }, lexicon: [], currentSource: { text: "private source", documentId: "doc" }, budget: { includeSourceText: true } });
    expect(redactTutorMaterial(" one\n two ", 5)).toBe("one t");
    expect(redactTutorContext(context)?.currentSource).toBeUndefined();
  });
});
