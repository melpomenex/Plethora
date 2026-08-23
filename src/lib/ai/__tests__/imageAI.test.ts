import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../onDeviceAI", async () => {
  const actual = await vi.importActual<typeof import("../onDeviceAI")>("../onDeviceAI");
  return {
    ...actual,
    generateNativePrompt: vi.fn(),
    describeOnDeviceImage: vi.fn(),
  };
});

import { generateNativePrompt, describeOnDeviceImage } from "../onDeviceAI";
import {
  describeImage,
  generateImageCards,
  suggestOcclusions,
  validateImagePayload,
  type ImageInputPayload,
} from "../imageAI";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validateImagePayload", () => {
  it("rejects empty payload or data", () => {
    expect(() => validateImagePayload({ mimeType: "image/jpeg", dataBase64: "" })).toThrow(
      "Image data payload cannot be empty."
    );
  });

  it("rejects unsupported MIME type", () => {
    const invalid = { mimeType: "image/gif" as unknown as "image/jpeg", dataBase64: "YWJj" };
    expect(() => validateImagePayload(invalid)).toThrow("Unsupported image MIME type: image/gif");
  });

  it("accepts valid jpeg/png/webp payload", () => {
    const valid: ImageInputPayload = { mimeType: "image/png", dataBase64: "aGVsbG8=" };
    expect(() => validateImagePayload(valid)).not.toThrow();
  });
});

describe("describeImage", () => {
  it("uses ML Kit Image Description when it returns text", async () => {
    vi.mocked(describeOnDeviceImage).mockResolvedValue("A lecture slide about osmosis.");

    const res = await describeImage({ mimeType: "image/jpeg", dataBase64: "aGVsbG8=" });
    expect(res.description).toBe("A lecture slide about osmosis.");
    expect(res.provenance).toBe("ondevice-image-description");
    expect(generateNativePrompt).not.toHaveBeenCalled();
  });

  it("parses TITLE, DESCRIPTION, and TAGS lines", async () => {
    vi.mocked(describeOnDeviceImage).mockRejectedValue(new Error("unavailable"));
    vi.mocked(generateNativePrompt).mockResolvedValue({
      requestId: "imgdesc-1",
      text: "TITLE: Heart Diagram\nDESCRIPTION: A detailed diagram showing cardiac chambers.\nTAGS: heart, anatomy, diagram",
      inputTokens: 20,
      tokenLimit: 4096,
      baseModelName: "gemini-nano",
      candidates: [],
    });

    const res = await describeImage({ mimeType: "image/jpeg", dataBase64: "aGVsbG8=" });
    expect(res.suggestedTitle).toBe("Heart Diagram");
    expect(res.description).toBe("A detailed diagram showing cardiac chambers.");
    expect(res.suggestedTags).toEqual(["heart", "anatomy", "diagram"]);
    expect(res.provenance).toBe("gemini-nano");
  });
});

describe("suggestOcclusions", () => {
  it("parses normalized coordinates and clamps bounds", async () => {
    vi.mocked(generateNativePrompt).mockResolvedValue({
      requestId: "imgocc-1",
      text: "RECT: 0.1, 0.2, 0.3, 0.4 | Left Ventricle\nRECT: -0.1, 1.5, 0.5, 0.5 | Right Atrium",
      inputTokens: 20,
      tokenLimit: 4096,
      candidates: [],
    });

    const rects = await suggestOcclusions({ mimeType: "image/jpeg", dataBase64: "aGVsbG8=" });
    expect(rects).toHaveLength(2);
    expect(rects[0]).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.4, label: "Left Ventricle" });
    // Second rect clamped
    expect(rects[1].x).toBe(0);
    expect(rects[1].y).toBe(1);
  });

  it("filters out rectangles with area smaller than minimum area 0.001", async () => {
    vi.mocked(generateNativePrompt).mockResolvedValue({
      requestId: "imgocc-2",
      text: "RECT: 0.1, 0.2, 0.01, 0.01 | Tiny dot",
      inputTokens: 20,
      tokenLimit: 4096,
      candidates: [],
    });

    const rects = await suggestOcclusions({ mimeType: "image/jpeg", dataBase64: "aGVsbG8=" });
    expect(rects).toHaveLength(0);
  });
});
