import type { VideoExtract, VideoExtractReviewReceipt, VideoExtractReviewResult, VideoExtractLifecycleArchive, VideoExtractQueueStatus } from '../api/video-extracts';
import { DEFAULT_FSRS7_PARAMETERS, nextStatesWithElapsedDays } from '../algorithms/fsrs7';
import { DEFAULT_COLLECTION_ID } from '../types/collection';
import { openDatabase } from './database';
import { isVideoExtractQueueEligible, resolveVideoExtractQueueIntent } from './videoExtractLifecycle';

const EXTRACTS = 'video_extracts';
const EVENTS = 'video_extract_review_events';
const DOCUMENTS = 'documents';

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('IndexedDB request failed'));
  });
}

function readAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return request(db.transaction(store, 'readonly').objectStore(store).getAll()) as Promise<T[]>;
}

function normalizeQueueStatus(value: unknown, nextReviewDate: unknown): VideoExtractQueueStatus {
  if (value === 'queued' || value === 'not_queued') return value;
  return nextReviewDate ? 'queued' : 'not_queued';
}

function normalizeExtract(
  raw: Record<string, unknown>,
  parent?: { collection_id?: string } | null,
): VideoExtract {
  const nextReviewDate = raw.next_review_date as string | undefined;
  return {
    ...(raw as unknown as VideoExtract),
    queue_status: normalizeQueueStatus(raw.queue_status, nextReviewDate),
    collection_id:
      (raw.collection_id as string | undefined) ||
      parent?.collection_id ||
      DEFAULT_COLLECTION_ID,
  };
}

function isDefaultCollection(cid: string | undefined): boolean {
  return !cid || cid === DEFAULT_COLLECTION_ID || cid === 'default';
}

function collectionMatches(cid: string | undefined, rowCollection: string | undefined): boolean {
  if (!cid) return true;
  if (isDefaultCollection(cid)) {
    return isDefaultCollection(rowCollection);
  }
  return rowCollection === cid;
}

function parentActive(parent: { is_archived?: boolean; is_dismissed?: boolean } | undefined): boolean {
  return Boolean(parent) && !parent!.is_archived && !parent!.is_dismissed;
}

/** All saved extracts for a document (no eligibility filter), normalized. */
export async function listBrowserVideoExtractsForDocument(documentId: string): Promise<VideoExtract[]> {
  const database = await openDatabase();
  const [rows, documents] = await Promise.all([
    readAll<Record<string, unknown>>(database, EXTRACTS),
    readAll<Record<string, unknown>>(database, DOCUMENTS),
  ]);
  const parents = new Map(documents.map((doc) => [String(doc.id), doc]));
  return rows
    .filter((row) => String(row.document_id) === documentId)
    .map((row) => normalizeExtract(row, parents.get(String(row.document_id))))
    .filter((row) => Boolean(parents.get(row.document_id)))
    .sort((a, b) => a.start_time - b.start_time);
}

/** Library-wide saved extracts in a collection, independent of queue state. */
export async function listAllBrowserVideoExtracts(collectionId?: string): Promise<VideoExtract[]> {
  const database = await openDatabase();
  const [rows, documents] = await Promise.all([
    readAll<Record<string, unknown>>(database, EXTRACTS),
    readAll<Record<string, unknown>>(database, DOCUMENTS),
  ]);
  const parents = new Map(documents.map((doc) => [String(doc.id), doc]));
  return rows
    .map((row) => normalizeExtract(row, parents.get(String(row.document_id))))
    .filter((row) => {
      const parent = parents.get(row.document_id) as { _deleted?: boolean } | undefined;
      return Boolean(parent) && !parent!._deleted && collectionMatches(collectionId, row.collection_id);
    })
    .sort((a, b) => Date.parse(b.date_created) - Date.parse(a.date_created));
}

/** Canonical queue candidates at an explicit cutoff. */
export async function listBrowserVideoExtractCandidates(
  documentId?: string,
  cutoff: Date = new Date(),
  collectionId?: string,
): Promise<VideoExtract[]> {
  const database = await openDatabase();
  const [rows, documents] = await Promise.all([
    readAll<Record<string, unknown>>(database, EXTRACTS),
    readAll<Record<string, unknown>>(database, DOCUMENTS),
  ]);
  const parents = new Map(documents.map((doc) => [String(doc.id), doc]));
  return rows
    .map((row) => normalizeExtract(row, parents.get(String(row.document_id))))
    .filter((row) => {
      if (documentId && row.document_id !== documentId) return false;
      if (!collectionMatches(collectionId, row.collection_id)) return false;
      if (!parentActive(parents.get(row.document_id) as { is_archived?: boolean; is_dismissed?: boolean } | undefined)) return false;
      return isVideoExtractQueueEligible(row, cutoff);
    })
    .sort((a, b) => Date.parse(a.next_review_date ?? '9999-12-31') - Date.parse(b.next_review_date ?? '9999-12-31'));
}

export function validateVideoLifecycleArchive(archive: VideoExtractLifecycleArchive, documentIds?: ReadonlySet<string>): void {
  if (!archive || !Array.isArray(archive.extracts) || !Array.isArray(archive.reviewReceipts)) throw new Error('Invalid video lifecycle archive');
  const extractIds = new Set<string>();
  for (const extract of archive.extracts) {
    if (typeof extract.id !== 'string' || extractIds.has(extract.id) || typeof extract.document_id !== 'string' ||
        (documentIds && !documentIds.has(extract.document_id))) throw new Error('Archived video source is missing or duplicated');
    extractIds.add(extract.id);
  }
  const operations = new Set<string>();
  for (const receipt of archive.reviewReceipts) {
    if (receipt.before?.id !== receipt.extract_id || receipt.after?.id !== receipt.extract_id ||
        receipt.before?.document_id !== receipt.document_id || receipt.after?.document_id !== receipt.document_id ||
        !Number.isInteger(receipt.rating) || receipt.rating < 1 || receipt.rating > 4 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receipt.operation_id) ||
        operations.has(receipt.operation_id)) throw new Error('Invalid archived video review receipt');
    operations.add(receipt.operation_id);
  }
}

function scheduleReview(before: VideoExtract, rating: number, operationId: string): VideoExtractReviewReceipt {
  const now = new Date();
  const elapsed = Math.max(0, (now.getTime() - Date.parse(before.last_review_date ?? before.date_created)) / 86400000);
  const memory = before.memory_state;
  const states = nextStatesWithElapsedDays(
    DEFAULT_FSRS7_PARAMETERS, memory ? { ...memory, stability_fast: 0 } : null, elapsed,
    { desiredRetention: 0.9, maximumInterval: 3650 },
  );
  const state = [states.again, states.hard, states.good, states.easy][rating - 1];
  const interval = Math.round(Math.min(3650, Math.max(1, state.interval)));
  const after: VideoExtract = {
    ...before, memory_state: { stability: state.memory.stability, difficulty: state.memory.difficulty },
    next_review_date: new Date(now.getTime() + interval * 86400000).toISOString(),
    last_review_date: now.toISOString(), date_modified: now.toISOString(),
    review_count: before.review_count + 1, reps: before.reps + 1,
  };
  return { operation_id: operationId, extract_id: before.id, document_id: before.document_id,
    rating, reviewed_at: now.toISOString(), before, after };
}

function normalizeRequestedDate(value: unknown, now: Date): string | undefined {
  if (!value) return undefined;
  const requested = new Date(String(value));
  if (Number.isNaN(requested.getTime())) throw new Error('Enter a valid review date');
  const requestedDay = requested.toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  if (requestedDay < today) throw new Error('The review date cannot be in the past');
  return requestedDay === today ? now.toISOString() : `${requestedDay}T00:00:00.000Z`;
}

/** Request callbacks stay inside one IDB transaction; only completion resolves. */
export async function browserVideoExtractCommand(command: string, args: Record<string, unknown>): Promise<unknown> {
  if (command === 'get_video_extracts') {
    return listBrowserVideoExtractsForDocument(String(args.documentId));
  }
  if (command === 'get_all_video_extracts') {
    return listAllBrowserVideoExtracts(args.collectionId as string | undefined);
  }
  if (command === 'get_video_extract_review_candidates') {
    const cutoff = args.now ? new Date(String(args.now)) : new Date();
    return listBrowserVideoExtractCandidates(
      args.documentId as string | undefined,
      Number.isNaN(cutoff.getTime()) ? new Date() : cutoff,
      args.collectionId as string | undefined,
    );
  }

  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction([EXTRACTS, EVENTS, DOCUMENTS], 'readwrite');
    const store = tx.objectStore(EXTRACTS);
    const events = tx.objectStore(EVENTS);
    let result: unknown;
    let failure: unknown;
    const fail = (message: string) => { failure = new Error(message); tx.abort(); };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Could not save video extract'));
    tx.onerror = () => { failure ??= tx.error; };

    if (command === 'get_video_extract_lifecycle') {
      const ids = Array.isArray(args.documentIds) ? new Set(args.documentIds as string[]) : null;
      const archive: VideoExtractLifecycleArchive = { formatVersion: 2, extracts: [], reviewReceipts: [] };
      result = archive;
      const allExtracts = store.getAll();
      allExtracts.onsuccess = () => {
        const docs = tx.objectStore(DOCUMENTS).getAll();
        docs.onsuccess = () => {
          const parents = new Map((docs.result as Array<Record<string, unknown>>).map((doc) => [String(doc.id), doc]));
          archive.extracts = (allExtracts.result as Array<Record<string, unknown>>)
            .map((row) => normalizeExtract(row, parents.get(String(row.document_id))))
            .filter((e) => !ids || ids.has(e.document_id));
        };
      };
      const allReceipts = events.getAll();
      allReceipts.onsuccess = () => { archive.reviewReceipts = (allReceipts.result as VideoExtractReviewReceipt[]).filter((e) => !ids || ids.has(e.document_id)); };
      return;
    }
    if (command === 'restore_video_extract_lifecycle') {
      const archive = args.archive as VideoExtractLifecycleArchive;
      try { validateVideoLifecycleArchive(archive); }
      catch (error) { return fail(error instanceof Error ? error.message : 'Invalid video lifecycle archive'); }
      const legacy = (archive.formatVersion ?? 0) < 2;
      store.clear();
      events.clear();
      const docs = tx.objectStore(DOCUMENTS);
      for (const extract of archive.extracts) {
        const parent = docs.get(extract.document_id);
        parent.onsuccess = () => {
          if (!parent.result || (parent.result as { _deleted?: boolean })._deleted) return fail('Archived source video is missing');
          const restored = normalizeExtract(extract as unknown as Record<string, unknown>, parent.result as { collection_id?: string });
          if (legacy) restored.queue_status = restored.next_review_date ? 'queued' : 'not_queued';
          store.add(restored);
        };
      }
      for (const receipt of archive.reviewReceipts) {
        events.add(receipt);
      }
      return;
    }
    if (command === 'create_video_extract') {
      const parent = tx.objectStore(DOCUMENTS).get(String(args.documentId));
      parent.onsuccess = () => {
        const start = Number(args.startTime);
        const end = Number(args.endTime);
        const title = typeof args.title === 'string' ? args.title.trim() : '';
        if (!parent.result || (parent.result as { _deleted?: boolean })._deleted) return fail('Source video no longer exists');
        const fileType = String((parent.result as { file_type?: string }).file_type ?? '').toLowerCase();
        if (fileType !== 'video' && fileType !== 'youtube') return fail('Video extracts require a video or YouTube source');
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 600) return fail('Enter a valid segment of up to 10 minutes');
        if (!title) return fail('Enter a title and a valid segment of up to 10 minutes');
        let intent;
        try {
          intent = resolveVideoExtractQueueIntent({
            addToQueue: args.addToQueue === true,
            initialReviewDate: args.initialReviewDate as string | undefined,
          });
        } catch (error) {
          return fail(error instanceof Error ? error.message : 'Invalid review date');
        }
        const now = new Date().toISOString();
        const extract: VideoExtract = {
          id: crypto.randomUUID(), document_id: String(args.documentId),
          collection_id: (parent.result as { collection_id?: string }).collection_id || DEFAULT_COLLECTION_ID,
          queue_status: intent.queue_status,
          start_time: start, end_time: end,
          title, transcript_text: args.transcriptText as string | undefined,
          notes: args.notes as string | undefined, tags: (args.tags as string[] | undefined) ?? [],
          next_review_date: intent.next_review_date,
          first_seen_at: null, last_seen_at: null, review_count: 0, reps: 0, date_created: now, date_modified: now,
        };
        store.add(extract);
        result = extract;
      };
      return;
    }
    const read = store.get(String(args.extractId));
    read.onsuccess = () => {
      const extract = (read.result as VideoExtract | undefined) ?? null;
      if (command === 'get_video_extract') {
        if (!extract) { result = null; return; }
        const parent = tx.objectStore(DOCUMENTS).get(extract.document_id);
        parent.onsuccess = () => { result = normalizeExtract(extract as unknown as Record<string, unknown>, parent.result as { collection_id?: string }); };
        return;
      }
      if (command === 'delete_video_extract') { store.delete(String(args.extractId)); return; }
      if (command === 'rate_video_extract') {
        const rating = Number(args.rating);
        const operationId = String(args.operationId ?? '');
        if (!Number.isInteger(rating) || rating < 1 || rating > 4 ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) {
          return fail('A rating from 1 to 4 and a valid operation ID are required');
        }
        const prior = events.get(operationId);
        prior.onsuccess = () => {
          let receipt = prior.result as VideoExtractReviewReceipt | undefined;
          if (receipt && (receipt.extract_id !== args.extractId || receipt.rating !== rating)) {
            return fail('This rating operation was already used for a different review');
          }
          if (!receipt) {
            if (!extract) return fail('Video extract no longer exists');
            try { receipt = scheduleReview(normalizeExtract(extract as unknown as Record<string, unknown>), rating, operationId); }
            catch { return fail('Could not schedule this extract review'); }
            events.add(receipt);
            store.put(receipt.after);
            result = { extract: receipt.after, receipt } satisfies VideoExtractReviewResult;
          } else {
            result = {
              extract: extract ? normalizeExtract(extract as unknown as Record<string, unknown>) : null,
              receipt,
            } satisfies VideoExtractReviewResult;
          }
        };
        return;
      }
      if (!extract) return fail('Video extract no longer exists');
      const now = new Date();
      const nowIso = now.toISOString();
      let updated: VideoExtract;
      if (command === 'mark_video_extract_seen') {
        updated = { ...extract, first_seen_at: extract.first_seen_at ?? nowIso, last_seen_at: nowIso, date_modified: nowIso };
      } else if (command === 'update_video_extract') {
        updated = { ...extract, title: (args.title as string | undefined) ?? extract.title,
          notes: (args.notes as string | undefined) ?? extract.notes,
          tags: (args.tags as string[] | undefined) ?? extract.tags, date_modified: nowIso };
      } else if (command === 'set_video_extract_queue_membership') {
        const queued = args.queued === true;
        if (!queued && args.initialReviewDate) return fail('A review date cannot be supplied when removing from the queue');
        let nextReviewDate = extract.next_review_date;
        let queueStatus: VideoExtractQueueStatus = queued ? 'queued' : 'not_queued';
        if (queued) {
          if (args.initialReviewDate) {
            try { nextReviewDate = normalizeRequestedDate(args.initialReviewDate, now); }
            catch (error) { return fail(error instanceof Error ? error.message : 'Invalid review date'); }
          } else if (extract.next_review_date) {
            nextReviewDate = extract.next_review_date;
          } else if (extract.review_count > 0) {
            nextReviewDate = nowIso;
          } else {
            nextReviewDate = undefined;
          }
        }
        updated = { ...extract, queue_status: queueStatus, next_review_date: nextReviewDate, date_modified: nowIso };
      } else if (command === 'postpone_video_extract') {
        if (normalizeQueueStatus(extract.queue_status, extract.next_review_date) !== 'queued') {
          return fail('Add this extract to the queue before postponing it');
        }
        const days = Math.max(0, Number(args.days) || 0);
        const base = extract.next_review_date ? new Date(extract.next_review_date) : now;
        updated = {
          ...extract,
          next_review_date: new Date(base.getTime() + days * 86400000).toISOString(),
          date_modified: nowIso,
        };
      } else {
        return fail('Unsupported video extract operation');
      }
      store.put(updated);
      result = updated;
    };
  });
}
