import { describe, it, expect, vi, beforeEach } from "vitest";

const { isTauriMock, isNativeMobileMock, getPlatformMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(() => false),
  isNativeMobileMock: vi.fn(() => false),
  getPlatformMock: vi.fn(() => "mac" as string),
}));

vi.mock("../../lib/tauri", () => ({
  isTauri: isTauriMock,
  isNativeMobile: isNativeMobileMock,
  getPlatform: getPlatformMock,
}));

import { resolveEmbedHost } from "../youtubeEmbed";

const YOUTUBE = "https://www.youtube.com";
const NOCOOKIE = "https://www.youtube-nocookie.com";

describe("resolveEmbedHost", () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(false);
    isNativeMobileMock.mockReturnValue(false);
    getPlatformMock.mockReturnValue("mac");
  });

  it("uses the youtube.com host inside Tauri", () => {
    isTauriMock.mockReturnValue(true);
    expect(resolveEmbedHost()).toBe(YOUTUBE);
  });

  it("uses the youtube.com host on native mobile", () => {
    isNativeMobileMock.mockReturnValue(true);
    expect(resolveEmbedHost()).toBe(YOUTUBE);
  });

  it("uses the youtube.com host on Linux", () => {
    getPlatformMock.mockReturnValue("linux");
    expect(resolveEmbedHost()).toBe(YOUTUBE);
  });

  it("uses the nocookie host in a plain desktop browser", () => {
    expect(resolveEmbedHost()).toBe(NOCOOKIE);
  });

  it("uses the nocookie host on a non-Tauri Windows browser", () => {
    getPlatformMock.mockReturnValue("windows");
    expect(resolveEmbedHost()).toBe(NOCOOKIE);
  });

  // Regression guard: the reset-on-document-switch effect used to hardcode the host,
  // reverting native platforms to the blocked nocookie host on every open.
  it("is stable across repeated calls on a native platform", () => {
    isNativeMobileMock.mockReturnValue(true);
    expect([resolveEmbedHost(), resolveEmbedHost(), resolveEmbedHost()]).toEqual([
      YOUTUBE,
      YOUTUBE,
      YOUTUBE,
    ]);
  });
});
