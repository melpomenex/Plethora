import {
  compareAnalysisVersions,
  contentFingerprint,
  createAnalysisVersion,
  digestConfiguration,
  isAnalysisCurrent,
  lexicalIdentity,
} from "../fingerprints";

function version(overrides: Partial<Parameters<typeof createAnalysisVersion>[0]> = {}) {
  return createAnalysisVersion({
    contentFingerprint: contentFingerprint("hello"),
    languageTag: "en" as never,
    adapterId: "adapter",
    adapterVersion: "1",
    providerKind: "local",
    configuration: { b: 2, a: 1 },
    ...overrides,
  });
}

describe("language processing fingerprints", () => {
  it("is stable across configuration key order and distinguishes exact source", () => {
    expect(digestConfiguration({ b: 2, a: 1 })).toBe(digestConfiguration({ a: 1, b: 2 }));
    expect(contentFingerprint("e\u0301")).not.toBe(contentFingerprint("é"));
    expect(lexicalIdentity("e\u0301", "fr")).toBe(lexicalIdentity("é", "fr"));
  });

  it("reports missing, fresh, and stale reasons without mixing versions", () => {
    const current = version();
    expect(compareAnalysisVersions(undefined, current).status).toBe("missing");
    expect(compareAnalysisVersions(current, current)).toMatchObject({ status: "fresh" });
    expect(compareAnalysisVersions(current, version({ adapterVersion: "2" }))).toMatchObject({ status: "stale", reason: "adapter-version" });
    expect(compareAnalysisVersions(current, version({ contentFingerprint: contentFingerprint("changed") }))).toMatchObject({ status: "stale", reason: "content" });
    expect(isAnalysisCurrent(current, current)).toBe(true);
  });
});
