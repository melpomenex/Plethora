import { describe, expect, it } from "vitest";
import {
  NAVIGATION_DESTINATIONS,
  TAB_TYPE_ALIASES,
  resolveTabType,
} from "../tabDestinations";
import { en } from "../../lib/i18n/locales/en";

describe("navigation destinations ↔ router drift", () => {
  it("resolves every destination path to its declared tab type", () => {
    for (const destination of NAVIGATION_DESTINATIONS) {
      expect(
        resolveTabType(destination.path),
        `path "${destination.path}" must resolve to "${destination.tabType}"`
      ).toBe(destination.tabType);
      // The navigate handler strips the leading slash before resolving.
      expect(resolveTabType(destination.path.replace(/^\//, ""))).toBe(destination.tabType);
    }
  });

  it("declares label and description keys that exist in the en dictionary", () => {
    for (const destination of NAVIGATION_DESTINATIONS) {
      expect(
        en[destination.labelKey],
        `labelKey "${destination.labelKey}" missing from en.ts`
      ).toBeTruthy();
      expect(
        en[destination.descriptionKey],
        `descriptionKey "${destination.descriptionKey}" missing from en.ts`
      ).toBeTruthy();
    }
  });

  it("keeps ids, paths, and aliases unique", () => {
    const ids = NAVIGATION_DESTINATIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);

    const paths = NAVIGATION_DESTINATIONS.map((d) => d.path.toLowerCase());
    expect(new Set(paths).size).toBe(paths.length);

    const aliases = NAVIGATION_DESTINATIONS.flatMap((d) =>
      d.aliases.map((alias) => alias.toLowerCase())
    );
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("only maps aliases to tab types that a destination declares", () => {
    const declaredTabTypes = new Set(NAVIGATION_DESTINATIONS.map((d) => d.tabType));
    for (const [alias, tabType] of Object.entries(TAB_TYPE_ALIASES)) {
      expect(
        declaredTabTypes.has(tabType),
        `alias "${alias}" maps to undeclared tab type "${tabType}"`
      ).toBe(true);
    }
  });

  it("has no alias that shadows another destination's id or path slug", () => {
    const reserved = new Set(
      NAVIGATION_DESTINATIONS.flatMap((d) => [
        d.id.toLowerCase(),
        d.path.replace(/^\//, "").toLowerCase(),
      ])
    );
    for (const destination of NAVIGATION_DESTINATIONS) {
      for (const alias of destination.aliases) {
        const normalized = alias.toLowerCase();
        if (reserved.has(normalized)) {
          // An alias may equal its own destination's id/slug, but never a
          // different destination's.
          expect(
            normalized === destination.id.toLowerCase() ||
              normalized === destination.path.replace(/^\//, "").toLowerCase(),
            `alias "${alias}" shadows another destination`
          ).toBe(true);
        }
      }
    }
  });
});
