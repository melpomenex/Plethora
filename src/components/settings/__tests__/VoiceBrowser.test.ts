import { describe, expect, it } from "vitest";
import { parseVoiceMetadata } from "../VoiceBrowser";

describe("voice browser metadata", () => {
  it("parses the documented vendor naming conventions", () => {
    expect(parseVoiceMetadata({ id: "aura-2-thalia-en", vendor: "Deepgram" }).language).toBe("en");
    expect(parseVoiceMetadata({ id: "af_bella", vendor: "Kokoro" }).gender).toBe("female");
    expect(parseVoiceMetadata({ id: "en_paul_happy", vendor: "Voxtral" })).toMatchObject({ language: "en", style: "happy" });
    expect(parseVoiceMetadata({ id: "en-US-Harper:MAI-Voice-2", vendor: "Microsoft" }).language).toBe("en-US");
  });

  it("leaves unrecognized identifiers untagged", () => {
    expect(parseVoiceMetadata({ id: "Zephyr", vendor: "Google" })).toEqual({});
  });
});
