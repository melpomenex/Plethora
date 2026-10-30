import type { VideoExtract, VideoExtractReviewReceipt, VideoExtractReviewResult, VideoExtractLifecycleArchive } from '../api/video-extracts';
import { DEFAULT_FSRS7_PARAMETERS, nextStatesWithElapsedDays } from '../algorithms/fsrs7';
import { openDatabase } from './database';

const EXTRACTS = 'video_extracts';
const EVENTS = 'video_extract_review_events';

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

/** Request callbacks stay inside one IDB transaction; only completion resolves. */
export async function browserVideoExtractCommand(command: string, args: Record<string, unknown>): Promise<unknown> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction([EXTRACTS, EVENTS, 'documents'], 'readwrite');
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
      const archive: VideoExtractLifecycleArchive = { extracts: [], reviewReceipts: [] };
      result = archive;
      const allExtracts = store.getAll();
      allExtracts.onsuccess = () => { archive.extracts = (allExtracts.result as VideoExtract[]).filter((e) => !ids || ids.has(e.document_id)); };
      const allReceipts = events.getAll();
      allReceipts.onsuccess = () => { archive.reviewReceipts = (allReceipts.result as VideoExtractReviewReceipt[]).filter((e) => !ids || ids.has(e.document_id)); };
      return;
    }
    if (command === 'restore_video_extract_lifecycle') {
      const archive = args.archive as VideoExtractLifecycleArchive;
      try { validateVideoLifecycleArchive(archive); }
      catch (error) { return fail(error instanceof Error ? error.message : 'Invalid video lifecycle archive'); }
      store.clear();
      events.clear();
      for (const extract of archive.extracts) {
        const parent = tx.objectStore('documents').get(extract.document_id);
        parent.onsuccess = () => {
          if (!parent.result || parent.result._deleted) return fail('Archived source video is missing');
          store.add(extract);
        };
      }
      for (const receipt of archive.reviewReceipts) {
        events.add(receipt);
      }
      return;
    }
    if (command === 'get_video_extracts') {
      const read = store.index('by_document').getAll(String(args.documentId));
      read.onsuccess = () => { result = (read.result as VideoExtract[]).sort((a, b) => a.start_time - b.start_time); };
      return;
    }
    if (command === 'create_video_extract') {
      const parent = tx.objectStore('documents').get(String(args.documentId));
      parent.onsuccess = () => {
        const start = Number(args.startTime);
        const end = Number(args.endTime);
        if (!parent.result || parent.result._deleted) return fail('Source video no longer exists');
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 600 ||
            typeof args.title !== 'string' || !args.title.trim()) return fail('Enter a title and a valid segment of up to 10 minutes');
        const now = new Date().toISOString();
        const extract: VideoExtract = {
          id: crypto.randomUUID(), document_id: String(args.documentId), start_time: start, end_time: end,
          title: args.title, transcript_text: args.transcriptText as string | undefined,
          notes: args.notes as string | undefined, tags: (args.tags as string[] | undefined) ?? [],
          next_review_date: args.addToQueue === false ? undefined : now,
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
      if (command === 'get_video_extract') { result = extract; return; }
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
            try { receipt = scheduleReview(extract, rating, operationId); }
            catch { return fail('Could not schedule this extract review'); }
            events.add(receipt);
            store.put(receipt.after);
            result = { extract: receipt.after, receipt } satisfies VideoExtractReviewResult;
          } else {
            result = { extract, receipt } satisfies VideoExtractReviewResult;
          }
        };
        return;
      }
      if (!extract) return fail('Video extract no longer exists');
      const now = new Date().toISOString();
      let updated: VideoExtract;
      if (command === 'mark_video_extract_seen') {
        updated = { ...extract, first_seen_at: extract.first_seen_at ?? now, last_seen_at: now, date_modified: now };
      } else if (command === 'update_video_extract') {
        updated = { ...extract, title: (args.title as string | undefined) ?? extract.title,
          notes: (args.notes as string | undefined) ?? extract.notes,
          tags: (args.tags as string[] | undefined) ?? extract.tags, date_modified: now };
      } else { return fail('Unsupported video extract operation'); }
      store.put(updated);
      result = updated;
    };
  });
}
