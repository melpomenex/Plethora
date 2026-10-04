CREATE TABLE IF NOT EXISTS saved_queues (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT,
    collection_id TEXT,
    filters_json TEXT NOT NULL,
    item_types_json TEXT NOT NULL,
    session_duration_minutes INTEGER NOT NULL DEFAULT 60,
    max_items INTEGER NOT NULL DEFAULT 50,
    daqe_preset_id TEXT,
    session_goal TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_saved_queues_collection
    ON saved_queues(collection_id, sort_order ASC);
