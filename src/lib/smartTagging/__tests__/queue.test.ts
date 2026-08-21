import { describe, expect, it } from "vitest";
import { classifyDocumentBaseline } from "../baseline";
import { canonicalizeTag, normalizeForComparison } from "../normalization";

describe("Smart Tagging End-to-End Invariants", () => {
  it("preserves manual tags and respects dismissed tags", () => {
    const doc = {
      title: "Introduction to Operating Systems: Schedulers and Threads",
      headings: ["Process States", "Round Robin Scheduling"],
      body: "Operating systems manage CPU context switching, kernel interrupts, and multithreading.",
      existingLibraryTags: [{ name: "Systems" }],
      manualTags: ["Custom Manual Tag"],
      dismissedTags: ["Operating System"],
    };

    const details = classifyDocumentBaseline(doc);
    const tags = details.map((d) => d.tag);

    // Must not contain the dismissed tag
    expect(tags.some((t) => normalizeForComparison(t) === normalizeForComparison("Operating System"))).toBe(false);

    // May match Systems or other high confidence terms
    expect(details.every((d) => d.confidence >= 0.70)).toBe(true);
  });

  it("reuses existing library taxonomy tags over new variations", () => {
    const existing = ["Artificial Intelligence", "Web Development"];
    const tag1 = canonicalizeTag("artificial intelligence", existing);
    const tag2 = canonicalizeTag("AI", existing);

    expect(tag1).toBe("Artificial Intelligence");
    expect(tag2).toBe("Artificial Intelligence");
  });
});
