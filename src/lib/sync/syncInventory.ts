import { listSyncPolicies } from "./coverageRegistry";

export interface SyncInventoryEntry {
  domain: string;
  source: "frontend-store" | "localStorage" | "sqlite" | "file-manifest" | "settings";
  classification: string;
  rationale: string;
}

const SOURCE_BY_DOMAIN: Record<string, SyncInventoryEntry["source"]> = {
  collections: "sqlite", documents: "sqlite", extracts: "sqlite", learningItems: "sqlite", reviews: "sqlite",
  rssFeeds: "sqlite", rssArticlesState: "sqlite", podcastFeeds: "sqlite", podcastEpisodes: "sqlite",
  conversations: "localStorage", fileManifest: "file-manifest", fileAvailabilityIntent: "file-manifest", safePreferences: "settings",
  derivedIndexes: "frontend-store", secrets: "settings", devicePreferences: "frontend-store",
};

export function buildSyncInventory(): SyncInventoryEntry[] {
  return listSyncPolicies().map((policy) => ({
    domain: policy.domain,
    source: SOURCE_BY_DOMAIN[policy.domain] ?? "frontend-store",
    classification: policy.classification,
    rationale: policy.rationale,
  }));
}
