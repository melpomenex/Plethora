/**
 * Cross-device intent for files that are about to be read.
 *
 * File bytes stay in the file-transfer layer. This small replicated map only
 * says that a particular device wants a particular document file available for
 * its queue horizon. Keys include the requesting device so one device leaving
 * a queue cannot cancel another device's prefetch. Intents expire and are
 * tombstoned as the horizon moves.
 */

import { createReplicatedMap, type ReplicatedMap } from "./replicatedMap";
import { nowHLC } from "./syncClock";
import { isTauri } from "../tauri";
import { getDeviceId } from "../file-manifest";
import { isTombstone } from "./tombstone";
import type { Document } from "../../types";

export const QUEUE_PREFETCH_HORIZON = 3;
export const FILE_INTENT_TTL_MS = 2 * 60 * 60 * 1000;

export interface SyncedFileAvailabilityIntent {
  id: string;
  fileId: string;
  documentId: string;
  requestedByDevice: string;
  reason: "queue";
  priority: number;
  expiresAt: string;
  updatedAt: string;
}

export type FileAvailabilityIntentListener = (
  intent: SyncedFileAvailabilityIntent,
  active: boolean,
) => void;

let intentsMap: ReplicatedMap<SyncedFileAvailabilityIntent> | null = null;
const listeners = new Set<FileAvailabilityIntentListener>();

function keyFor(deviceId: string, fileId: string): string {
  return `${deviceId}:${fileId}`;
}

function isActive(intent: SyncedFileAvailabilityIntent, at = Date.now()): boolean {
  const expiresAt = Date.parse(intent.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > at;
}

export function selectQueuePrefetchDocuments(
  documents: Document[],
  horizon = QUEUE_PREFETCH_HORIZON,
): Document[] {
  const seen = new Set<string>();
  const selected: Document[] = [];
  for (const doc of documents) {
    if (!doc.fileId || seen.has(doc.fileId)) continue;
    seen.add(doc.fileId);
    selected.push(doc);
    if (selected.length >= Math.max(0, horizon)) break;
  }
  return selected;
}

function getIntentsMap(): ReplicatedMap<SyncedFileAvailabilityIntent> {
  if (!intentsMap) {
    intentsMap = createReplicatedMap<SyncedFileAvailabilityIntent>({
      name: "fileAvailabilityIntent",
      label: "file-availability-intent",
      mode: "row-lww",
      clockField: "updatedAt",
      replayLane: "P2",
      apply: async (_key, row) => {
        const active = isActive(row);
        for (const listener of listeners) {
          try {
            listener(row, active);
          } catch (error) {
            console.warn("[fileAvailabilityIntent] listener failed", error);
          }
        }
      },
      // Intent expiry must never remove a file already stored on a device. We
      // still notify consumers so a pending remote document is not downloaded
      // after its final intent has been tombstoned.
      applyDelete: async (key) => {
        const separator = key.indexOf(":");
        const requestedByDevice = separator >= 0 ? key.slice(0, separator) : "";
        const fileId = separator >= 0 ? key.slice(separator + 1) : key;
        const inactive = {
          id: fileId,
          fileId,
          documentId: "",
          requestedByDevice,
          reason: "queue" as const,
          priority: 0,
          expiresAt: new Date(0).toISOString(),
          updatedAt: nowHLC(),
        };
        for (const listener of listeners) listener(inactive, false);
      },
    });
  }
  return intentsMap;
}

export async function ensureFileAvailabilityIntentReady(): Promise<void> {
  if (!isTauri()) return;
  await getIntentsMap().ensureReady();
}

export function subscribeFileAvailabilityIntent(
  listener: FileAvailabilityIntentListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function publishFileAvailabilityIntent(args: {
  documentId: string;
  fileId: string;
  priority?: number;
  deviceId?: string;
}): Promise<void> {
  if (!isTauri()) return;
  const deviceId = args.deviceId ?? getDeviceId();
  const existing = getIntentsMap().getMap()?.get(keyFor(deviceId, args.fileId));
  const existingActive = existing && !isTombstone(existing) && isActive(existing);
  // Queue rendering can revisit the same horizon frequently. Do not append a
  // new Yjs update while the current lease is still healthy.
  if (existingActive && Date.parse(existing.expiresAt) > Date.now() + FILE_INTENT_TTL_MS / 2) return;

  const updatedAt = nowHLC();
  await getIntentsMap().publish(keyFor(deviceId, args.fileId), {
    id: args.fileId,
    fileId: args.fileId,
    documentId: args.documentId,
    requestedByDevice: deviceId,
    reason: "queue",
    priority: args.priority ?? 0,
    expiresAt: new Date(Date.now() + FILE_INTENT_TTL_MS).toISOString(),
    updatedAt,
  });
}

export async function clearFileAvailabilityIntent(fileId: string, deviceId = getDeviceId()): Promise<void> {
  if (!isTauri()) return;
  await getIntentsMap().delete(keyFor(deviceId, fileId));
}

/**
 * Publish the current device's bounded queue horizon and tombstone old local
 * intents. The list deliberately accepts Documents rather than queue rows so
 * it cannot accidentally publish a source-device path or file bytes.
 */
export async function syncQueueFileAvailabilityIntents(
  documents: Document[],
  options: { horizon?: number; deviceId?: string } = {},
): Promise<void> {
  if (!isTauri()) return;
  await ensureFileAvailabilityIntentReady();
  const deviceId = options.deviceId ?? getDeviceId();
  const horizon = Math.max(0, options.horizon ?? QUEUE_PREFETCH_HORIZON);
  const selected = selectQueuePrefetchDocuments(documents, horizon);
  const wanted = new Set(selected.map((doc) => doc.fileId));

  const map = getIntentsMap().getMap();
  if (!map) return;

  for (const [index, doc] of selected.entries()) {
    if (!doc.fileId || !wanted.has(doc.fileId)) continue;
    await publishFileAvailabilityIntent({
      documentId: doc.id,
      fileId: doc.fileId,
      priority: selected.length - index,
      deviceId,
    });
  }

  const staleFileIds: string[] = [];
  for (const [key, value] of map.entries()) {
    if (!key.startsWith(`${deviceId}:`) || isTombstone(value)) continue;
    const fileId = key.slice(deviceId.length + 1);
    if (!wanted.has(fileId)) staleFileIds.push(fileId);
  }
  for (const fileId of staleFileIds) await clearFileAvailabilityIntent(fileId, deviceId);
}

export async function listActiveFileAvailabilityIntents(
  fileId?: string,
): Promise<SyncedFileAvailabilityIntent[]> {
  if (!isTauri()) return [];
  await ensureFileAvailabilityIntentReady();
  const map = getIntentsMap().getMap();
  if (!map) return [];
  const now = Date.now();
  const result: SyncedFileAvailabilityIntent[] = [];
  for (const value of map.values()) {
    if (isTombstone(value) || !isActive(value, now)) continue;
    if (!fileId || value.fileId === fileId) result.push(value);
  }
  return result;
}

export const __fileAvailabilityIntentTest = {
  keyFor,
  isActive,
  selectQueuePrefetchDocuments,
};
