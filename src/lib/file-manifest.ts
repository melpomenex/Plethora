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
import { nowHLC } from "./sync/syncClock";
import { reportCursor, head as fetchHead, type DeltaLogClientConfig } from "./sync/deltaLog/client";
import { encodePresenceBlob, decodePresenceBlob } from "./sync/deltaLog/presence";
import type { SubKeys } from "./sync/encryption";

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

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.deviceId = getDeviceId();

    this.filesMap = doc.getMap("fileManifest") as Y.Map<Record<string, unknown>>;
    this.devicesMap = doc.getMap("devicePresence") as Y.Map<Record<string, unknown>>;

    // Observe changes to files
    this.filesMap.observe((event) => {
      event.changes.keys.forEach((change, key) => {
        if (change.action === "add") {
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

    // Task 5.6: register so a delta-log-sourced op for this domain applies
    // directly into the same filesMap readers already use (getFile/
    // getAllFiles/findByHash) — no separate SQLite projection exists for
    // file manifest entries, so "apply" here just means "put it in the map",
    // same as what map.observe already does for a Yjs-delivered entry.
    // devicePresence is NOT registered here — see addFile/removeFile and the
    // module-level note on why it stays Yjs-only for now.
    registerDomainHandler("fileManifest", async (key, remote) => {
      if (!remote || typeof remote !== "object") return;
      if ((remote as { _deleted?: unknown })._deleted === true) {
        this.filesMap.delete(key);
        return;
      }
      this.filesMap.set(key, remote as Record<string, unknown>);
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
   * Add a file to the manifest
   */
  addFile(entry: FileManifestEntry): void {
    if (!isYjsPublishSuppressed()) {
      this.doc.transact(() => {
        this.filesMap.set(entry.id, entry as unknown as Record<string, unknown>);
      });
    }
    if (getSyncFeatureFlags().journaledProjection) {
      void enqueueSyncOperation({
        domain: "fileManifest",
        entityKey: entry.id,
        operation: "upsert",
        payload: entry,
        clock: nowHLC(),
      });
    }
  }

  /**
   * Remove a file from the manifest
   */
  removeFile(fileId: string): void {
    if (!isYjsPublishSuppressed()) {
      this.doc.transact(() => {
        this.filesMap.delete(fileId);
      });
    }
    if (getSyncFeatureFlags().journaledProjection) {
      void enqueueSyncOperation({
        domain: "fileManifest",
        entityKey: fileId,
        operation: "delete",
        payload: null,
        clock: nowHLC(),
      });
    }
  }

  /**
   * Get a file entry by ID
   */
  getFile(fileId: string): FileManifestEntry | null {
    const data = this.filesMap.get(fileId);
    return data ? (data as unknown as FileManifestEntry) : null;
  }

  /**
   * Get all files in the manifest
   */
  getAllFiles(): FileManifestEntry[] {
    const files: FileManifestEntry[] = [];
    this.filesMap.forEach((value) => {
      files.push(value as unknown as FileManifestEntry);
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
   * Update this device's presence and which files it has
   */
  updateMyPresence(hasFiles: string[]): void {
    const presence: DevicePresence = {
      deviceId: this.deviceId,
      lastSeen: new Date().toISOString(),
      hasFiles,
    };
    this.devicesMap.set(this.deviceId, presence as unknown as Record<string, unknown>);
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
