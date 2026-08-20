-- Draft only: lexical coverage is derived, versioned data and should be
-- registered in the native migration registry by the integration owner.

CREATE TABLE IF NOT EXISTS language_lexical_coverage_results (
    coverage_key TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    content_fingerprint TEXT NOT NULL,
    processor_version TEXT NOT NULL,
    lexicon_state_version TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    threshold_version TEXT NOT NULL,
    method TEXT NOT NULL,
    freshness TEXT NOT NULL CHECK (freshness IN ('pending', 'fresh', 'stale', 'unavailable', 'failed')),
    summary_json TEXT,
    error TEXT,
    computed_at INTEGER,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_language_coverage_results_document_profile
    ON language_lexical_coverage_results(document_id, profile_id);

CREATE INDEX IF NOT EXISTS idx_language_coverage_results_versions
    ON language_lexical_coverage_results(
        document_id,
        profile_id,
        content_fingerprint,
        processor_version,
        lexicon_state_version,
        policy_version,
        threshold_version
    );

CREATE TABLE IF NOT EXISTS language_lexical_coverage_chunks (
    coverage_key TEXT NOT NULL REFERENCES language_lexical_coverage_results(coverage_key) ON DELETE CASCADE,
    chunk_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    total_weight REAL NOT NULL,
    counted_token_count INTEGER NOT NULL,
    result_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (coverage_key, chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_language_coverage_chunks_order
    ON language_lexical_coverage_chunks(coverage_key, chunk_index);

CREATE TABLE IF NOT EXISTS language_lexical_coverage_chunk_entries (
    coverage_key TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    lexical_entry_id TEXT NOT NULL,
    PRIMARY KEY (coverage_key, chunk_id, lexical_entry_id),
    FOREIGN KEY (coverage_key, chunk_id)
        REFERENCES language_lexical_coverage_chunks(coverage_key, chunk_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_language_coverage_reverse_entry
    ON language_lexical_coverage_chunk_entries(profile_id, lexical_entry_id);

CREATE INDEX IF NOT EXISTS idx_language_coverage_reverse_document
    ON language_lexical_coverage_chunk_entries(document_id, profile_id, chunk_id);

CREATE TABLE IF NOT EXISTS language_lexical_coverage_jobs (
    job_id TEXT PRIMARY KEY,
    coverage_key TEXT NOT NULL,
    document_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'cancelled', 'failed', 'stale')),
    next_chunk_index INTEGER NOT NULL DEFAULT 0,
    completed_chunks INTEGER NOT NULL DEFAULT 0,
    completed_units INTEGER NOT NULL DEFAULT 0,
    retry_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_language_coverage_jobs_document_profile
    ON language_lexical_coverage_jobs(document_id, profile_id, updated_at);
