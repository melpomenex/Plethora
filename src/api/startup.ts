import { invokeCommand, isTauri } from "../lib/tauri";
import { mapDocuments } from "./documents";
import { convertQueueItem, type RustQueueItem } from "./queue";
import {
  STARTUP_DATA_VERSION,
  STARTUP_DOCUMENT_LIMIT,
  STARTUP_PROGRESS_LIMIT,
  STARTUP_RESPONSE_BYTE_BUDGET,
  STARTUP_QUEUE_LIMIT,
  type StartupSnapshot,
  type StartupSurface,
} from "../types/startup";
import type { Document } from "../types/document";
import { markSyncPhaseStart, recordStartupRequest } from "../lib/sync/syncTelemetry";
import { normalizeUnixTimestampMs } from "../utils/relativeTime";

interface StartupPageWire<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
}

interface StartupProgressWire {
  id: string;
  progress: number;
  title: string;
  dateModified: number | null;
  dateAdded?: number | null;
}

interface StartupSnapshotWire {
  version: number;
  collections: StartupSnapshot["collections"];
  activeCollectionId: string;
  documents: StartupPageWire<Document>;
  queue: StartupPageWire<RustQueueItem>;
  continueReading: StartupProgressWire[];
  dueCount: number;
}

function bytesOf(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return 0;
  }
}

/** Fetch the versioned, bounded first-render dataset for one visible surface. */
export async function getStartupSnapshot(options: {
  surface?: StartupSurface;
  includeQueue?: boolean;
  documentOffset?: number;
  queueMode?: "due-today" | "due-all";
} = {}): Promise<StartupSnapshot> {
  const surface = options.surface ?? "dashboard";
  const endPhase = markSyncPhaseStart("startup-command");
  recordStartupRequest("get_startup_snapshot");
  const args = {
    includeQueue: options.includeQueue ?? surface === "queue",
    documentLimit: STARTUP_DOCUMENT_LIMIT,
    documentOffset: options.documentOffset ?? 0,
    queueLimit: STARTUP_QUEUE_LIMIT,
    queueMode: options.queueMode,
    progressLimit: STARTUP_PROGRESS_LIMIT,
  };
  try {
    const raw = isTauri()
      ? await invokeCommand<StartupSnapshotWire>("get_startup_snapshot", args)
      : await (await import("../lib/browser-backend")).browserInvoke<StartupSnapshotWire>("get_startup_snapshot", args);

  if (raw.version !== STARTUP_DATA_VERSION) {
    throw new Error(`Unsupported startup data version: ${raw.version}`);
  }

  const documents = mapDocuments(raw.documents?.items ?? []);
  const queue = (raw.queue?.items ?? []).map(convertQueueItem);
  const snapshot: StartupSnapshot = {
    version: raw.version,
    collections: raw.collections ?? [],
    activeCollectionId: raw.activeCollectionId,
    documents: {
      items: documents,
      total: raw.documents?.total ?? documents.length,
      hasMore: Boolean(raw.documents?.hasMore),
      nextOffset: raw.documents?.nextOffset ?? null,
    },
    queue: {
      items: queue,
      total: raw.queue?.total ?? queue.length,
      hasMore: Boolean(raw.queue?.hasMore),
      nextOffset: raw.queue?.nextOffset ?? null,
    },
    continueReading: (raw.continueReading ?? []).map((item) => ({
      id: item.id,
      progress: item.progress,
      title: item.title,
      date_modified: normalizeUnixTimestampMs(item.dateModified),
      date_added: normalizeUnixTimestampMs(item.dateAdded),
    })),
    dueCount: raw.dueCount ?? 0,
  };

    // Keep the response-size budget observable without retaining the payload.
    const bytes = bytesOf(raw);
    endPhase({
      bytes,
      records: documents.length + queue.length,
      hasMore: snapshot.documents.hasMore || snapshot.queue.hasMore,
      request: "get_startup_snapshot",
      surface,
    });
    if (bytes > STARTUP_RESPONSE_BYTE_BUDGET) {
      console.warn(`[startup] snapshot exceeded 256 KiB (${bytes} bytes)`);
    }
    return snapshot;
  } catch (error) {
    endPhase({ request: "get_startup_snapshot", surface });
    throw error;
  }
}
