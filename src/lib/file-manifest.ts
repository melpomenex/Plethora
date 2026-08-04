/**
 * File Manifest Sync - Manages file metadata across devices via Yjs
 *
 * Files are NOT stored on the server - they are streamed in real-time
 * between devices that are online simultaneously.
 */

import * as Y from "yjs";
import { getSyncFeatureFlags } from "./sync/featureFlags";
import { enqueueSyncOperation } from "./sync/syncJournal";
import { registerDomainHandler } from "./sync/deltaLog/domainRegistry";
import { isYjsPublishSuppressed } from "./sync/deltaLog/yjsPublishGate";
import { getDeviceIdSync, nowHLC } from "./sync/syncClock";
import { reportCursor, head as fetchHead, type DeltaLogClientConfig } from "./sync/deltaLog/client";
import { encodePresenceBlob, decodePresenceBlob } from "./sync/deltaLog/presence";
import type { SubKeys } from "./sync/encryption";
import { invokeCommand, isTauri } from "./tauri";
import { getSyncRoomId } from "./yjsSync";

/**
 * Metadata for a file in the sync manifest
 */
export interface FileManifestEntry {
  /** Unique file ID (UUID) */
  id: string;
  /** Sync room ID */
  room: string;
  /** Original filename */
  filename: string;
  /** MIME type */
  contentType: string;
  /** File size in bytes */
  sizeBytes: number;
  /** SHA-256 hash of file content for integrity */
  contentHash: string;
  /** ISO timestamp when file was uploaded */
  uploadedAt: string;
  /** Device ID that uploaded the file */
  uploadedBy: string;
}

/**
 * Device presence info - tracks which devices have which files locally
 */
export interface DevicePresence {
  /** Device ID */
  deviceId: string;
  /** Timestamp of last presence update */
  lastSeen: string;
  /** Set of file IDs this device has locally */
  hasFiles: string[];
}

/**
 * Events emitted by FileManifest
 */
export type FileManifestEvent =
  | { type: "file-added"; entry: FileManifestEntry; sourceDeviceId: string }
  | { type: "file-removed"; fileId: string }
  | { type: "device-online"; deviceId: string; hasFiles: string[] }
  | { type: "device-offline"; deviceId: string }
  | { type: "device-files-updated"; deviceId: string; hasFiles: string[] };

type FileManifestListener = (event: FileManifestEvent) => void;

const DEVICE_ID_KEY = "incrementum_device_id";
const DEVICE_PRESENCE_TTL_MS = 2 * 60 * 1000;

interface DeviceLookupOptions {
  excludeDeviceId?: string;
  includeStale?: boolean;
}

/**
 * Generate a unique device ID
 */
export function getDeviceId(): string {
  if (typeof window === "undefined") {
    return `server-${Date.now()}`;
  }

  // startSyncSubsystems warms the backend-authoritative sync identity before
  // constructing file sync. Reuse it here so every subsystem has one truly
  // per-install identity, and overwrite the legacy file-sync mirror that old
  // localStorage replication may have copied from another device.
  const authoritativeId = getDeviceIdSync();
  if (authoritativeId) {
    localStorage.setItem(DEVICE_ID_KEY, authoritativeId);
    return authoritativeId;
  }

  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    deviceId = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

/**
 * FileManifest manages file metadata synchronization across devices
 */
export class FileManifest {
  private doc: Y.Doc;
  private deviceId: string;
  private listeners: Set<FileManifestListener> = new Set();
  private knownDeviceFiles: Map<string, Set<string>> = new Map();

  // Y.js shared types
  private filesMap: Y.Map<Record<string, unknown>>;
  private devicesMap: Y.Map<Record<string, unknown>>;

  /**
   * Durable in-memory cache of file-manifest entries, hydrated from SQLite
   * (migration 069) on construction and kept in sync by the domain handler +
   * addFile/removeFile. This is what lets reads (getFile/getAllFiles/findByHash)
   * return data without the Yjs document — the Yjs map is now a transport
   * mirror, not the authoritative store. Phase 9 prep: a no-Yjs build hydrates
   * this cache on boot and never touches filesMap.
   */
  private cache: Map<string, FileManifestEntry> = new Map();
  private room: string;

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.deviceId = getDeviceId();
    this.room = getSyncRoomId();

    this.filesMap = doc.getMap("fileManifest") as Y.Map<Record<string, unknown>>;
    this.devicesMap = doc.getMap("devicePresence") as Y.Map<Record<string, unknown>>;

    // Observe changes to files
    this.filesMap.observe((event) => {
      event.changes.keys.forEach((change, key) => {
        if (change.action === "add" || change.action === "update") {
          const entry = this.getFile(key);
          if (entry) {
            this.emit({ type: "file-added", entry, sourceDeviceId: entry.uploadedBy });
          }
        } else if (change.action === "delete") {
          this.emit({ type: "file-removed", fileId: key });
        }
      });
    });

    // Observe changes to device presence
    this.devicesMap.observe((event) => {
      event.changes.keys.forEach((change, key) => {
        if (change.action === "add" || change.action === "update") {
          const presence = this.getDevicePresence(key);
          if (presence) {
            const prevFiles = this.knownDeviceFiles.get(key) || new Set();
            const newFiles = new Set(presence.hasFiles);

            const filesChanged =
              prevFiles.size !== newFiles.size ||
              ![...prevFiles].every((f) => newFiles.has(f));

            if (change.action === "add") {
              this.emit({ type: "device-online", deviceId: key, hasFiles: presence.hasFiles });
            } else if (filesChanged) {
              this.emit({ type: "device-files-updated", deviceId: key, hasFiles: presence.hasFiles });
            }

            this.knownDeviceFiles.set(key, newFiles);
          }
        } else if (change.action === "delete") {
          this.knownDeviceFiles.delete(key);
          this.emit({ type: "device-offline", deviceId: key });
        }
      });
    });

    // Delta-log domain handler: applies a decrypted op for this domain into
    // the cache + SQLite projection (and the Yjs map, when present). This is
    // the apply path the delta-log router dispatches to; it must keep the
    // durable cache in sync so reads work without Yjs.
    registerDomainHandler("fileManifest", async (key, remote) => {
      if (!remote || typeof remote !== "object") return;
      if ((remote as { _deleted?: unknown })._deleted === true) {
        this.cache.delete(key);
        this.filesMap.delete(key);
        if (isTauri()) {
          void invokeCommand("delete_synced_file_manifest", { id: key, room: this.room }).catch(() => undefined);
        }
        return;
      }
      const entry = remote as unknown as FileManifestEntry;
      this.cache.set(key, entry);
      this.filesMap.set(key, remote as Record<string, unknown>);
      if (isTauri()) {
        void invokeCommand("upsert_synced_file_manifest", {
          entry: { id: key, room: this.room, payload: remote },
        }).catch(() => undefined);
      }
    });
  }

  /**
   * The Yjs document this manifest is bound to. Callers (e.g. useFileSync's
   * room-transition staleness check) compare this against the active sync doc to
   * detect that the manifest must be rebuilt after a room switch.
   */
  getDoc(): Y.Doc {
    return this.doc;
  }

  /**
   * Hydrate the in-memory cache from the SQLite projection (migration 069).
   * Call once after construction. Safe to call on every boot — it overwrites
   * the cache with whatever SQLite holds, so a restart picks up the durable
   * state even before any transport delivers a fresh copy. No-op off-Tauri.
   */
  async hydrateFromSqlite(): Promise<void> {
    if (!isTauri()) return;
    try {
      const rows = (await invokeCommand<Record<string, unknown>[]>("get_file_manifest_entries", {
        room: this.room,
      })) ?? [];
      this.cache = new Map();
      for (const row of rows) {
        const id = String(row.id ?? "");
        if (id) this.cache.set(id, row as unknown as FileManifestEntry);
      }
    } catch (err) {
      console.warn("[FileManifest] hydrateFromSqlite failed (non-fatal)", err);
    }
  }

  /**
   * Add a file to the manifest
   */
  addFile(entry: FileManifestEntry): void {
    // Enqueue to the durable outbox first so the delta-log transport receives
    // the entry even when Yjs publishing is suppressed or the map is absent.
    if (getSyncFeatureFlags().journaledProjection || getSyncFeatureFlags().deltaLogSync) {
      void enqueueSyncOperation({
        domain: "fileManifest",
        entityKey: entry.id,
        operation: "upsert",
        payload: entry,
        clock: nowHLC(),
      });
    }
    if (!isYjsPublishSuppressed()) {
      this.doc.transact(() => {
        this.filesMap.set(entry.id, entry as unknown as Record<string, unknown>);
      });
    }
    // Keep the in-memory cache + SQLite projection in sync immediately so
    // reads (getFile/getAllFiles) see the entry before the outbox drains.
    this.cache.set(entry.id, entry);
    if (isTauri()) {
      void invokeCommand("upsert_synced_file_manifest", {
        entry: { id: entry.id, room: this.room, payload: entry },
      }).catch(() => undefined);
    }
  }

  /**
   * Remove a file from the manifest
   */
  removeFile(fileId: string): void {
    if (getSyncFeatureFlags().journaledProjection || getSyncFeatureFlags().deltaLogSync) {
      void enqueueSyncOperation({
        domain: "fileManifest",
        entityKey: fileId,
        operation: "delete",
        payload: null,
        clock: nowHLC(),
      });
    }
    if (!isYjsPublishSuppressed()) {
      this.doc.transact(() => {
        this.filesMap.delete(fileId);
      });
    }
    this.cache.delete(fileId);
    if (isTauri()) {
      void invokeCommand("delete_synced_file_manifest", { id: fileId, room: this.room }).catch(() => undefined);
    }
  }

  /**
   * Get a file entry by ID. Reads from the durable cache first (hydrated from
   * SQLite, kept in sync by the domain handler + addFile/removeFile), then
   * falls back to the Yjs map for entries that arrived over Yjs but haven't
   * been projected yet. Both paths see the same data eventually.
   */
  getFile(fileId: string): FileManifestEntry | null {
    const cached = this.cache.get(fileId);
    if (cached) return cached;
    const data = this.filesMap.get(fileId);
    return data ? (data as unknown as FileManifestEntry) : null;
  }

  /**
   * Get all files in the manifest. Merges the cache with any Yjs-only entries
   * so the union is returned regardless of which transport populated what.
   */
  getAllFiles(): FileManifestEntry[] {
    const files: FileManifestEntry[] = [];
    const seen = new Set<string>();
    for (const entry of this.cache.values()) {
      files.push(entry);
      seen.add(entry.id);
    }
    this.filesMap.forEach((value, key) => {
      if (!seen.has(key)) {
        files.push(value as unknown as FileManifestEntry);
      }
    });
    return files;
  }

  /**
   * Find files by content hash (for duplicate detection)
   */
  findByHash(contentHash: string): FileManifestEntry[] {
    return this.getAllFiles().filter((f) => f.contentHash === contentHash);
  }

  /**
   * Optional delta-log presence source. When set (by the cutover orchestrator
   * or useFileSync once delta-log is active), presence is reported to and read
   * from the delta-log device roster instead of the Yjs devicePresence map —
   * the path that works without Yjs. Until set, the Yjs map remains the source
   * (unchanged behavior).
   */
  private deltaLogPresence: { config: DeltaLogClientConfig; fileKey: SubKeys["fileKey"] } | null = null;

  /**
   * Enable delta-log-backed presence. After this call, updateMyPresence
   * reports to the roster and getOnlineDevices prefers the roster over the
   * Yjs devicePresence map. The pull cursor is read live at report time so
   * the roster always sees the latest position.
   */
  setDeltaLogPresenceSource(
    config: DeltaLogClientConfig,
    fileKey: SubKeys["fileKey"],
  ): void {
    this.deltaLogPresence = { config, fileKey };
  }

  /**
   * Update this device's presence and which files it has. Writes to the Yjs
   * devicePresence map (the legacy path) and, when a delta-log presence
   * source is configured, also reports to the delta-log roster so peers on
   * either transport see this device.
   */
  updateMyPresence(hasFiles: string[]): void {
    const presence: DevicePresence = {
      deviceId: this.deviceId,
      lastSeen: new Date().toISOString(),
      hasFiles,
    };
    if (!isYjsPublishSuppressed()) {
      this.devicesMap.set(this.deviceId, presence as unknown as Record<string, unknown>);
    }
    if (this.deltaLogPresence) {
      const { config, fileKey } = this.deltaLogPresence;
      // Pull cursor is read live so the report stays current; failures are
      // non-fatal (the next presence tick retries).
      void (async () => {
        try {
          const { getRoomCursor } = await import("./sync/deltaLog/checkpoints");
          const cursor = await getRoomCursor();
          await this.reportPresenceViaDeltaLog(config, fileKey, hasFiles, cursor);
        } catch (err) {
          console.warn("[FileManifest] delta-log presence report failed", err);
        }
      })();
    }
  }

  /**
   * Mark this device as offline
   */
  goOffline(): void {
    this.devicesMap.delete(this.deviceId);
  }

  /**
   * Report this device's presence via the delta-log server's device roster
   * (task 5.6) instead of the Yjs devicePresence map. Additive: does not
   * replace updateMyPresence/the Yjs devicesMap — that wiring (deciding
   * which transport is authoritative, and when) belongs to the cutover
   * machinery (Phase 6), not here. `cursor` is this device's current
   * delta-log pull cursor (see deltaLog/checkpoints.ts::getRoomCursor).
   */
  async reportPresenceViaDeltaLog(
    config: DeltaLogClientConfig,
    fileKey: SubKeys["fileKey"],
    hasFiles: string[],
    cursor: number,
  ): Promise<void> {
    const blob = await encodePresenceBlob(
      { deviceId: this.deviceId, hasFiles, lastSeen: new Date().toISOString() },
      fileKey,
    );
    const deviceTag = deviceIdToWireTag(this.deviceId);
    await reportCursor(config, deviceTag, cursor, blob);
  }

  /**
   * Read the delta-log device roster and decode every device's presence
   * blob. Devices that haven't reported one (older client, or sync-only
   * cursor report) or whose blob fails to decrypt are omitted rather than
   * failing the whole read.
   */
  static async getOnlineDevicesViaDeltaLog(
    config: DeltaLogClientConfig,
    fileKey: SubKeys["fileKey"],
  ): Promise<DevicePresence[]> {
    const { devices } = await fetchHead(config);
    const results: DevicePresence[] = [];
    for (const device of devices) {
      if (!device.presenceBlob) continue;
      const decoded = await decodePresenceBlob(device.presenceBlob, fileKey);
      if (!decoded) continue;
      results.push({ deviceId: decoded.deviceId, lastSeen: decoded.lastSeen, hasFiles: decoded.hasFiles });
    }
    return results;
  }

  /**
   * Get presence info for a device
   */
  getDevicePresence(deviceId: string): DevicePresence | null {
    const data = this.devicesMap.get(deviceId);
    return data ? (data as unknown as DevicePresence) : null;
  }

  /**
   * Get all online devices
   */
  getOnlineDevices(options: Pick<DeviceLookupOptions, "includeStale"> = {}): DevicePresence[] {
    const devices: DevicePresence[] = [];
    this.devicesMap.forEach((value) => {
      const presence = value as unknown as DevicePresence;
      if (options.includeStale || this.isPresenceFresh(presence)) {
        devices.push(presence);
      }
    });
    return devices;
  }

  /**
   * Pull the delta-log device roster and merge it into the local devicesMap
   * so getOnlineDevices (and the file-transfer peer discovery that reads it)
   * sees peers that reported via the delta-log presence path. This bridges
   * the roster into the existing synchronous read path without changing any
   * caller's signature — the path that works once Yjs is gone is "call this
   * periodically" (e.g. from the presence tick). No-op when no delta-log
   * presence source is configured.
   */
  async refreshOnlineDevicesFromDeltaLog(): Promise<void> {
    if (!this.deltaLogPresence) return;
    const { config, fileKey } = this.deltaLogPresence;
    try {
      const roster = await FileManifest.getOnlineDevicesViaDeltaLog(config, fileKey);
      for (const presence of roster) {
        this.devicesMap.set(presence.deviceId, presence as unknown as Record<string, unknown>);
      }
    } catch (err) {
      console.warn("[FileManifest] delta-log roster refresh failed", err);
    }
  }

  /**
   * Get this device's ID
   */
  getDeviceId(): string {
    return this.deviceId;
  }

  /**
   * Find devices that have a specific file
   */
  findDevicesWithFile(fileId: string, options: DeviceLookupOptions = {}): DevicePresence[] {
    return this.getOnlineDevices({ includeStale: options.includeStale }).filter((d) => {
      if (options.excludeDeviceId && d.deviceId === options.excludeDeviceId) return false;
      return d.hasFiles.includes(fileId);
    });
  }

  /**
   * Check if a file is available from any online device
   */
  isFileAvailable(fileId: string, options: DeviceLookupOptions = {}): boolean {
    return this.findDevicesWithFile(fileId, options).length > 0;
  }

  subscribe(listener: FileManifestListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: FileManifestEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        console.error("[FileManifest] Listener error:", err);
      }
    });
  }

  private isPresenceFresh(presence: DevicePresence): boolean {
    const lastSeenMs = Date.parse(presence.lastSeen);
    if (!Number.isFinite(lastSeenMs)) return false;
    return Date.now() - lastSeenMs <= DEVICE_PRESENCE_TTL_MS;
  }
}

/**
 * Wire-level device tag for the delta-log device roster. Doesn't need to be
 * secret (it's not a decryption key, just an index into device_cursor rows —
 * the actual presence payload is what's encrypted), but is base64-encoded
 * for consistency with every other identifier on that wire format.
 */
function deviceIdToWireTag(deviceId: string): string {
  return btoa(deviceId);
}

/**
 * Calculate SHA-256 hash of a file
 */
export async function calculateFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
