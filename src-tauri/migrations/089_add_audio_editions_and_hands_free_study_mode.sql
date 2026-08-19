CREATE TABLE IF NOT EXISTS audio_editions (
    id TEXT PRIMARY KEY,
    source_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    source_revision_hash TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    voice TEXT NOT NULL,
    quality_preset TEXT,
    generation_settings TEXT,
    total_duration_sec REAL DEFAULT 0.0,
    status TEXT NOT NULL CHECK(status IN ('draft', 'generating', 'ready', 'failed', 'stale')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audio_edition_sections (
    id TEXT PRIMARY KEY,
    edition_id TEXT NOT NULL REFERENCES audio_editions(id) ON DELETE CASCADE,
    section_index INTEGER NOT NULL,
    title TEXT NOT NULL,
    source_section_id TEXT,
    source_start_anchor TEXT,
    source_end_anchor TEXT,
    character_count INTEGER NOT NULL,
    audio_file_path TEXT,
    audio_mime_type TEXT DEFAULT 'audio/mp3',
    duration_sec REAL DEFAULT 0.0,
    generation_status TEXT NOT NULL CHECK(generation_status IN ('queued', 'generating', 'ready', 'failed', 'stale')),
    failure_reason TEXT,
    retry_count INTEGER DEFAULT 0,
    cache_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audio_edition_anchors (
    id TEXT PRIMARY KEY,
    section_id TEXT NOT NULL REFERENCES audio_edition_sections(id) ON DELETE CASCADE,
    audio_start_sec REAL NOT NULL,
    audio_end_sec REAL NOT NULL,
    source_start_anchor TEXT NOT NULL,
    source_end_anchor TEXT NOT NULL,
    text_content TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audio_editions_doc ON audio_editions(source_document_id);
CREATE INDEX IF NOT EXISTS idx_audio_edition_sections_edition ON audio_edition_sections(edition_id, section_index);
CREATE INDEX IF NOT EXISTS idx_audio_edition_anchors_section ON audio_edition_anchors(section_id, audio_start_sec);

CREATE TABLE IF NOT EXISTS listening_sessions (
    id TEXT PRIMARY KEY,
    edition_id TEXT NOT NULL REFERENCES audio_editions(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    duration_seconds INTEGER DEFAULT 0,
    extract_count INTEGER DEFAULT 0,
    is_reviewed INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS listening_session_items (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES listening_sessions(id) ON DELETE CASCADE,
    extract_id TEXT REFERENCES extracts(id) ON DELETE SET NULL,
    marker_type TEXT NOT NULL CHECK(marker_type IN ('extract', 'bookmark', 'interesting', 'confusing')),
    audio_timestamp REAL NOT NULL,
    source_anchor TEXT NOT NULL,
    snippet_text TEXT NOT NULL,
    note TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listening_sessions_edition ON listening_sessions(edition_id);
CREATE INDEX IF NOT EXISTS idx_listening_session_items_session ON listening_session_items(session_id);
