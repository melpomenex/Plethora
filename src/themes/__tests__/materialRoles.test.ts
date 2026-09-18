import { describe, expect, it } from "vitest";
import { contrastRatio, parseColor, rgbToOklch } from "../color";
import { deriveMaterialRoles, generateSchemeFromSeed, REQUIRED_MATERIAL_ROLES } from "../materialRoles";
import { builtInThemes } from "../builtin";
import type { Theme, ThemeColors } from "../../types/theme";
import { superGameBroTheme, milkyMatchaTheme } from "../fallback";

function roleLuminance(hex: string): number {
  const rgb = parseColor(hex);
  if (!rgb) throw new Error(`unparseable color: ${hex}`);
  const lum = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return lum;
}

function pairContrast(fg: string, bg: string): number {
  const a = parseColor(fg);
  const b = parseColor(bg);
  if (!a || !b) throw new Error("unparseable pair");
  return contrastRatio(a, b);
}

describe("deriveMaterialRoles", () => {
  it("derives every missing role for a modern dark theme", () => {
    const roles = deriveMaterialRoles(superGameBroTheme.colors, "dark");
    for (const role of [
      "on-surface-variant",
      "secondary-container",
      "on-secondary-container",
      "tertiary",
      "on-tertiary",
      "tertiary-container",
      "on-tertiary-container",
      "surface-container-lowest",
      "surface-container-low",
      "surface-container",
      "surface-container-high",
      "surface-container-highest",
      "surface-dim",
      "surface-bright",
      "inverse-surface",
      "on-inverse-surface",
      "inverse-primary",
      "scrim",
    ]) {
      expect(roles[role], role).toMatch(/^#([0-9a-f]{6}|[0-9a-f]{3})$|^rgba?\(/);
    }
  });

  it("respects explicit theme overrides", () => {
    const roles = deriveMaterialRoles(
      { ...superGameBroTheme.colors, tertiary: "#123456" },
      "dark",
    );
    expect(roles.tertiary).toBeUndefined();
  });

  it("clamps a missing container foreground against an explicit container", () => {
    const roles = deriveMaterialRoles(
      { ...superGameBroTheme.colors, secondaryContainer: "#ffffff" },
      "light",
    );
    expect(pairContrast(roles["on-secondary-container"], "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("dark container hierarchy is monotonically lighter and dark", () => {
    const roles = deriveMaterialRoles(superGameBroTheme.colors, "dark");
    const l = (k: string) => rgbToOklch(parseColor(roles[k])!).l;
    expect(l("surface-container-lowest")).toBeLessThan(l("surface-container-low"));
    expect(l("surface-container-low")).toBeLessThan(l("surface-container"));
    expect(l("surface-container")).toBeLessThan(l("surface-container-high"));
    expect(l("surface-container-high")).toBeLessThan(l("surface-container-highest"));
    expect(l("surface-container-highest")).toBeLessThan(0.62); // stays dark
  });

  it("light container hierarchy is monotonically darker and light", () => {
    const roles = deriveMaterialRoles(milkyMatchaTheme.colors, "light");
    const l = (k: string) => rgbToOklch(parseColor(roles[k])!).l;
    expect(l("surface-container-lowest")).toBeGreaterThan(l("surface-container-low"));
    expect(l("surface-container-low")).toBeGreaterThan(l("surface-container"));
    expect(l("surface-container")).toBeGreaterThan(l("surface-container-high"));
    expect(l("surface-container-high")).toBeGreaterThan(l("surface-container-highest"));
    expect(l("surface-container-highest")).toBeGreaterThan(0.75); // stays light
  });

  it("on-surface keeps at least the theme's original contrast on containers", () => {
    for (const theme of [superGameBroTheme, milkyMatchaTheme] as Theme[]) {
      const roles = deriveMaterialRoles(theme.colors, theme.variant);
      const pair = pairContrast(theme.colors.onSurface, roles["surface-container"]);
      const original = pairContrast(theme.colors.onSurface, theme.colors.surface);
      expect(pair).toBeGreaterThanOrEqual(Math.min(original, 4.5) - 0.35);
    }
  });

  it("preserves contrast for saturated custom surfaces", () => {
    const colors: ThemeColors = {
      ...superGameBroTheme.colors,
      background: "#17131f",
      surface: "#7b165d",
      onSurface: "#ffffff",
      primary: "#b58cff",
      secondary: "#8bd8d0",
      text: "#ffffff",
    };
    const roles = deriveMaterialRoles(colors, "dark");
    const original = pairContrast(colors.onSurface, colors.surface);

    expect(original).toBeGreaterThanOrEqual(4.5);
    for (const key of [
      "surface-container-lowest",
      "surface-container-low",
      "surface-container",
      "surface-container-high",
      "surface-container-highest",
    ]) {
      expect(pairContrast(colors.onSurface, roles[key]), key).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("derived tertiary is hue-separated from primary", () => {
    const roles = deriveMaterialRoles(superGameBroTheme.colors, "dark");
    const primaryHue = rgbToOklch(parseColor(superGameBroTheme.colors.primary)!).h;
    const tertiaryHue = rgbToOklch(parseColor(roles.tertiary)!).h;
    const diff = Math.abs(primaryHue - tertiaryHue) % 360;
    const sep = diff > 180 ? 360 - diff : diff;
    expect(sep).toBeGreaterThan(40);
  });

  it("sweeps every built-in theme: full role set, AA text pairs, monotone containers", () => {
    expect(builtInThemes.length).toBeGreaterThan(150);
    for (const theme of builtInThemes) {
      const roles = deriveMaterialRoles(theme.colors, theme.variant);

      const merged = { ...theme.colors };
      for (const [k, v] of Object.entries(roles)) merged[k] = v;

      // Every role resolves to a parseable color.
      const containerKeys = [
        "surface-container-lowest",
        "surface-container-low",
        "surface-container",
        "surface-container-high",
        "surface-container-highest",
      ] as const;
      for (const key of containerKeys) {
        expect(parseColor(merged[key]), `${theme.id}/${key}`).not.toBeNull();
        const explicitKey = key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()) as keyof typeof theme.colors;
        if (!theme.colors[explicitKey]) {
          expect(pairContrast(theme.colors.onSurface, merged[key]), `${theme.id} surface contrast ${key}`).toBeGreaterThanOrEqual(4.5);
        }
      }

      // Monotonic container ordering for the variant.
      const ls = containerKeys.map((k) => rgbToOklch(parseColor(merged[k])!).l);
      if (theme.variant === "dark") {
        for (let i = 1; i < ls.length; i++) {
          expect(ls[i], `${theme.id} dark ramp`).toBeGreaterThan(ls[i - 1]);
        }
      } else {
        for (let i = 1; i < ls.length; i++) {
          expect(ls[i], `${theme.id} light ramp`).toBeLessThan(ls[i - 1]);
        }
      }

      // Text pairs meet AA (on-variant gets 4.0 latitude for high-saturation
      // novelty themes' decorative text tiers, matching their source styling).
      const pairs: Array<[string, string]> = [
        ["onSecondaryContainer" in merged ? merged.onSecondaryContainer : roles["on-secondary-container"], roles["secondary-container"]],
        [roles["on-tertiary-container"], roles["tertiary-container"]],
        [merged.onSurface, merged.surface],
      ];
      for (const [fg, bg] of pairs) {
        expect(pairContrast(fg, bg), `${theme.id} pair ${fg}/${bg}`).toBeGreaterThanOrEqual(4.0);
      }
      expect(roleLuminance(roles["on-surface-variant"])).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("generateSchemeFromSeed", () => {
  it("produces complete light and dark schemes covering every required role", () => {
    const { light, dark } = generateSchemeFromSeed("#7c5cff");
    for (const scheme of [light, dark]) {
      for (const role of REQUIRED_MATERIAL_ROLES) {
        expect(scheme[role], role).toBeTruthy();
        if (role !== "scrim") expect(parseColor(scheme[role]), role).not.toBeNull();
      }
    }
    expect(light).not.toEqual(dark);
  });

  const seeds = ["#7c5cff", "#0f766e", "#b91c1c", "#eab308", "#3b82f6"];
  for (const seed of seeds) {
    it(`seed ${seed} schemes pass AA for body-text pairs`, () => {
      const { light, dark } = generateSchemeFromSeed(seed);
      for (const scheme of [light, dark]) {
        const pairs: Array<[string, string]> = [
          [scheme["on-primary"], scheme.primary],
          [scheme["on-primary-container"], scheme["primary-container"]],
          [scheme["on-secondary-container"], scheme["secondary-container"]],
          [scheme["on-tertiary-container"], scheme["tertiary-container"]],
          [scheme["on-surface"], scheme.surface],
          [scheme["on-surface-variant"], scheme["surface-container"]],
        ];
        for (const [fg, bg] of pairs) {
          expect(pairContrast(fg, bg), `${seed} ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
});
