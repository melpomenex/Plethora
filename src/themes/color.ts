/**
 * Dependency-free color math for the theme layer.
 *
 * All perceptual math (OKLCH) happens here in JS and never leaks into CSS:
 * emitted color strings are hex/rgb only (see the theme-mode-accent design,
 * D2 — WebKitGTK/WebView2/WKWebView support for oklch()/color-mix() varies).
 *
 * sRGB ⇄ OKLCH uses Björn Ottosson's public-domain OkLab matrices.
 */

export interface Rgb {
  r: number; // 0–255
  g: number; // 0–255
  b: number; // 0–255
}

export interface Rgba extends Rgb {
  a: number; // 0–1
}

export interface Oklch {
  l: number; // 0–1 (perceptual lightness)
  c: number; // chroma, ≥ 0
  h: number; // hue in degrees, 0–360
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgbChannel(linear: number): number {
  const c = linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return clamp01(c) * 255;
}

/**
 * Parse a color string into RGBA. Handles `#rgb`, `#rgba`, `#rrggbb`,
 * `#rrggbbaa`, `rgb()` and `rgba()` (comma and space syntax). Returns `null`
 * for anything else — callers decide whether that is fatal.
 */
export function parseColor(input: string | undefined | null): Rgba | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();

  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    const expand = (chars: string): number => parseInt(chars.length === 1 ? chars + chars : chars, 16);
    switch (hex.length) {
      case 3:
      case 4: {
        if (!/^[0-9a-f]+$/.test(hex)) return null;
        const r = expand(hex[0]);
        const g = expand(hex[1]);
        const b = expand(hex[2]);
        const a = hex.length === 4 ? expand(hex[3]) / 255 : 1;
        return { r, g, b, a };
      }
      case 6:
      case 8: {
        if (!/^[0-9a-f]+$/.test(hex)) return null;
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
        return { r, g, b, a };
      }
      default:
        return null;
    }
  }

  const fnMatch = trimmed.match(/^rgba?\(\s*([^)]*)\)$/);
  if (fnMatch) {
    const parts = fnMatch[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return null;
    const nums: number[] = [];
    for (const part of parts) {
      if (part.endsWith("%")) {
        const pct = Number.parseFloat(part.slice(0, -1));
        if (!Number.isFinite(pct)) return null;
        nums.push((clamp01(pct / 100)) * 255);
      } else {
        const value = Number.parseFloat(part);
        if (!Number.isFinite(value)) return null;
        nums.push(value);
      }
    }
    const [r, g, b] = nums;
    const a = nums.length === 4 ? nums[3] : 1;
    if (r < 0 || g < 0 || b < 0 || a < 0 || a > 1) return null;
    return { r: Math.min(r, 255), g: Math.min(g, 255), b: Math.min(b, 255), a };
  }

  return null;
}

/**
 * Composite a (possibly translucent) color over an opaque base color.
 * Returns the flattened opaque result.
 */
export function flattenOverBase(color: Rgba, base: Rgb): Rgb {
  const a = clamp01(color.a);
  return {
    r: color.r * a + base.r * (1 - a),
    g: color.g * a + base.g * (1 - a),
    b: color.b * a + base.b * (1 - a),
  };
}

/**
 * Ensures a color value is opaque by stripping alpha or falling back to a
 * solid color. Extracted from ThemeContext (popover background handling) so
 * the theme layer shares one implementation.
 */
export function makeOpaque(color: string | undefined, fallback = "#1e293b"): string {
  if (!color) return fallback;
  const trimmed = color.trim();
  const rgbaMatch = trimmed.match(/^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*[\d.]+\s*\)$/i);
  if (rgbaMatch) {
    return `rgb(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]})`;
  }
  if (/^#[0-9a-fA-F]{8}$/.test(trimmed)) {
    return trimmed.slice(0, 7);
  }
  if (/^#[0-9a-fA-F]{4}$/.test(trimmed)) {
    return trimmed.slice(0, 4);
  }
  return trimmed;
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const toHex = (value: number) => Math.round(clamp01(value / 255) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lr = srgbChannelToLinear(r);
  const lg = srgbChannelToLinear(g);
  const lb = srgbChannelToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;

  return { l: L, c, h };
}

export function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const lCubed = l_ * l_ * l_;
  const mCubed = m_ * m_ * m_;
  const sCubed = s_ * s_ * s_;

  const lr = 4.0767416621 * lCubed - 3.3077115913 * mCubed + 0.2309699292 * sCubed;
  const lg = -1.2684380046 * lCubed + 2.6097574011 * mCubed - 0.3413193965 * sCubed;
  const lb = -0.0041960863 * lCubed - 0.7034186147 * mCubed + 1.707614701 * sCubed;

  return {
    r: linearToSrgbChannel(lr),
    g: linearToSrgbChannel(lg),
    b: linearToSrgbChannel(lb),
  };
}

/**
 * WCAG 2.x relative luminance of an opaque sRGB color.
 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b)
  );
}

/**
 * WCAG 2.x contrast ratio between two opaque colors (1–21).
 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Angular distance between two hues in degrees (0–180).
 */
export function hueSeparation(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Mirror a lightness value into a readable band: values below the band reflect
 * off the band's lower edge, values above the band clamp to its upper edge.
 */
export function mirrorIntoBand(l: number, bandLow: number, bandHigh: number): number {
  if (l < bandLow) return Math.min(bandHigh, bandLow + (bandLow - l));
  if (l > bandHigh) return bandHigh;
  return l;
}

/**
 * Normalize hue into [0, 360).
 */
export function normalizeHue(h: number): number {
  const wrapped = h % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Shortest signed rotation (in degrees, in [-180, 180)) needed to go from
 * `from` to `to`.
 */
export function shortestHueDelta(from: number, to: number): number {
  let delta = normalizeHue(to - from);
  if (delta >= 180) delta -= 360;
  return delta;
}

export { clamp01 };
