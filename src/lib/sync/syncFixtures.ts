/** Deterministic, privacy-safe fixtures used by sync performance/convergence tests. */
export type SyncFixtureKind = "small" | "large" | "ten-year" | "corrupt" | "offline-divergent";

export interface SyncFixtureRecord {
  id: string;
  domain: "collections" | "documents" | "extracts" | "learningItems" | "reviews" | "rssArticles";
  updatedAt: string;
  payload: Record<string, unknown>;
}

export interface SyncFixture {
  kind: SyncFixtureKind;
  seed: number;
  records: SyncFixtureRecord[];
  corruptRecordIds: string[];
  deviceMutations: Record<string, SyncFixtureRecord[]>;
}

const COUNTS: Record<SyncFixtureKind, number> = {
  small: 12,
  large: 2_000,
  "ten-year": 25_000,
  corrupt: 500,
  "offline-divergent": 1_000,
};

function clock(index: number): string {
  // HLC-shaped, deterministic timestamps; no real user dates/content.
  return `${1_700_000_000_000 + index}.fixture`;
}

export function buildSyncFixture(kind: SyncFixtureKind, seed = 42): SyncFixture {
  const count = COUNTS[kind];
  const records: SyncFixtureRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const domain = i % 6 === 0
      ? "collections"
      : i % 6 === 1
        ? "documents"
        : i % 6 === 2
          ? "extracts"
          : i % 6 === 3
            ? "learningItems"
            : i % 6 === 4
              ? "reviews"
              : "rssArticles";
    records.push({
      id: `${domain}-${seed}-${i}`,
      domain,
      updatedAt: clock(i),
      payload: {
        title: `fixture-${seed}-${i}`,
        value: (seed * 31 + i * 17) % 997,
        // Deliberately small: fixtures must not accidentally measure payload size.
        body: `deterministic-${i % 11}`,
      },
    });
  }

  const corruptRecordIds = kind === "corrupt" ? records.filter((_, i) => i % 37 === 0).map((r) => r.id) : [];
  const deviceMutations: Record<string, SyncFixtureRecord[]> = {};
  if (kind === "offline-divergent") {
    deviceMutations.desktop = records.filter((_, i) => i % 3 === 0).map((r) => ({ ...r, updatedAt: clock(count + 1) }));
    deviceMutations.mobile = records.filter((_, i) => i % 5 === 0).map((r) => ({ ...r, updatedAt: clock(count + 2) }));
  }
  return { kind, seed, records, corruptRecordIds, deviceMutations };
}
