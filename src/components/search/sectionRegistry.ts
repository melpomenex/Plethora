/**
 * App-section matching adapter over the canonical navigation destination table.
 *
 * Historically this module kept its own five-section list. Destinations now
 * live in `navigation/tabDestinations` (single source shared with the command
 * registry and the navigate-event resolver); this module preserves the
 * `findMatchingSections` API and score semantics (1.0 / 0.93 / 0.86) used by
 * help intent.
 *
 * Matching is on the palette's interactive path (every classification runs
 * `findMatchingSections`), so each destination precomputes its lowercase
 * candidates and a single searchable string for a fast reject.
 */

import { t } from "../../lib/i18n";
import { NAVIGATION_DESTINATIONS } from "../../navigation/tabDestinations";

export type AppSectionDestination = {
  id: string;
  label: string;
  aliases: string[];
  path: string;
  /** Lowercase match candidates (id, label, path, aliases). */
  candidates: string[];
  /** Lowercase candidates joined for a cheap substring pre-check. */
  searchText: string;
};

export type SectionMatch = {
  section: AppSectionDestination;
  score: number;
};

export const APP_SECTION_DESTINATIONS: AppSectionDestination[] = NAVIGATION_DESTINATIONS.map(
  (destination) => {
    const label = t(destination.labelKey);
    const candidates = [
      destination.id,
      label,
      destination.path,
      ...destination.aliases,
    ].map((candidate) => candidate.toLowerCase());
    return {
      id: destination.id,
      label,
      aliases: destination.aliases,
      path: destination.path,
      candidates,
      searchText: candidates.join(" "),
    };
  }
);

function rankMatch(candidate: string, query: string): number {
  if (!candidate || !query) return 0;
  if (candidate === query) return 1;
  if (candidate.startsWith(query)) return 0.93;
  if (candidate.includes(query)) return 0.86;
  return 0;
}

export function findMatchingSections(query: string): SectionMatch[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const matches: SectionMatch[] = [];
  for (const section of APP_SECTION_DESTINATIONS) {
    // Fast reject: one substring check skips destinations that cannot match.
    if (!section.searchText.includes(normalized)) continue;
    let best = 0;
    for (const candidate of section.candidates) {
      const score = rankMatch(candidate, normalized);
      if (score > best) best = score;
    }
    if (best > 0) {
      matches.push({ section, score: best });
    }
  }

  return matches.sort((a, b) => b.score - a.score || a.section.label.localeCompare(b.section.label));
}
