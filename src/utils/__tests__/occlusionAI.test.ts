import { describe, expect, it } from "vitest";
import {
  IMAGE_OCCLUSION_SYSTEM_PROMPT,
  buildImageOcclusionRefinementInstruction,
  extractJsonFromResponse,
  modelSupportsImageInput,
  normalizeOcclusionRegions,
  parseOcclusionResponse,
} from "../occlusionAI";
import type { ImageOcclusionRegion } from "../../types/learningItemInteractions";

describe("IMAGE_OCCLUSION_SYSTEM_PROMPT", () => {
  it("is a single-image prompt that returns the regions schema", () => {
    expect(IMAGE_OCCLUSION_SYSTEM_PROMPT).toContain('"regions"');
    expect(IMAGE_OCCLUSION_SYSTEM_PROMPT).toContain("bbox");
    expect(IMAGE_OCCLUSION_SYSTEM_PROMPT).toContain("0-1000");
    // Single-image framing: no multi-image "Image 1 / imageAssetId" language.
    expect(IMAGE_OCCLUSION_SYSTEM_PROMPT).not.toContain("imageAssetId");
  });
});

describe("buildImageOcclusionRefinementInstruction", () => {
  it("returns an empty instruction when nothing is covered", () => {
    expect(buildImageOcclusionRefinementInstruction([])).toBe("");
  });

  it("names the covered areas and asks for different proposals", () => {
    const covered: ImageOcclusionRegion[] = [
      { id: "a", x: 10, y: 20, width: 30, height: 40, label: "axis" },
      { id: "b", x: 50, y: 50, width: 10, height: 10 },
    ];
    const instruction = buildImageOcclusionRefinementInstruction(covered);
    expect(instruction).toContain("[10.0, 20.0, 40.0, 60.0]");
    expect(instruction).toContain("(label: axis)");
    expect(instruction).toContain("already covered");
    expect(instruction).toContain("Propose different areas");
  });
});

describe("normalizeOcclusionRegions", () => {
  it("converts 0-1000 bboxes into percent regions", () => {
    const { regions, droppedOutOfBounds, droppedDuplicate } = normalizeOcclusionRegions([
      { bbox: [100, 200, 300, 400], label: "term" },
    ]);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ x: 20, y: 10, width: 20, height: 20, label: "term" });
    expect(regions[0].id).toBe("region-1");
    expect(droppedOutOfBounds).toBe(0);
    expect(droppedDuplicate).toBe(0);
  });

  it("accepts plain percent x/y/width/height entries", () => {
    const { regions } = normalizeOcclusionRegions([{ x: 5, y: 6, width: 7, height: 8 }]);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ x: 5, y: 6, width: 7, height: 8 });
  });

  it("clamps out-of-bounds proposals and counts them as dropped", () => {
    const { regions, droppedOutOfBounds } = normalizeOcclusionRegions([
      { bbox: [1000, 1000, 1100, 1100] }, // entirely beyond the image -> zero area
      { bbox: [0, 0, 1000, 1000] }, // clamps to the full image -> usable
    ]);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
    expect(droppedOutOfBounds).toBe(1);
  });

  it("drops proposals that duplicate an accepted region", () => {
    const existing: ImageOcclusionRegion[] = [{ id: "accepted", x: 0, y: 0, width: 10, height: 10 }];
    const { regions, droppedDuplicate } = normalizeOcclusionRegions(
      [
        { bbox: [0, 0, 100, 100] }, // overlaps the accepted region almost fully
        { bbox: [500, 500, 600, 600] }, // disjoint -> kept
      ],
      { existingRegions: existing },
    );
    expect(regions).toHaveLength(1);
    expect(regions[0].x).toBeCloseTo(50);
    expect(droppedDuplicate).toBe(1);
  });

  it("deduplicates proposals against regions accepted earlier in the same batch", () => {
    const { regions, droppedDuplicate } = normalizeOcclusionRegions([
      { bbox: [0, 0, 100, 100] },
      { bbox: [10, 10, 110, 110] }, // near-identical to the first
    ]);
    expect(regions).toHaveLength(1);
    expect(droppedDuplicate).toBe(1);
  });

  it("counts malformed entries as dropped out of bounds", () => {
    const { regions, droppedOutOfBounds } = normalizeOcclusionRegions([
      { bbox: ["not", "numbers", null, undefined] },
      { bbox: [0, 0, 100, 100] },
    ]);
    expect(regions).toHaveLength(1);
    expect(droppedOutOfBounds).toBe(1);
  });

  it("returns an empty result for an unparseable response", () => {
    for (const garbage of [null, undefined, "no json here", { regions: [] }, 42]) {
      const result = normalizeOcclusionRegions(garbage);
      expect(result.regions).toEqual([]);
      expect(result.droppedOutOfBounds).toBe(0);
      expect(result.droppedDuplicate).toBe(0);
    }
  });

  it("counts a bare array of numbers as malformed entries", () => {
    const result = normalizeOcclusionRegions([1, 2, 3]);
    expect(result.regions).toEqual([]);
    expect(result.droppedOutOfBounds).toBe(3);
    expect(result.droppedDuplicate).toBe(0);
  });

  it("honors a custom duplicate threshold", () => {
    const existing: ImageOcclusionRegion[] = [{ id: "a", x: 0, y: 0, width: 10, height: 10 }];
    // Half-overlap has IoU 1/3: duplicate with a low threshold, kept with a high one.
    const low = normalizeOcclusionRegions([{ bbox: [0, 50, 100, 150] }], {
      existingRegions: existing,
      duplicateThreshold: 0.2,
    });
    expect(low.regions).toHaveLength(0);
    expect(low.droppedDuplicate).toBe(1);
    const high = normalizeOcclusionRegions([{ bbox: [0, 50, 100, 150] }], {
      existingRegions: existing,
      duplicateThreshold: 0.5,
    });
    expect(high.regions).toHaveLength(1);
    expect(high.droppedDuplicate).toBe(0);
  });
});

describe("extractJsonFromResponse", () => {
  it("extracts a fenced JSON code block", () => {
    const content = 'Sure! Here you go:\n```json\n{ "regions": [{ "bbox": [0, 0, 100, 100] }] }\n```\nHope that helps.';
    expect(extractJsonFromResponse(content)).toEqual({ regions: [{ bbox: [0, 0, 100, 100] }] });
  });

  it("extracts an unfenced object from surrounding prose", () => {
    const content = 'The regions are { "regions": [] } as requested.';
    expect(extractJsonFromResponse(content)).toEqual({ regions: [] });
  });

  it("tolerates trailing commas", () => {
    expect(extractJsonFromResponse('{ "regions": [{ "bbox": [0, 0, 10, 10], }, ], }')).toEqual({
      regions: [{ bbox: [0, 0, 10, 10] }],
    });
  });

  it("returns null for unparseable content", () => {
    expect(extractJsonFromResponse("no json at all")).toBeNull();
    expect(extractJsonFromResponse("{ broken json")).toBeNull();
    expect(extractJsonFromResponse("")).toBeNull();
  });
});

describe("parseOcclusionResponse", () => {
  it("returns the regions value from a valid response", () => {
    expect(
      parseOcclusionResponse('```json\n{ "regions": [{ "bbox": [10, 20, 30, 40] }] }\n```'),
    ).toEqual([{ bbox: [10, 20, 30, 40] }]);
  });

  it("returns null when the response is not an object or lacks regions", () => {
    expect(parseOcclusionResponse('["not", "an", "object"]')).toBeNull();
    expect(parseOcclusionResponse('{ "cards": [] }')).toBeNull();
    expect(parseOcclusionResponse("garbage")).toBeNull();
  });
});

describe("modelSupportsImageInput", () => {
  it("recognizes vision-capable models per provider", () => {
    expect(modelSupportsImageInput("anthropic", "claude-3-5-sonnet")).toBe(true);
    expect(modelSupportsImageInput("openai", "gpt-4o")).toBe(true);
    expect(modelSupportsImageInput("openai", "gpt-3.5-turbo")).toBe(false);
    expect(modelSupportsImageInput("ollama", "llava:13b")).toBe(true);
    expect(modelSupportsImageInput("ollama", "llama3.1")).toBe(false);
    expect(modelSupportsImageInput("gemini", "gemini-1.5-pro")).toBe(true);
    expect(modelSupportsImageInput("openrouter", "anthropic/claude-3.5-sonnet")).toBe(true);
  });

  it("rejects unknown providers and empty models", () => {
    expect(modelSupportsImageInput("unknown", "gpt-4o")).toBe(false);
    expect(modelSupportsImageInput("openai", "")).toBe(false);
    expect(modelSupportsImageInput("openai", undefined)).toBe(false);
  });
});
