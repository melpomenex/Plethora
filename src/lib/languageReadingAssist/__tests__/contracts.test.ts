import { describe, expect, it, vi } from "vitest";
import { ReadingAssistLayerHost, ReadingAssistRegistry, createIdentityAssistProvider } from "../index";

describe("reading assist layer", () => {
  it("caches by profile/content/provider and exposes source spans without mutation", async () => {
    const assist = vi.fn((text: string) => [{ start: 0, end: 2, annotation: "ruby", renderedText: "語" }]);
    const registry = new ReadingAssistRegistry();
    registry.register(createIdentityAssistProvider({ providerId: "local", providerVersion: "1", kinds: ["ruby"], languages: ["ja"], offline: true, maxCodeUnits: 100, preservesSource: true }, assist));
    const request = { sourceId: "doc", contentFingerprint: "v1", text: "語る", languageTag: "ja", profileId: "p1", kind: "ruby" as const };
    const first = await registry.run(request);
    const second = await registry.run(request);
    expect(assist).toHaveBeenCalledOnce();
    const host = new ReadingAssistLayerHost();
    host.setResult(first);
    expect(host.spansForRange(1, 3)).toHaveLength(1);
    expect(host.getResult()?.spans[0]?.sourceText).toBe("語る");
    expect(second.status).toBe("ready");
  });

  it("returns truthful unsupported state and does not fabricate a fallback", async () => {
    const registry = new ReadingAssistRegistry();
    const result = await registry.run({ sourceId: "doc", contentFingerprint: "v1", text: "abc", languageTag: "xx", kind: "transliteration" });
    expect(result.status).toBe("unsupported");
    expect(result.spans).toEqual([]);
  });
});
