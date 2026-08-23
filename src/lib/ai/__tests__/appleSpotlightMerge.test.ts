import { describe, expect, it } from "vitest";
import { parsePlethoraUri, mergeSpotlightIntoFts } from "../apple/spotlight";
import { useSettingsStore } from "../../../stores/settingsStore";

describe("Spotlight FTS merge", () => {
  it("dedupes plethora URIs against existing FTS ids", async () => {
    useSettingsStore.setState((s) => ({
      ...s,
      settings: {
        ...s.settings,
        features: { ...s.settings.features, appleSpotlightIndex: false },
      },
    }));
    const merged = await mergeSpotlightIntoFts("q", [
      { id: "doc-1", resultType: "document", title: "A", score: 1, documentId: "doc-1" },
    ]);
    expect(merged).toHaveLength(1);
    expect(parsePlethoraUri("plethora://chunk/abc")?.id).toBe("abc");
  });
});
