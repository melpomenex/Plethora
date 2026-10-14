import { describe, expect, it } from "vitest";
import {
  classifyPaletteMode,
  isPaletteActionId,
  isPaletteScope,
  PALETTE_ACTION_IDS,
  PALETTE_SCOPES,
} from "../types";

describe("palette contracts", () => {
  it("runtime scope guards accept only the six exclusive scopes", () => {
    for (const scope of PALETTE_SCOPES) expect(isPaletteScope(scope)).toBe(true);
    expect(isPaletteScope("analytics")).toBe(false);
    expect(isPaletteScope("")).toBe(false);
    expect(isPaletteScope(null)).toBe(false);
    expect(isPaletteScope(42)).toBe(false);
  });

  it("runtime action-id guards accept only the stable catalogue", () => {
    for (const id of PALETTE_ACTION_IDS) expect(isPaletteActionId(id)).toBe(true);
    expect(isPaletteActionId("palette.unknown")).toBe(false);
    expect(isPaletteActionId("doc.deleteEverything")).toBe(false);
    expect(isPaletteActionId(undefined)).toBe(false);
  });

  it("derives the body mode with documented precedence", () => {
    const base = { query: "", scope: "all" as const, isUrl: false, composingNote: false, helpForced: false };
    expect(classifyPaletteMode(base)).toBe("home");
    expect(classifyPaletteMode({ ...base, query: "  " })).toBe("home");
    expect(classifyPaletteMode({ ...base, query: "fascism" })).toBe("search");
    expect(classifyPaletteMode({ ...base, isUrl: true, query: "https://x.test" })).toBe("url");
    expect(classifyPaletteMode({ ...base, isUrl: true, composingNote: true })).toBe("note");
    expect(classifyPaletteMode({ ...base, helpForced: true, query: "?backup" })).toBe("help");
    // URL mode outranks forced help.
    expect(
      classifyPaletteMode({ ...base, isUrl: true, helpForced: true, query: "?x" })
    ).toBe("url");
  });
});
