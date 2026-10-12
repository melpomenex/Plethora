import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/tauri", async (original) => ({
  ...(await original<typeof import("../../lib/tauri")>()),
  isTauri: vi.fn(() => true),
}));
import {
  getRssPreferencesAuto,
  setRssPreferencesAuto,
  migrateLegacyRssReaderPreferences,
} from "../rss";
beforeEach(() => localStorage.clear());
describe("native RSS preference persistence", () => {
  it("merges updates and inherits global values after reload", async () => {
    await setRssPreferencesAuto({ show_author: false, font_size: 24 });
    await setRssPreferencesAuto({ line_height: 1.7 }, "feed");
    await setRssPreferencesAuto({ show_date: false }, "feed");
    expect(await getRssPreferencesAuto("feed")).toMatchObject({
      show_author: false,
      font_size: 24,
      line_height: 1.7,
      show_date: false,
    });
    expect(await getRssPreferencesAuto("other")).toMatchObject({
      font_size: 24,
      line_height: 1.6,
      show_date: true,
    });
  });
  it("clears filters and restores inheritance with null", async () => {
    await setRssPreferencesAuto({ keyword_include: "AI", font_size: 24 });
    await setRssPreferencesAuto({ keyword_include: "", font_size: 30 }, "feed");
    await setRssPreferencesAuto({ font_size: null }, "feed");
    expect(await getRssPreferencesAuto("feed")).toMatchObject({
      keyword_include: "",
      font_size: 24,
    });
  });
  it("migrates legacy values once without overriding explicit RSS choices", async () => {
    localStorage.setItem("reader_font_size", "28");
    localStorage.setItem("reader_line_height", "loose");
    localStorage.setItem("rss_prefs_global", JSON.stringify({ font_size: 20 }));
    migrateLegacyRssReaderPreferences();
    localStorage.setItem("reader_line_height", "normal");
    migrateLegacyRssReaderPreferences();
    expect(await getRssPreferencesAuto()).toMatchObject({ font_size: 20, line_height: 2 });
  });
});

import { setRssPreferencesViaHttp } from "../rss";
describe("HTTP preference transport", () => {
  it("sends explicit clears without flattening unrelated fields", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ font_size: 24, line_height: 1.7 }), { status: 200 })
      );
    await setRssPreferencesViaHttp(
      { keyword_include: "", font_size: null, line_height: 1.7 },
      "feed"
    );
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({
      keyword_include: "",
      font_size: null,
      line_height: 1.7,
    });
    expect(fetcher.mock.calls[0][0]).toContain("feed_id=feed");
    fetcher.mockRestore();
  });
});
