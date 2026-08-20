import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE_PROFILE_SCOPE,
  canonicalizeLanguageTag,
  isValidBcp47,
} from "../languageProfile";

describe("language profile contract", () => {
  it("canonicalizes target tags without depending on the UI locale", () => {
    expect(canonicalizeLanguageTag("es-mx")).toBe("es-MX");
    expect(canonicalizeLanguageTag("zh-hant-tw")).toBe("zh-Hant-TW");
    expect(DEFAULT_LANGUAGE_PROFILE_SCOPE).toEqual({ accountId: "local", workspaceId: "default" });
  });

  it("accepts script/region tags and rejects malformed tags", () => {
    expect(isValidBcp47("ja")).toBe(true);
    expect(isValidBcp47("zh-Hant-TW")).toBe(true);
    expect(isValidBcp47("-es")).toBe(false);
    expect(isValidBcp47("e")).toBe(false);
  });
});
