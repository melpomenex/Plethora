/** Durable snapshots are read and written through the native Study Plan API. */

export type SnapshotStatus = 'candidate' | 'accepted' | 'stale';
export type LocatorKind = 'page' | 'timestamp' | 'section';

export interface SnapshotLocator {
  kind: LocatorKind;
  value: string;
}

export interface ExternalSnapshot {
  id: string;
  planId: string;
  planVersionId: string;
  query: string;
  url: string;
  title: string;
  publisher: string;
  fetchedAt: string;
  revisionHash: string;
  locator: SnapshotLocator;
  excerpt: string;
  status: SnapshotStatus;
}

export interface NavigationDescriptor {
  source: 'pinned-excerpt' | 'live-page';
  url: string;
  locator: SnapshotLocator;
  excerpt?: string;
}

/** Open the exact saved evidence first; the link is provided for page context. */
export function resolveNavigation(snapshot: ExternalSnapshot): NavigationDescriptor {
  return {
    source: 'pinned-excerpt',
    locator: snapshot.locator,
    excerpt: snapshot.excerpt,
    url: snapshot.url,
  };
}

export function livePageNavigation(snapshot: ExternalSnapshot): NavigationDescriptor {
  return { source: 'live-page', url: snapshot.url, locator: snapshot.locator };
}

export interface RevalidationStatus {
  snapshotId: string;
  current: boolean;
  changed: boolean;
  messageKey: string;
}

/** Compare a newly captured revision with a pinned historical snapshot. */
export function checkRevalidation(snapshot: ExternalSnapshot, liveRevisionHash: string): RevalidationStatus {
  if (snapshot.revisionHash === liveRevisionHash) {
    return { snapshotId: snapshot.id, current: true, changed: false, messageKey: 'research.snapshot.current' };
  }
  return { snapshotId: snapshot.id, current: false, changed: true, messageKey: 'research.snapshot.changed_requires_revalidation' };
}
