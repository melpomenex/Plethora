import { HIGHLIGHT_COLORS, type HighlightColor } from "../components/viewer/SelectionPopup";

const TEXT_HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: "rgba(245, 158, 11, 0.20)",
  green: "rgba(34, 197, 94, 0.20)",
  blue: "rgba(59, 130, 246, 0.20)",
  pink: "rgba(236, 72, 153, 0.20)",
  purple: "rgba(168, 85, 247, 0.20)",
  orange: "rgba(249, 115, 22, 0.20)",
  red: "rgba(239, 68, 68, 0.20)",
};

// Map of all known semantic names, hex codes, and legacy high-opacity colors to their translucent equivalent
const COLOR_MAP: Record<string, string> = {
  yellow: TEXT_HIGHLIGHT_COLORS.yellow,
  green: TEXT_HIGHLIGHT_COLORS.green,
  blue: TEXT_HIGHLIGHT_COLORS.blue,
  pink: TEXT_HIGHLIGHT_COLORS.pink,
  purple: TEXT_HIGHLIGHT_COLORS.purple,
  orange: TEXT_HIGHLIGHT_COLORS.orange,
  red: TEXT_HIGHLIGHT_COLORS.red,

  // Pastel hex aliases
  "#fef08a": TEXT_HIGHLIGHT_COLORS.yellow,
  "#bbf7d0": TEXT_HIGHLIGHT_COLORS.green,
  "#bfdbfe": TEXT_HIGHLIGHT_COLORS.blue,
  "#fbcfe8": TEXT_HIGHLIGHT_COLORS.pink,
  "#e9d5ff": TEXT_HIGHLIGHT_COLORS.purple,
  "#fed7aa": TEXT_HIGHLIGHT_COLORS.orange,
  "#fecaca": TEXT_HIGHLIGHT_COLORS.red,

  // Legacy high-opacity values from HIGHLIGHT_COLORS
  "rgba(255, 235, 59, 0.5)": TEXT_HIGHLIGHT_COLORS.yellow,
  "rgba(76, 175, 80, 0.4)": TEXT_HIGHLIGHT_COLORS.green,
  "rgba(33, 150, 243, 0.4)": TEXT_HIGHLIGHT_COLORS.blue,
  "rgba(233, 30, 99, 0.4)": TEXT_HIGHLIGHT_COLORS.pink,
  "rgba(156, 39, 176, 0.4)": TEXT_HIGHLIGHT_COLORS.purple,
};

export function normalizeHighlightColor(color?: string | null): string {
  if (!color) return TEXT_HIGHLIGHT_COLORS.yellow;

  const normalized = color.trim().toLowerCase();
  
  if (normalized in COLOR_MAP) {
    return COLOR_MAP[normalized];
  }

  // Also check if any key in COLOR_MAP is in normalized form (e.g. spaces inside rgba)
  const cleaned = normalized.replace(/\s+/g, "");
  for (const [key, value] of Object.entries(COLOR_MAP)) {
    if (key.replace(/\s+/g, "") === cleaned) {
      return value;
    }
  }

  return color;
}

export function normalizePdfHighlightColor(color?: string | null): HighlightColor {
  switch ((color ?? "").toLowerCase()) {
    case "green":
    case "#bbf7d0":
      return "green";
    case "blue":
    case "#bfdbfe":
      return "blue";
    case "pink":
    case "#fbcfe8":
    case "red":
    case "#fecaca":
      return "pink";
    case "purple":
    case "#e9d5ff":
      return "purple";
    case "orange":
    case "#fed7aa":
      return "yellow";
    case "yellow":
    case "#fef08a":
    default:
      return "yellow";
  }
}
