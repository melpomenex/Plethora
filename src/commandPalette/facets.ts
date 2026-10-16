/**
 * Palette facets: classify search results into the palette's scope model and
 * enforce scope at provider boundaries.
 *
 * The palette's six scopes are a *presentation* contract over heterogeneous
 * results (documents, extracts, commands, sections, RSS/podcast items, help).
 * Classification lives here — pure and structural — so provider assembly in
 * `CommandCenter` and presentation in `GlobalSearch` cannot disagree.
 */

import type { PaletteScope } from "./types";

/**
 * Minimal structural shape of a result, decoupled from `SearchResult` to keep
 * this module pure (no component imports).
 */
export interface PaletteFacetableResult {
  type: string;
  metadata?: {
    resultKind?: string;
    category?: string;
    targetPath?: string;
    scopes?: PaletteScope[];
    [key: string]: unknown;
  } | null;
}

/** Non-`all` facets a result can belong to. `help` is mode-level, not scoped. */
export type PaletteResultFacet = Exclude<PaletteScope, "all"> | "help";

const SETTINGS_SECTION_PATHS = new Set(["/settings", "settings"]);

const DOCUMENT_RESULT_TYPES = new Set(["document", "extract", "media", "figure"]);
const LIBRARY_RESULT_TYPES = new Set(["category", "tag"]);

/**
 * Which facet a result belongs to. Explicit `metadata.scopes` (set during
 * provider assembly) wins; otherwise classify by result kind and type.
 */
export function classifyResultFacet(result: PaletteFacetableResult): PaletteResultFacet {
  const explicit = result.metadata?.scopes;
  if (explicit && explicit.length > 0) {
    // The first explicit scope beyond `all` is the primary facet.
    const primary = explicit.find((scope) => scope !== "all");
    if (primary) return primary;
  }

  const kind = result.metadata?.resultKind;
  switch (kind) {
    case "help-article":
    case "ask-plethora":
      return "help";
    case "contextual-action":
    case "command":
      return "actions";
    case "rss-article":
    case "podcast-episode":
      return "library";
    case "section": {
      const path = result.metadata?.targetPath ?? "";
      return SETTINGS_SECTION_PATHS.has(path) ? "settings" : "library";
    }
    default:
      break;
  }

  if (result.type === "flashcard") return "cards";
  if (DOCUMENT_RESULT_TYPES.has(result.type)) return "documents";
  if (LIBRARY_RESULT_TYPES.has(result.type)) return "library";
  // Unknown kinds remain searchable in `all`; treat as documents so a scope
  // change cannot silently drop a content-backed hit.
  return "documents";
}

/**
 * Whether a result is eligible under `scope`.
 * - `all` accepts every facet.
 * - `help` results stay available in every scope (help mode/prefixes are an
 *   independent entry path, per the URL/help coexistence requirement).
 * - A result matches a specific scope when its facet (or an explicit extra
 *   scope) includes it.
 */
export function resultMatchesScope(
  result: PaletteFacetableResult,
  scope: PaletteScope
): boolean {
  if (scope === "all") return true;
  const facet = classifyResultFacet(result);
  if (facet === "help") return true;
  if (facet === scope) return true;
  return result.metadata?.scopes?.includes(scope) ?? false;
}

/** Filter a result list to one scope (used after provider assembly). */
export function filterResultsByScope<T extends PaletteFacetableResult>(
  results: T[],
  scope: PaletteScope
): T[] {
  if (scope === "all") return results;
  return results.filter((result) => resultMatchesScope(result, scope));
}

/**
 * Explicit scope tags for a global command, so command results honor the
 * Actions/Library/Settings scopes. Registry entries declare their scopes
 * (`Command.scopes`); everything else falls back to the legacy category
 * rules (`settingsCategoryId` is the command's `CommandCategory` value as a
 * string).
 */
export function commandScopes(
  category: string,
  commandId: string,
  scopes?: readonly PaletteScope[]
): PaletteScope[] {
  if (scopes && scopes.length > 0) return [...scopes];
  if (category === "Settings" || commandId.startsWith("theme-")) {
    return ["settings"];
  }
  if (category === "Navigation") {
    return ["library"];
  }
  return ["actions"];
}
