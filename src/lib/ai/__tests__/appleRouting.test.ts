import { describe, expect, it } from "vitest";
import { appleErrorFromReason } from "../apple/errors";
import { parsePlethoraUri } from "../apple/spotlight";
import { FakeLanguageProvider, FakeSpeechProvider } from "../providers/fakes";
import { resolveTaskRoute } from "../tasks/router";

describe("Apple error mapping", () => {
  it("maps frozen native reasons", () => {
    expect(appleErrorFromReason("permission_denied", "mic").category).toBe("PermissionDenied");
    expect(appleErrorFromReason("apple_intelligence_disabled", "off").category).toBe(
      "FeatureDisabled"
    );
    expect(appleErrorFromReason("unsupported_os", "old").category).toBe("UnsupportedDevice");
    expect(appleErrorFromReason("unsupported_language", "zh").category).toBe("UnsupportedLanguage");
    expect(appleErrorFromReason("ocr_failed", "vision").category).toBe("GenerationFailed");
  });
});

describe("Spotlight URI parse", () => {
  it("parses plethora kinds", () => {
    expect(parsePlethoraUri("plethora://chunk/abc")).toEqual({ kind: "chunk", id: "abc" });
    expect(parsePlethoraUri("https://example.com")).toBeNull();
  });
});

describe("FakeLanguageProvider", () => {
  it("is an AIProvider the router can skip when textGeneration is false", async () => {
    const dead = new FakeLanguageProvider({ capabilities: { textGeneration: false } });
    const live = new FakeLanguageProvider({
      id: "live",
      capabilities: { textGeneration: true },
    });
    const route = await resolveTaskRoute(
      {
        id: "t",
        taskType: "prompt",
        modelClass: "full",
        systemInstruction: "",
        buildInput: () => ({ text: "x" }),
        outputKind: "text",
        maxOutputTokens: 16,
        timeoutMs: 1000,
      },
      { providers: [dead, live] }
    );
    expect(route?.provider.id).toBe("live");
  });
});

describe("FakeSpeechProvider", () => {
  it("replays scripted transcripts", async () => {
    const fake = new FakeSpeechProvider([{ text: "hello", segments: [] }]);
    await expect(fake.transcribeFile()).resolves.toMatchObject({ text: "hello" });
  });
});
