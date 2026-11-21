import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdfEmbeddedLinks } from "../pdfEmbeddedLinks";

const { isTauri, openExternal } = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  openExternal: vi.fn(async (_url: string) => {}),
}));

vi.mock("../../../lib/tauri", () => ({ isTauri, openExternal }));

describe("PDF embedded links", () => {
  const navigate = vi.fn(async (_destination: string | unknown[]) => {});
  const links = new PdfEmbeddedLinks(navigate);

  beforeEach(() => {
    navigate.mockClear();
    openExternal.mockClear();
    isTauri.mockReturnValue(false);
  });

  it.each(["http", "https"])("attributes %s destinations for safe new-tab navigation", (scheme) => {
    const link = document.createElement("a");
    const url = `${scheme}://example.test/chapter`;

    links.addLinkAttributes(link, url);

    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.onclick).toBeNull();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("uses the native opener only after explicit activation", () => {
    isTauri.mockReturnValue(true);
    const link = document.createElement("a");
    const url = "https://example.test/chapter";
    links.addLinkAttributes(link, url);
    expect(openExternal).not.toHaveBeenCalled();

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(url);
  });

  it.each([
    "invalid URL",
    "/other/chapter",
    "ftp://example.test/archive",
    "https://reader:example@example.test/chapter",
  ])("disables unsupported destinations (%s)", (url) => {
    isTauri.mockReturnValue(true);
    const link = document.createElement("a");
    links.addLinkAttributes(link, url);
    link.click();

    expect(link).not.toHaveAttribute("href");
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("routes named and explicit destinations through reader navigation", async () => {
    const explicit = [{ num: 7, gen: 0 }, { name: "XYZ" }, 20, 700, null];

    await links.goToDestination("chapter-start");
    await links.goToDestination(explicit);

    expect(navigate.mock.calls).toEqual([["chapter-start"], [explicit]]);
    expect(openExternal).not.toHaveBeenCalled();
  });
});
