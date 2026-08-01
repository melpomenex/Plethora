/**
 * IndexedDB wrapper for browser-based storage
 * Mirrors the Rust Repository pattern for data consistency
 */

import { v4 as uuidv4 } from 'uuid';
import type { PdfSelectionContext } from '../types/selection';

// Database version - increment when schema changes
const DB_VERSION = 4;
const DB_NAME = 'incrementum';

// Store names
const STORES = {
    documents: 'documents',
    extracts: 'extracts',
    learningItems: 'learning_items',
    files: 'files',
    syncState: 'sync_state',
    imageAssets: 'image_assets',
    podcastFeeds: 'podcast_feeds',
    podcastEpisodes: 'podcast_episodes',
} as const;

// Avoid storing extremely large document content in IndexedDB values.
const MAX_DOCUMENT_CONTENT_CHARS = 2_000_000;

let db: IDBDatabase | null = null;
const corruptedDocumentIds = new Set<string>();

/**
 * Open the IndexedDB database.
 * If the cached connection was closed by the browser (tab backgrounding,
 * memory pressure, versionchange), it transparently reconnects.
 */
export async function openDatabase(): Promise<IDBDatabase> {
    if (db) {
        // Probe the connection — if the browser closed it externally,
        // objectStoreNames will throw or be empty.
        try {
            if (db.objectStoreNames.length > 0) return db;
        } catch {
            // dead
        }
        db = null;
    }

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            const err = request.error;
            if (err?.message?.includes('backing store') || err?.name === 'UnknownError') {
                console.error('[IndexedDB] Backing store error — site storage may be corrupted. Try clearing site data (Settings → Site Settings → Clear data).');
            }
            reject(err);
        };
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const target = event.target as IDBOpenDBRequest;
            const database = target.result;

            if (!database.objectStoreNames.contains(STORES.documents)) {
                const docStore = database.createObjectStore(STORES.documents, { keyPath: 'id' });
                docStore.createIndex('by_date_added', 'date_added', { unique: false });
                docStore.createIndex('by_sync_version', 'sync_version', { unique: false });
            }

            if (!database.objectStoreNames.contains(STORES.extracts)) {
                const extStore = database.createObjectStore(STORES.extracts, { keyPath: 'id' });
                extStore.createIndex('by_document', 'document_id', { unique: false });
                extStore.createIndex('by_next_review', 'next_review_date', { unique: false });
                extStore.createIndex('by_sync_version', 'sync_version', { unique: false });
            }

            if (!database.objectStoreNames.contains(STORES.learningItems)) {
                const itemStore = database.createObjectStore(STORES.learningItems, { keyPath: 'id' });
                itemStore.createIndex('by_document', 'document_id', { unique: false });
                itemStore.createIndex('by_extract', 'extract_id', { unique: false });
                itemStore.createIndex('by_due_date', 'due_date', { unique: false });
                itemStore.createIndex('by_sync_version', 'sync_version', { unique: false });
            }

            // Files store (for document blobs)
            if (!database.objectStoreNames.contains(STORES.files)) {
                const fileStore = database.createObjectStore(STORES.files, { keyPath: 'id' });
                fileStore.createIndex('by_filename', 'filename', { unique: false });
            } else if (target.transaction) {
                const fileStore = target.transaction.objectStore(STORES.files);
                if (!fileStore.indexNames.contains('by_filename')) {
                    fileStore.createIndex('by_filename', 'filename', { unique: false });
                }
            }

            // Sync state store
            if (!database.objectStoreNames.contains(STORES.syncState)) {
                database.createObjectStore(STORES.syncState, { keyPath: 'key' });
            }

            // Image assets store (for image-occlusion flashcards)
            if (!database.objectStoreNames.contains(STORES.imageAssets)) {
                const imageStore = database.createObjectStore(STORES.imageAssets, { keyPath: 'id' });
                imageStore.createIndex('by_sha256', 'sha256', { unique: false });
            }

            // Podcast feeds store (browser-mode podcast subscriptions)
            if (!database.objectStoreNames.contains(STORES.podcastFeeds)) {
                const feedStore = database.createObjectStore(STORES.podcastFeeds, { keyPath: 'id' });
                feedStore.createIndex('by_feed_url', 'feed_url', { unique: false });
            }

            // Podcast episodes store
            if (!database.objectStoreNames.contains(STORES.podcastEpisodes)) {
                const epStore = database.createObjectStore(STORES.podcastEpisodes, { keyPath: 'id' });
                epStore.createIndex('by_feed_id', 'feed_id', { unique: false });
                epStore.createIndex('by_guid', 'guid', { unique: false });
                epStore.createIndex('by_played', 'played', { unique: false });
            }
        };
    });
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
    if (db) {
        db.close();
        db = null;
    }
}

/**
 * Wrap an IDB operation so it retries once on InvalidStateError
 * ("database connection is closing"). The browser can silently close
 * our cached IDBDatabase between the openDatabase() check and the
 * transaction() call (especially under memory pressure or rapid navigation).
 */
async function withRetry<T>(fn: (database: IDBDatabase) => Promise<T>): Promise<T> {
    try {
        const database = await openDatabase();
        return await fn(database);
    } catch (error: any) {
        const msg = error?.message ?? '';
        const isDeadConnection =
            (error?.name === 'InvalidStateError' &&
                (msg.includes('closing') || msg.includes('closed'))) ||
            (error?.name === 'AbortError' &&
                msg.includes('aborted'));
        if (isDeadConnection) {
            db = null; // force reconnect
            console.warn('[IndexedDB] Connection lost, retrying…');
            const database = await openDatabase();
            return await fn(database);
        }
        throw error;
    }
}

/**
 * Generic get by ID
 */
async function getById<T>(storeName: string, id: string): Promise<T | null> {
    return withRetry((database) => new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    }));
}

/**
 * Generic get all
 */
async function getAll<T>(storeName: string): Promise<T[]> {
    return withRetry((database) => new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    }));
}

async function getAllKeys(storeName: string): Promise<IDBValidKey[]> {
    return withRetry((database) => new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    }));
}

/**
 * Generic get by index
 */
async function getByIndex<T>(storeName: string, indexName: string, value: IDBValidKey): Promise<T[]> {
    return withRetry((database) => new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const index = store.index(indexName);
        const request = index.getAll(value);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    }));
}

/**
 * Generic put (insert or update)
 */
async function put<T>(storeName: string, item: T): Promise<T> {
    return withRetry((database) => new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.put(item);
        request.onsuccess = () => resolve(item);
        request.onerror = () => reject(request.error);
    }));
}

/**
 * Generic delete
 */
async function deleteById(storeName: string, id: string): Promise<void> {
    return withRetry((database) => new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    }));
}

export interface Document {
    id: string;
    /**
     * Browser mode has no collection table; documents either carry the id of
     * the single default collection or nothing at all. Declared so callers
     * that read or assign it do not have to cast.
     */
    collection_id?: string;
    title: string;
    file_path: string;
    file_type: string;
    content?: string;
    content_hash?: string;
    total_pages?: number;
    current_page: number;
    current_scroll_percent?: number;
    current_cfi?: string;
    position_json?: string;
    progress_percent?: number;
    category?: string;
    tags: string[];
    date_added: string;
    date_modified: string;
    date_last_reviewed?: string;
    extract_count: number;
    learning_item_count: number;
    priority_rating: number;
    priority_slider: number;
    priority_score: number;
    is_archived: boolean;
    is_favorite: boolean;
    metadata?: Record<string, unknown>;
    cover_image_url?: string;
    cover_image_source?: string;
    next_reading_date?: string;
    reading_count?: number;
    stability?: number;
    difficulty?: number;
    reps?: number;
    total_time_spent?: number;
    sync_version?: number;
    _deleted?: boolean;
}

export async function createDocument(doc: Partial<Document>): Promise<Document> {
    const now = new Date().toISOString();
    const content = doc.content && doc.content.length > MAX_DOCUMENT_CONTENT_CHARS
        ? undefined
        : doc.content;
    if (doc.content && doc.content.length > MAX_DOCUMENT_CONTENT_CHARS) {
        console.warn('[IndexedDB] Skipping oversized document content');
    }
    const document: Document = {
        id: doc.id || uuidv4(),
        title: doc.title || 'Untitled',
        file_path: doc.file_path || '',
        file_type: doc.file_type || 'pdf',
        content,
        content_hash: doc.content_hash,
        total_pages: doc.total_pages,
        current_page: doc.current_page || 1,
        current_scroll_percent: doc.current_scroll_percent,
        current_cfi: doc.current_cfi,
        category: doc.category,
        tags: doc.tags || [],
        date_added: doc.date_added || now,
        date_modified: now,
        date_last_reviewed: doc.date_last_reviewed,
        extract_count: doc.extract_count || 0,
        learning_item_count: doc.learning_item_count || 0,
        priority_rating: doc.priority_rating ?? 3,
        priority_slider: doc.priority_slider ?? 50,
        priority_score: doc.priority_score ?? 50,
        is_archived: doc.is_archived || false,
        is_favorite: doc.is_favorite || false,
        metadata: doc.metadata,
        cover_image_url: doc.cover_image_url,
        cover_image_source: doc.cover_image_source,
        sync_version: 0, // Will be set during sync
        // FSRS scheduling fields
        next_reading_date: doc.next_reading_date,
        reading_count: doc.reading_count || 0,
        stability: doc.stability || 0,
        difficulty: doc.difficulty || 0,
        reps: doc.reps || 0,
        total_time_spent: doc.total_time_spent || 0,
    };
    return put(STORES.documents, document);
}

export async function getDocument(id: string): Promise<Document | null> {
    try {
        return await getById<Document>(STORES.documents, id);
    } catch (error) {
        console.error('[IndexedDB] Failed to read document', id, error);
        corruptedDocumentIds.add(id);
        return null;
    }
}

export async function getDocuments(): Promise<Document[]> {
    try {
        const docs = await getAll<Document>(STORES.documents);
        return docs.filter(d => !d._deleted).sort((a, b) =>
            new Date(b.date_added).getTime() - new Date(a.date_added).getTime()
        );
    } catch (error) {
        console.warn('[IndexedDB] Falling back to safe document scan:', error);
        const ids = await getAllKeys(STORES.documents);
        const docs: Document[] = [];
        for (const id of ids) {
            if (typeof id !== 'string') continue;
            if (corruptedDocumentIds.has(id)) continue;
            const doc = await getDocument(id);
            if (doc && !doc._deleted) {
                docs.push(doc);
            }
        }
        return docs.sort((a, b) =>
            new Date(b.date_added).getTime() - new Date(a.date_added).getTime()
        );
    }
}

export async function getDocumentsWithProgress(limit: number): Promise<Document[]> {
    try {
        const docs = await getAll<Document>(STORES.documents);
        return docs
            .filter(d => !d._deleted && !d.is_archived && (d.progress_percent === undefined || d.progress_percent < 100))
            .sort((a, b) => new Date(b.date_modified).getTime() - new Date(a.date_modified).getTime())
            .slice(0, limit);
    } catch (error) {
        console.warn('[IndexedDB] Error getting documents with progress:', error);
        return [];
    }
}

export async function updateDocument(id: string, updates: Partial<Document>): Promise<Document> {
    const existing = await getDocument(id);
    if (!existing) throw new Error(`Document ${id} not found`);

    if (updates.content && updates.content.length > MAX_DOCUMENT_CONTENT_CHARS) {
        console.warn('[IndexedDB] Skipping oversized document content update');
        updates = { ...updates, content: undefined };
    }

    const updated: Document = {
        ...existing,
        ...updates,
        id, // Ensure ID is not overwritten
        date_modified: new Date().toISOString(),
    };
    return put(STORES.documents, updated);
}

export async function deleteDocument(id: string): Promise<void> {
    // Soft delete for sync
    const doc = await getDocument(id);
    if (doc) {
        doc._deleted = true;
        doc.date_modified = new Date().toISOString();
        await put(STORES.documents, doc);
    }
}

export interface MemoryState {
    stability: number;
    difficulty: number;
}

export interface Extract {
    id: string;
    document_id: string;
    /** Plain text content for search and AI processing */
    content: string;
    /** Rich HTML content with inline styles for 1:1 visual fidelity */
    html_content?: string;
    /** Source URL for web extracts */
    source_url?: string;
    page_title?: string;
    page_number?: number;
    selection_context?: PdfSelectionContext;
    highlight_color?: string;
    notes?: string;
    progressive_disclosure_level: number;
    max_disclosure_level: number;
    date_created: string;
    date_modified: string;
    tags: string[];
    category?: string;
    memory_state?: MemoryState;
    next_review_date?: string;
    last_review_date?: string;
    review_count: number;
    reps: number;
    sync_version?: number;
    _deleted?: boolean;
}

export async function createExtract(ext: Partial<Extract>): Promise<Extract> {
    const now = new Date().toISOString();
    const extract: Extract = {
        id: ext.id || uuidv4(),
        document_id: ext.document_id!,
        content: ext.content || '',
        html_content: ext.html_content,
        source_url: ext.source_url,
        page_title: ext.page_title,
        page_number: ext.page_number,
        selection_context: ext.selection_context,
        highlight_color: ext.highlight_color,
        notes: ext.notes,
        progressive_disclosure_level: ext.progressive_disclosure_level || 0,
        max_disclosure_level: ext.max_disclosure_level || 3,
        date_created: ext.date_created || now,
        date_modified: now,
        tags: ext.tags || [],
        category: ext.category,
        memory_state: ext.memory_state,
        next_review_date: ext.next_review_date,
        last_review_date: ext.last_review_date,
        review_count: ext.review_count || 0,
        reps: ext.reps || 0,
        sync_version: 0,
    };

    const doc = await getDocument(ext.document_id!);
    if (doc) {
        await updateDocument(doc.id, { extract_count: doc.extract_count + 1 });
    }

    return put(STORES.extracts, extract);
}

export async function getExtract(id: string): Promise<Extract | null> {
    return getById<Extract>(STORES.extracts, id);
}

export async function getExtractsByDocument(documentId: string): Promise<Extract[]> {
    const extracts = await getByIndex<Extract>(STORES.extracts, 'by_document', documentId);
    return extracts.filter(e => !e._deleted).sort((a, b) => (a.page_number || 0) - (b.page_number || 0));
}

export async function getAllExtracts(): Promise<Extract[]> {
    const extracts = await getAll<Extract>(STORES.extracts);
    return extracts.filter(e => !e._deleted);
}

export async function updateExtract(id: string, updates: Partial<Extract>): Promise<Extract> {
    const existing = await getExtract(id);
    if (!existing) throw new Error(`Extract ${id} not found`);

    const updated: Extract = {
        ...existing,
        ...updates,
        id,
        date_modified: new Date().toISOString(),
    };
    return put(STORES.extracts, updated);
}

export async function deleteExtract(id: string): Promise<void> {
    const ext = await getExtract(id);
    if (ext) {
        ext._deleted = true;
        ext.date_modified = new Date().toISOString();
        await put(STORES.extracts, ext);

        const doc = await getDocument(ext.document_id);
        if (doc && doc.extract_count > 0) {
            await updateDocument(doc.id, { extract_count: doc.extract_count - 1 });
        }
    }
}

export async function getDueExtracts(): Promise<Extract[]> {
    const now = new Date().toISOString();

    return withRetry((database) => new Promise((resolve, reject) => {
        const tx = database.transaction(STORES.extracts, 'readonly');
        const store = tx.objectStore(STORES.extracts);
        const index = store.index('by_next_review');
        const range = IDBKeyRange.upperBound(now);
        const request = index.getAll(range);

        request.onsuccess = () => {
            const results = request.result.filter((e: Extract) => !e._deleted && e.next_review_date);
            resolve(results);
        };
        request.onerror = () => reject(request.error);
    }));
}

export interface LearningItem {
    id: string;
    extract_id?: string;
    document_id?: string;
    item_type: string;
    question: string;
    answer?: string;
    cloze_text?: string;
    cloze_ranges?: [number, number][];
    difficulty: number;
    interval: number;
    ease_factor: number;
    due_date?: string;
    date_created: string;
    date_modified: string;
    last_review_date?: string;
    review_count: number;
    lapses: number;
    state: string;
    is_suspended: boolean;
    tags: string[];
    image_asset_ids?: string[];
    interaction_metadata?: Record<string, unknown>;
    memory_state?: MemoryState;
    algorithm_type?: string;
    algorithm_state?: string;
    sync_version?: number;
    _deleted?: boolean;
}

export async function createLearningItem(item: Partial<LearningItem>): Promise<LearningItem> {
    const fullItem = buildLearningItemRecord(item);

    if (item.document_id) {
        const doc = await getDocument(item.document_id);
        if (doc) {
            await updateDocument(doc.id, { learning_item_count: doc.learning_item_count + 1 });
        }
    }

    return put(STORES.learningItems, fullItem);
}

/**
 * Build a LearningItem record without writing to IDB.
 * Used by bulk import flows (e.g. Anki APKG) that write via bulkPutLearningItems.
 */
export function createLearningItemRaw(item: Partial<LearningItem>): LearningItem {
    return buildLearningItemRecord(item);
}

function buildLearningItemRecord(item: Partial<LearningItem>): LearningItem {
    const now = new Date().toISOString();
    return {
        id: item.id || uuidv4(),
        extract_id: item.extract_id,
        document_id: item.document_id,
        item_type: item.item_type || 'flashcard',
        question: item.question || '',
        answer: item.answer,
        cloze_text: item.cloze_text,
        cloze_ranges: item.cloze_ranges,
        difficulty: item.difficulty || 0.3,
        interval: item.interval || 0,
        ease_factor: item.ease_factor || 2.5,
        due_date: item.due_date || now,
        date_created: item.date_created || now,
        date_modified: now,
        last_review_date: item.last_review_date,
        review_count: item.review_count || 0,
        lapses: item.lapses || 0,
        state: item.state || 'new',
        is_suspended: item.is_suspended || false,
        tags: item.tags || [],
        image_asset_ids: item.image_asset_ids || [],
        interaction_metadata: item.interaction_metadata,
        memory_state: item.memory_state,
        algorithm_type: item.algorithm_type || 'fsrs',
        algorithm_state: item.algorithm_state,
        sync_version: 0,
    };
}

export async function getLearningItem(id: string): Promise<LearningItem | null> {
    return getById<LearningItem>(STORES.learningItems, id);
}

export async function getLearningItemsByDocument(documentId: string): Promise<LearningItem[]> {
    const items = await getByIndex<LearningItem>(STORES.learningItems, 'by_document', documentId);
    return items.filter(i => !i._deleted);
}

export async function getAllLearningItems(): Promise<LearningItem[]> {
    const items = await getAll<LearningItem>(STORES.learningItems);
    return items.filter(i => !i._deleted);
}

// Alias for getAllLearningItems for API consistency
export async function getLearningItems(): Promise<LearningItem[]> {
    return getAllLearningItems();
}

export async function updateLearningItem(id: string, updates: Partial<LearningItem>): Promise<LearningItem> {
    const existing = await getLearningItem(id);
    if (!existing) throw new Error(`Learning item ${id} not found`);

    const updated: LearningItem = {
        ...existing,
        ...updates,
        id,
        date_modified: new Date().toISOString(),
    };
    return put(STORES.learningItems, updated);
}

export async function deleteLearningItem(id: string): Promise<void> {
    const item = await getLearningItem(id);
    if (item) {
        item._deleted = true;
        item.date_modified = new Date().toISOString();
        await put(STORES.learningItems, item);

        if (item.document_id) {
            const doc = await getDocument(item.document_id);
            if (doc && doc.learning_item_count > 0) {
                await updateDocument(doc.id, { learning_item_count: doc.learning_item_count - 1 });
            }
        }
    }
}

export async function getDueLearningItems(): Promise<LearningItem[]> {
    const now = new Date().toISOString();

    return withRetry((database) => new Promise((resolve, reject) => {
        const tx = database.transaction(STORES.learningItems, 'readonly');
        const store = tx.objectStore(STORES.learningItems);
        const index = store.index('by_due_date');
        const range = IDBKeyRange.upperBound(now);
        const request = index.getAll(range);

        request.onsuccess = () => {
            const results = request.result.filter((i: LearningItem) => !i._deleted && !i.is_suspended);
            resolve(results);
        };
        request.onerror = () => reject(request.error);
    }));
}

export interface StoredFile {
    id: string;
    filename: string;
    content_type: string;
    blob: Blob;
    created_at: string;
}

export async function storeFile(file: File, filePath?: string): Promise<StoredFile> {
    // Use the filePath as the id if provided (for browser-file:// paths)
    const fileId = filePath || uuidv4();
    const storedFile: StoredFile = {
        id: fileId,
        filename: file.name,
        content_type: file.type,
        blob: file,
        created_at: new Date().toISOString(),
    };
    const result = await put(STORES.files, storedFile);
    return result;
}

export async function getFile(id: string): Promise<StoredFile | null> {
    const result = await getById<StoredFile>(STORES.files, id);
    console.error(`[IndexedDB] File lookup by id result:`, result ? `found (${result.blob?.size} bytes)` : 'not found');
    return result;
}

export async function getFileByName(filename: string): Promise<StoredFile | null> {
    return withRetry((database) => new Promise((resolve, reject) => {
        const tx = database.transaction(STORES.files, 'readonly');
        const store = tx.objectStore(STORES.files);
        if (!store.indexNames.contains('by_filename')) {
            // Fallback for older DBs that haven't upgraded yet.
            const request = store.getAll();
            request.onsuccess = () => {
                const match = request.result.find((f: StoredFile) => f.filename === filename) || null;
                console.error(`[IndexedDB] File lookup by name (fallback) result:`, match ? `found (${match.blob?.size} bytes)` : 'not found');
                resolve(match);
            };
            request.onerror = () => reject(request.error);
            return;
        }
        const index = store.index('by_filename');
        const request = index.get(filename);
        request.onsuccess = () => {
            const result = request.result || null;
            console.error(`[IndexedDB] File lookup by name result:`, result ? `found (${result.blob?.size} bytes)` : 'not found');
            resolve(result);
        };
        request.onerror = () => reject(request.error);
    }));
}

export async function deleteFile(id: string): Promise<void> {
    return deleteById(STORES.files, id);
}

export async function getAllFiles(): Promise<StoredFile[]> {
    return getAll<StoredFile>(STORES.files);
}

export async function bulkPutFiles(files: StoredFile[]): Promise<void> {
    return withRetry((database) => {
        const tx = database.transaction(STORES.files, 'readwrite');
        const store = tx.objectStore(STORES.files);
        for (const file of files) {
            store.put(file);
        }
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    });
}

export async function clearStore(storeName: string): Promise<void> {
    return withRetry((database) => new Promise((resolve, reject) => {
        const tx = database.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    }));
}

export async function getSyncState(key: string): Promise<unknown> {
    const result = await getById<{ key: string; value: unknown }>(STORES.syncState, key);
    return result?.value;
}

export async function setSyncState(key: string, value: unknown): Promise<void> {
    await put(STORES.syncState, { key, value });
}

export async function deleteSyncState(key: string): Promise<void> {
    await deleteById(STORES.syncState, key);
}

/** Atomically persist a normal browser SM-20 review and its collection learner. */
export async function commitBrowserSm20Review(
    item: LearningItem,
    collectionState: unknown,
): Promise<void> {
    await withRetry((database) => new Promise<void>((resolve, reject) => {
        const tx = database.transaction([STORES.learningItems, STORES.syncState], 'readwrite');
        tx.objectStore(STORES.learningItems).put(item);
        tx.objectStore(STORES.syncState).put({ key: 'sm20_collection_state', value: collectionState });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('SM-20 transaction aborted'));
        tx.onerror = () => reject(tx.error ?? new Error('SM-20 transaction failed'));
    }));
}

/** Atomically persist a browser/PWA Arena review and its idempotency record. */
export async function commitBrowserArenaReview(
    item: LearningItem,
    commitKey: string,
    provenance: Record<string, unknown>,
    collectionState: unknown,
    previousCollectionState: unknown,
): Promise<boolean> {
    return withRetry((database) => new Promise((resolve, reject) => {
        const tx = database.transaction([STORES.learningItems, STORES.syncState], 'readwrite');
        const itemStore = tx.objectStore(STORES.learningItems);
        const syncStore = tx.objectStore(STORES.syncState);
        let committed = false;
        let operationError: Error | null = null;

        const commitRequest = syncStore.get(commitKey);
        commitRequest.onerror = () => {
            operationError = commitRequest.error ?? new Error('Failed to check Arena commit');
            tx.abort();
        };
        commitRequest.onsuccess = () => {
            const existing = commitRequest.result?.value as { item_id?: string } | undefined;
            if (existing) {
                if (existing.item_id && existing.item_id !== item.id) {
                    operationError = new Error('arena_already_committed: commit belongs to another item');
                    tx.abort();
                }
                return;
            }

            const reviewsRequest = syncStore.get('browser_review_results');
            reviewsRequest.onerror = () => {
                operationError = reviewsRequest.error ?? new Error('Failed to read browser review results');
                tx.abort();
            };
            reviewsRequest.onsuccess = () => {
                const reviews = (reviewsRequest.result?.value as unknown[] | undefined) ?? [];
                itemStore.put(item);
                syncStore.put({ key: 'sm20_collection_state', value: collectionState });
                syncStore.put({ key: 'browser_review_results', value: [...reviews, provenance] });
                syncStore.put({
                    key: commitKey,
                    value: { item_id: item.id, provenance, previous_collection_state: previousCollectionState },
                });
                committed = true;
            };
        };

        tx.oncomplete = () => resolve(committed);
        tx.onabort = () => reject(operationError ?? tx.error ?? new Error('Arena transaction aborted'));
        tx.onerror = () => {
            operationError ??= tx.error ?? new Error('Arena transaction failed');
        };
    }));
}

/** Atomically restore a browser/PWA item and remove one Arena review event. */
export async function undoBrowserArenaReview(
    item: LearningItem,
    commitKey: string,
    commitId: string,
): Promise<void> {
    return withRetry((database) => new Promise((resolve, reject) => {
        const tx = database.transaction([STORES.learningItems, STORES.syncState], 'readwrite');
        const itemStore = tx.objectStore(STORES.learningItems);
        const syncStore = tx.objectStore(STORES.syncState);
        let operationError: Error | null = null;

        const commitRequest = syncStore.get(commitKey);
        commitRequest.onerror = () => {
            operationError = commitRequest.error ?? new Error('Failed to read Arena collection snapshot');
            tx.abort();
        };
        commitRequest.onsuccess = () => {
            const previousCollectionState = commitRequest.result?.value?.previous_collection_state;
            const reviewsRequest = syncStore.get('browser_review_results');
            reviewsRequest.onerror = () => {
                operationError = reviewsRequest.error ?? new Error('Failed to read browser review results');
                tx.abort();
            };
            reviewsRequest.onsuccess = () => {
                const reviews = (reviewsRequest.result?.value as Array<Record<string, unknown>> | undefined) ?? [];
                itemStore.put(item);
                if (previousCollectionState !== undefined) {
                    syncStore.put({ key: 'sm20_collection_state', value: previousCollectionState });
                }
                syncStore.put({
                    key: 'browser_review_results',
                    value: reviews.filter((result) => result.arena_commit_id !== commitId),
                });
                syncStore.delete(commitKey);
            };
        };

        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(operationError ?? tx.error ?? new Error('Arena undo transaction aborted'));
        tx.onerror = () => {
            operationError ??= tx.error ?? new Error('Arena undo transaction failed');
        };
    }));
}

export async function getChangedDocuments(sinceSyncVersion: number): Promise<Document[]> {
    const all = await getAll<Document>(STORES.documents);
    return all.filter(d => (d.sync_version || 0) > sinceSyncVersion);
}

export async function getChangedExtracts(sinceSyncVersion: number): Promise<Extract[]> {
    const all = await getAll<Extract>(STORES.extracts);
    return all.filter(e => (e.sync_version || 0) > sinceSyncVersion);
}

export async function getChangedLearningItems(sinceSyncVersion: number): Promise<LearningItem[]> {
    const all = await getAll<LearningItem>(STORES.learningItems);
    return all.filter(i => (i.sync_version || 0) > sinceSyncVersion);
}

export async function bulkPutDocuments(docs: Document[]): Promise<void> {
    return withRetry((database) => {
        const tx = database.transaction(STORES.documents, 'readwrite');
        const store = tx.objectStore(STORES.documents);
        for (const doc of docs) {
            store.put(doc);
        }
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    });
}

export async function bulkPutExtracts(extracts: Extract[]): Promise<void> {
    return withRetry((database) => {
        const tx = database.transaction(STORES.extracts, 'readwrite');
        const store = tx.objectStore(STORES.extracts);
        for (const ext of extracts) {
            store.put(ext);
        }
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    });
}

export async function bulkPutLearningItems(items: LearningItem[]): Promise<void> {
    return withRetry((database) => {
        const tx = database.transaction(STORES.learningItems, 'readwrite');
        const store = tx.objectStore(STORES.learningItems);
        for (const item of items) {
            store.put(item);
        }
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    });
}

export interface ImageAsset {
    id: string;
    mime_type: string;
    file_name?: string;
    byte_size: number;
    sha256: string;
    width?: number;
    height?: number;
    created_at: string;
    /** base64 payload (no data: prefix) */
    base64_data: string;
    reference_count?: number;
    is_referenced?: boolean;
    sync_version?: number;
}

/**
 * Create an image asset record. The caller is responsible for computing the
 * sha256 and deduplication — use findImageAssetBySha256 first.
 */
export async function createImageAsset(asset: Partial<ImageAsset>): Promise<ImageAsset> {
    const now = new Date().toISOString();
    const record: ImageAsset = {
        id: asset.id || uuidv4(),
        mime_type: asset.mime_type || 'application/octet-stream',
        file_name: asset.file_name,
        byte_size: asset.byte_size ?? 0,
        sha256: asset.sha256 || '',
        width: asset.width,
        height: asset.height,
        created_at: asset.created_at || now,
        base64_data: asset.base64_data || '',
        reference_count: asset.reference_count ?? 0,
        is_referenced: asset.is_referenced ?? false,
        sync_version: 0,
    };
    return put(STORES.imageAssets, record);
}

export async function getImageAsset(id: string): Promise<ImageAsset | null> {
    return getById<ImageAsset>(STORES.imageAssets, id);
}

export async function findImageAssetBySha256(sha256: string): Promise<ImageAsset | null> {
    const matches = await getByIndex<ImageAsset>(STORES.imageAssets, 'by_sha256', sha256);
    return matches[0] ?? null;
}

export async function listImageAssets(): Promise<ImageAsset[]> {
    const assets = await getAll<ImageAsset>(STORES.imageAssets);
    return assets.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
}

export async function updateImageAsset(id: string, updates: Partial<ImageAsset>): Promise<ImageAsset> {
    const existing = await getImageAsset(id);
    if (!existing) throw new Error(`Image asset ${id} not found`);
    const updated: ImageAsset = { ...existing, ...updates, id };
    return put(STORES.imageAssets, updated);
}

export async function deleteImageAsset(id: string): Promise<void> {
    return deleteById(STORES.imageAssets, id);
}

export async function getChangedImageAssets(sinceSyncVersion: number): Promise<ImageAsset[]> {
    const all = await getAll<ImageAsset>(STORES.imageAssets);
    return all.filter((asset) => (asset.sync_version || 0) > sinceSyncVersion);
}

export async function bulkPutImageAssets(assets: ImageAsset[]): Promise<void> {
    return withRetry((database) => {
        const tx = database.transaction(STORES.imageAssets, 'readwrite');
        const store = tx.objectStore(STORES.imageAssets);
        for (const asset of assets) {
            store.put(asset);
        }
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    });
}

// ---------------------------------------------------------------------------
// Podcast feeds & episodes (browser-mode podcast subscriptions)
//
// Mirrors the Rust podcast tables (`podcast_feeds` / `podcast_episodes`) using
// snake_case field names so values can be normalized with `toCamelCase` by the
// browser backend before reaching the UI. Only metadata + playback state are
// stored here — never audio bytes.
// ---------------------------------------------------------------------------

export interface PodcastFeedRecord {
    id: string;
    title: string;
    description: string | null;
    image_url: string | null;
    author: string | null;
    language: string | null;
    link: string | null;
    feed_url: string;
    last_fetched: string | null;
    subscribed_at: string;
    sort_order: number;
    auto_transcribe: boolean;
    transcribe_language: string | null;
}

export interface PodcastEpisodeRecord {
    id: string;
    feed_id: string;
    guid: string | null;
    title: string;
    description: string | null;
    published_date: string | null;
    duration: number | null; // seconds
    audio_url: string;
    audio_type: string | null;
    file_size: number | null;
    image_url: string | null;
    link: string | null;
    played: boolean;
    playback_position: number; // seconds
    date_added: string;
    transcript_text: string | null;
    transcript_status: string;
    transcript_error: string | null;
    transcribed_at: string | null;
}

export async function subscribePodcastFeed(feed: Partial<PodcastFeedRecord> & { id: string; feed_url: string }): Promise<PodcastFeedRecord> {
    const now = new Date().toISOString();
    // Preserve a previously stored subscription timestamp when re-subscribing
    // (e.g. refresh path upserts the same feed id) so subscribed_at is stable.
    const existing = await getPodcastFeed(feed.id);
    const record: PodcastFeedRecord = {
        id: feed.id,
        title: feed.title ?? 'Untitled Podcast',
        description: feed.description ?? null,
        image_url: feed.image_url ?? null,
        author: feed.author ?? null,
        language: feed.language ?? null,
        link: feed.link ?? null,
        feed_url: feed.feed_url,
        last_fetched: feed.last_fetched ?? now,
        subscribed_at: existing?.subscribed_at ?? feed.subscribed_at ?? now,
        sort_order: existing?.sort_order ?? feed.sort_order ?? 0,
        auto_transcribe: existing?.auto_transcribe ?? feed.auto_transcribe ?? false,
        transcribe_language: existing?.transcribe_language ?? feed.transcribe_language ?? null,
    };
    return put(STORES.podcastFeeds, record);
}

export async function getPodcastFeeds(): Promise<PodcastFeedRecord[]> {
    const feeds = await getAll<PodcastFeedRecord>(STORES.podcastFeeds);
    return feeds.sort((a, b) =>
        new Date(b.subscribed_at).getTime() - new Date(a.subscribed_at).getTime()
    );
}

export async function getPodcastFeed(id: string): Promise<PodcastFeedRecord | null> {
    return getById<PodcastFeedRecord>(STORES.podcastFeeds, id);
}

export async function getPodcastFeedByUrl(url: string): Promise<PodcastFeedRecord | null> {
    const matches = await getByIndex<PodcastFeedRecord>(STORES.podcastFeeds, 'by_feed_url', url);
    return matches[0] ?? null;
}

export async function renamePodcastFeed(id: string, title: string): Promise<void> {
    const existing = await getPodcastFeed(id);
    if (!existing) return;
    await put(STORES.podcastFeeds, { ...existing, title });
}

export async function deletePodcastFeed(id: string): Promise<void> {
    return deleteById(STORES.podcastFeeds, id);
}

/**
 * Upsert episodes for a feed. Existing episodes (matched by `id`, which already
 * encodes guid/audioUrl) keep their `played` / `playback_position` state; only
 * metadata fields are refreshed. New episodes are inserted.
 */
export async function upsertPodcastEpisodes(episodes: PodcastEpisodeRecord[]): Promise<void> {
    if (episodes.length === 0) return;
    const now = new Date().toISOString();
    // Read existing rows first so we preserve playback state without mixing
    // reads into the write transaction.
    const existing = new Map<string, PodcastEpisodeRecord>();
    for (const ep of episodes) {
        const cur = await getById<PodcastEpisodeRecord>(STORES.podcastEpisodes, ep.id);
        if (cur) existing.set(ep.id, cur);
    }
    return withRetry((database) => {
        const tx = database.transaction(STORES.podcastEpisodes, 'readwrite');
        const store = tx.objectStore(STORES.podcastEpisodes);
        for (const ep of episodes) {
            const prev = existing.get(ep.id);
            const record: PodcastEpisodeRecord = {
                ...ep,
                played: prev?.played ?? ep.played ?? false,
                playback_position: prev?.playback_position ?? ep.playback_position ?? 0,
                transcript_text: prev?.transcript_text ?? ep.transcript_text ?? null,
                transcript_status: prev?.transcript_status ?? ep.transcript_status ?? 'none',
                transcript_error: prev?.transcript_error ?? ep.transcript_error ?? null,
                transcribed_at: prev?.transcribed_at ?? ep.transcribed_at ?? null,
                date_added: prev?.date_added ?? ep.date_added ?? now,
            };
            store.put(record);
        }
        return new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    });
}

export async function getPodcastEpisodes(opts: { feedId?: string | null; includePlayed?: boolean } = {}): Promise<PodcastEpisodeRecord[]> {
    const { feedId = null, includePlayed = true } = opts;
    let episodes: PodcastEpisodeRecord[];
    if (feedId) {
        episodes = await getByIndex<PodcastEpisodeRecord>(STORES.podcastEpisodes, 'by_feed_id', feedId);
    } else {
        episodes = await getAll<PodcastEpisodeRecord>(STORES.podcastEpisodes);
    }
    if (!includePlayed) {
        episodes = episodes.filter((e) => !e.played);
    }
    // Newest first by published date; fall back to date_added.
    return episodes.sort((a, b) => {
        const at = new Date(a.published_date || a.date_added).getTime();
        const bt = new Date(b.published_date || b.date_added).getTime();
        return bt - at;
    });
}

export async function getPodcastEpisode(id: string): Promise<PodcastEpisodeRecord | null> {
    return getById<PodcastEpisodeRecord>(STORES.podcastEpisodes, id);
}

export async function markPodcastEpisodePlayed(id: string, played: boolean): Promise<void> {
    const existing = await getPodcastEpisode(id);
    if (!existing) return;
    await put(STORES.podcastEpisodes, { ...existing, played });
}

export async function updatePodcastEpisodePosition(id: string, position: number): Promise<void> {
    const existing = await getPodcastEpisode(id);
    if (!existing) return;
    await put(STORES.podcastEpisodes, { ...existing, playback_position: position });
}

export async function getPodcastEpisodePosition(id: string): Promise<number> {
    const existing = await getPodcastEpisode(id);
    return existing?.playback_position ?? 0;
}

export async function deleteEpisodesForFeed(feedId: string): Promise<void> {
    const episodes = await getByIndex<PodcastEpisodeRecord>(STORES.podcastEpisodes, 'by_feed_id', feedId);
    return withRetry((database) => {
        const tx = database.transaction(STORES.podcastEpisodes, 'readwrite');
        const store = tx.objectStore(STORES.podcastEpisodes);
        for (const ep of episodes) {
            store.delete(ep.id);
        }
        return new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    });
}
