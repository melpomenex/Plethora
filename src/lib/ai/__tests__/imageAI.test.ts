/**
 * Image adapter tests against the task-layer architecture: payload
 * validation, the ML Kit Image Description fast path, delimited-format
 * parsing (TITLE/DESCRIPTION/TAGS) and occlusion clamping run for real.
 * `../onDeviceAI` is faked only at the ML Kit seam production still calls;
 * `../providers` routes `runTask` to a scripted `FakeAIProvider`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider } from "../providers/types";
import { FakeAIProvider, type FakeResponse } from "../__fixtures__/FakeAIProvider";

vi.mock("../onDeviceAI", async () => {
  const actual = await vi.importActual<typeof import("../onDeviceAI")>("../onDeviceAI");
  return {
    ...actual,
    describeOnDeviceImage: vi.fn(),
  };
});

const routing = vi.hoisted(() => ({ providers: [] as AIProvider[] }));

vi.mock("../provider", () => ({
  resolveAiPath: vi.fn(async () => "ondevice"),
  prefersOnDevice: vi.fn(() => true),
  hasCloudProvider: vi.fn(() => false),
  requestCloudFallback: vi.fn(async () => true),
}));

vi.mock("../providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../providers")>()),
  getRoutingProviders: () => routing.providers,
}));

import { describeOnDeviceImage } from "../onDeviceAI";
import {
  describeImage,
  suggestOcclusions,
  validateImagePayload,
  type ImageInputPayload,
} from "../imageAI";

/**
 * Script one response (or thrown `Error`) per task, keyed by a needle found
 * in that task's built request text.
 */
type ScriptedOutcome = Error | string | { text: string; baseModelName?: string };

function installProvider(script: Record<string, ScriptedOutcome>): FakeAIProvider {
  const dispatch: FakeResponse = (req) => {
    for (const [needle, outcome] of Object.entries(script)) {
      if (req.text.includes(needle)) {
        if (outcome instanceof Error) return outcome;
        if (typeof outcome === "string") return { requestId: req.requestId, text: outcome };
        return { requestId: req.requestId, ...outcome };
      }
    }
    return new Error(`No scripted response for request: ${req.text.slice(0, 80)}`);
  };
  const provider = new FakeAIProvider({
    id: "image-ondevice",
    kind: "ondevice",
    responses: [dispatch],
  });
  routing.providers = [provider];
  return provider;
}

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
    const provider = installProvider({ "Analyze the image": "never reached" });
    vi.mocked(describeOnDeviceImage).mockResolvedValue("A lecture slide about osmosis.");

    const res = await describeImage({ mimeType: "image/jpeg", dataBase64: "aGVsbG8=" });
    expect(res.description).toBe("A lecture slide about osmosis.");
    expect(res.provenance).toBe("ondevice-image-description");
    expect(provider.callCount).toBe(0);
  });

  it("parses TITLE, DESCRIPTION, and TAGS lines", async () => {
    installProvider({
      "Analyze the image": {
        text: "TITLE: Heart Diagram\nDESCRIPTION: A detailed diagram showing cardiac chambers.\nTAGS: heart, anatomy, diagram",
        baseModelName: "gemini-nano",
      },
    });
    vi.mocked(describeOnDeviceImage).mockRejectedValue(new Error("unavailable"));

    const res = await describeImage({ mimeType: "image/jpeg", dataBase64: "aGVsbG8=" });
    expect(res.suggestedTitle).toBe("Heart Diagram");
    expect(res.description).toBe("A detailed diagram showing cardiac chambers.");
    expect(res.suggestedTags).toEqual(["heart", "anatomy", "diagram"]);
    expect(res.provenance).toBe("gemini-nano");
  });
});

describe("suggestOcclusions", () => {
  it("parses normalized coordinates and clamps bounds", async () => {
    installProvider({
      "occluded":
        "RECT: 0.1, 0.2, 0.3, 0.4 | Left Ventricle\nRECT: -0.1, 1.5, 0.5, 0.5 | Right Atrium",
    });

    const rects = await suggestOcclusions({ mimeType: "image/jpeg", dataBase64: "aGVsbG8=" });
    expect(rects).toHaveLength(2);
    expect(rects[0]).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.4, label: "Left Ventricle" });
    // Second rect clamped
    expect(rects[1].x).toBe(0);
    expect(rects[1].y).toBe(1);
  });

  it("filters out rectangles with area smaller than minimum area 0.001", async () => {
    installProvider({
      "occluded": "RECT: 0.1, 0.2, 0.01, 0.01 | Tiny dot",
    });

    const rects = await suggestOcclusions({ mimeType: "image/jpeg", dataBase64: "aGVsbG8=" });
    expect(rects).toHaveLength(0);
  });
});
