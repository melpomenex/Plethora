/**
 * External evidence snapshots (web-research 2.1).
 *
 * Accepted snapshots store canonical URL, publisher, fetch time, revision hash,
 * locator and a bounded excerpt. Candidates (fetched) are distinct from accepted
 * snapshots and from verified support. Link/revision changes require explicit
 * revalidation for new use while historical snapshots stay preserved; missing
 * sources disable navigation but never delete the snapshot.
 */

export type SnapshotStatus = 'candidate' | 'accepted';

export type LocatorKind = 'page' | 'timestamp' | 'section';

export interface SnapshotLocator {
  kind: LocatorKind;
  value: string;
}

export interface ExternalSnapshot {
  id: string;
  url: string;
  publisher: string;
  fetchedAt: string; // RFC 3339
  revisionHash: string;
  locator: SnapshotLocator;
  excerpt: string;
  status: SnapshotStatus;
}

export interface SnapshotInput {
  url: string;
  publisher: string;
  fetchedAt: string;
  revisionHash: string;
  locator: SnapshotLocator;
  excerpt: string;
}

const STORAGE_KEY = 'plethora.external_snapshots.v1';

function load(): ExternalSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ExternalSnapshot[]) : [];
  } catch {
    return [];
  }
}

function save(snapshots: ExternalSnapshot[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
}

function makeId(): string {
  return `esd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createSnapshot(input: SnapshotInput, id = makeId()): ExternalSnapshot {
  return { id, status: 'candidate', ...input };
}

export function storeSnapshot(snapshot: ExternalSnapshot): ExternalSnapshot[] {
  const all = load().filter((s) => s.id !== snapshot.id);
  all.push(snapshot);
  save(all);
  return all;
}

export function listSnapshots(status?: SnapshotStatus): ExternalSnapshot[] {
  const all = load();
  return status ? all.filter((s) => s.status === status) : all;
}

export function getSnapshot(id: string): ExternalSnapshot | null {
  return load().find((s) => s.id === id) ?? null;
}

export function acceptSnapshot(id: string): ExternalSnapshot | null {
  const all = load();
  const idx = all.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  all[idx] = { ...all[idx], status: 'accepted' };
  save(all);
  return all[idx];
}

export interface NavigationDescriptor {
  source: 'pinned-excerpt' | 'live-page';
  url?: string;
  locator?: SnapshotLocator;
  excerpt?: string;
}

export function resolveNavigation(snapshot: ExternalSnapshot): NavigationDescriptor {
  return {
    source: 'pinned-excerpt',
    locator: snapshot.locator,
    excerpt: snapshot.excerpt,
    url: snapshot.url,
  };
}

export function livePageNavigation(snapshot: ExternalSnapshot): NavigationDescriptor {
  return { source: 'live-page', url: snapshot.url };
}

export interface RevalidationStatus {
  snapshotId: string;
  current: boolean;
  changed: boolean;
  messageKey: string;
}

/** Compare a live revision to the pinned one; historical snapshots never change. */
export function checkRevalidation(snapshot: ExternalSnapshot, liveRevisionHash: string): RevalidationStatus {
  if (snapshot.revisionHash === liveRevisionHash) {
    return { snapshotId: snapshot.id, current: true, changed: false, messageKey: 'research.snapshot.current' };
  }
  return { snapshotId: snapshot.id, current: false, changed: true, messageKey: 'research.snapshot.changed_requires_revalidation' };
}
