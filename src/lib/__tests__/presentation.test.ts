import { describe, expect, it } from "vitest";
import {
  classifyPresentation,
  presentationUsesMobileShell,
} from "../presentation";

const base = {
  viewportWidth: 1280,
  viewportHeight: 800,
  isTauri: false,
  isNativeMobile: false,
  isNativePhone: false,
};

describe("classifyPresentation", () => {
  it("keeps a native phone in phone mode after landscape rotation", () => {
    expect(
      classifyPresentation({
        ...base,
        viewportWidth: 844,
        viewportHeight: 390,
        isTauri: true,
        isNativeMobile: true,
        isNativePhone: true,
      }),
    ).toBe("phone");
  });

  it("moves a native tablet between tablet and desktop modes", () => {
    const tablet = {
      ...base,
      isTauri: true,
      isNativeMobile: true,
    };
    expect(
      classifyPresentation({
        ...tablet,
        viewportWidth: 820,
        viewportHeight: 1180,
      }),
    ).toBe("tablet");
    expect(
      classifyPresentation({
        ...tablet,
        viewportWidth: 1180,
        viewportHeight: 820,
      }),
    ).toBe("desktop");
  });

  it("uses compact desktop for a narrow Tauri desktop window", () => {
    expect(
      classifyPresentation({
        ...base,
        viewportWidth: 760,
        viewportHeight: 560,
        isTauri: true,
      }),
    ).toBe("compact-desktop");
  });

  it("keeps browser phone, tablet, and desktop behavior distinct", () => {
    expect(
      classifyPresentation({
        ...base,
        viewportWidth: 390,
        viewportHeight: 844,
      }),
    ).toBe("phone");
    expect(
      classifyPresentation({
        ...base,
        viewportWidth: 820,
        viewportHeight: 1180,
      }),
    ).toBe("tablet");
    expect(classifyPresentation(base)).toBe("desktop");
  });

  it("only assigns the mobile shell to phone and tablet modes", () => {
    expect(presentationUsesMobileShell("phone")).toBe(true);
    expect(presentationUsesMobileShell("tablet")).toBe(true);
    expect(presentationUsesMobileShell("compact-desktop")).toBe(false);
    expect(presentationUsesMobileShell("desktop")).toBe(false);
  });
});

