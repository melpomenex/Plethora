import type { SyncLane } from "./progressiveScheduler";

export type SyncClassification = "user-state" | "intent" | "metadata" | "derived" | "secret" | "device-local";
export type SyncDeletion = "tombstone" | "append-only" | "local-only";
export type SyncConflict = "row-lww" | "field-lww" | "append-only" | "session-progress" | "deterministic-order" | "none";

export interface SyncPolicyDescriptor {
  domain: string;
  classification: SyncClassification;
  lane: SyncLane;
  shard: "control" | "hash-bucket" | "epoch" | "recency" | "local";
  maxRecordBytes: number;
  conflict: SyncConflict;
  deletion: SyncDeletion;
  schemaVersion: number;
  rationale: string;
  /** Named adapter hooks are required even before the durable journal lands. */
  hooks: { exportLocal: string; applyRemote: string; audit: string };
}

const adapters = new Map<string, () => Promise<void>>();

export function registerSyncAdapter(domain: string, ensureReady: () => Promise<void>): () => void {
  assertSyncPolicyCoverage([domain]);
  adapters.set(domain, ensureReady);
  return () => {
    if (adapters.get(domain) === ensureReady) adapters.delete(domain);
  };
}

export function listRegisteredSyncAdapters(): string[] {
  return Array.from(adapters.keys()).sort();
}

const registry = new Map<string, SyncPolicyDescriptor>();

export function registerSyncPolicy(policy: SyncPolicyDescriptor): void {
  if (!policy.domain || policy.maxRecordBytes <= 0 || !policy.rationale ||
    !policy.hooks?.exportLocal || !policy.hooks?.applyRemote || !policy.hooks?.audit) {
    throw new Error(`Invalid sync policy: ${policy.domain || "unknown"}`);
  }
  const existing = registry.get(policy.domain);
  if (existing && existing.schemaVersion > policy.schemaVersion) {
    throw new Error(`Cannot register older sync policy for ${policy.domain}`);
  }
  registry.set(policy.domain, policy);
}

export function getSyncPolicy(domain: string): SyncPolicyDescriptor | undefined {
  return registry.get(domain);
}

export function listSyncPolicies(): SyncPolicyDescriptor[] {
  return Array.from(registry.values()).sort((a, b) => a.domain.localeCompare(b.domain));
}

export function assertSyncPolicyCoverage(domains: string[]): void {
  const missing = domains.filter((domain) => !registry.has(domain));
  if (missing.length > 0) throw new Error(`Unregistered sync domains: ${missing.join(", ")}`);
}

export function clearSyncPolicyRegistryForTest(): void {
  registry.clear();
}

// Baseline declarations for the adapters already shipped in this repository.
// Entity modules can replace these descriptors with executable adapters as the
// journal/shard rollout proceeds; this registry prevents silent omissions now.
const BASELINE_POLICIES: SyncPolicyDescriptor[] = [
  ["collections", "user-state", "P1", "hash-bucket", "row-lww", "tombstone", "Collection metadata and ordering are user-owned library state."],
  ["documents", "user-state", "P1", "hash-bucket", "row-lww", "tombstone", "Document identity and source metadata recreate the library on another device."],
  ["extracts", "user-state", "P1", "hash-bucket", "row-lww", "tombstone", "Highlights and annotations are user-created knowledge."],
  ["learningItems", "user-state", "P0", "hash-bucket", "row-lww", "tombstone", "Flashcards and their schedule are core learning state."],
  ["reviews", "user-state", "P0", "epoch", "append-only", "append-only", "Review events are immutable and must merge without duplication."],
  ["rssFeeds", "user-state", "P1", "hash-bucket", "row-lww", "tombstone", "Feed subscriptions are cross-device library state."],
  ["rssArticlesState", "user-state", "P0", "recency", "field-lww", "tombstone", "Read and queued transitions control what users are fed next."],
  ["podcastFeeds", "user-state", "P1", "hash-bucket", "row-lww", "tombstone", "Podcast subscriptions are cross-device library state."],
  ["podcastEpisodes", "user-state", "P0", "recency", "field-lww", "tombstone", "Played and playback position state follows the listener."],
  ["conversations", "user-state", "P1", "hash-bucket", "row-lww", "tombstone", "Saved assistant conversations are user-authored content."],
  ["fileManifest", "intent", "P2", "hash-bucket", "row-lww", "tombstone", "Availability intent syncs; downloaded bytes remain local/file-service data."],
  ["safePreferences", "user-state", "P1", "control", "field-lww", "tombstone", "Device-neutral preferences recreate the user's product experience."],
  ["derivedIndexes", "derived", "P3", "local", "none", "local-only", "Search and vector indexes are regenerated from synced source state."],
  ["secrets", "secret", "P3", "local", "none", "local-only", "Credentials and encryption material never enter shared state."],
  ["devicePreferences", "device-local", "P3", "local", "none", "local-only", "Window, hardware, path, and transient UI state is device-specific."],
  ["bookmarks", "user-state", "P1", "hash-bucket", "row-lww", "tombstone", "Reader bookmarks are explicit cross-device navigation state."],
  ["readerSessions", "metadata", "P2", "epoch", "session-progress", "append-only", "Completed reading sessions support cross-device continuity and analytics."],
  ["readingPositions", "user-state", "P0", "recency", "session-progress", "tombstone", "Current reading position lets a user continue on another device."],
  ["rssAnnotations", "user-state", "P1", "hash-bucket", "row-lww", "tombstone", "RSS highlights and notes are user-authored content."],
  ["mediaPositions", "user-state", "P0", "recency", "session-progress", "tombstone", "Playback progress follows the user across devices."],
  ["fileAvailabilityIntent", "intent", "P2", "hash-bucket", "row-lww", "tombstone", "Download intent recreates offline availability without syncing bytes."],
  ["importProvenance", "metadata", "P2", "hash-bucket", "row-lww", "tombstone", "Import provenance prevents duplicate cross-device imports."],
].map(([domain, classification, lane, shard, conflict, deletion, rationale]) => ({
  domain,
  classification: classification as SyncClassification,
  lane: lane as SyncLane,
  shard: shard as SyncPolicyDescriptor["shard"],
  maxRecordBytes: 256 * 1024,
  conflict: conflict as SyncConflict,
  deletion: deletion as SyncDeletion,
  schemaVersion: 1,
  rationale,
  hooks: {
    exportLocal: `${domain}.exportLocal`,
    applyRemote: `${domain}.applyRemote`,
    audit: `${domain}.audit`,
  },
}));

for (const policy of BASELINE_POLICIES) registerSyncPolicy(policy);
