//! Database migration system
//!
//! Tracks and applies database migrations in order.

use regex::Regex;
use sqlx::{Pool, Sqlite};
use std::path::PathBuf;

use crate::error::{PlethoraError, Result};

/// Migration record stored in the database
#[derive(Debug)]
struct MigrationRecord {
    name: String,
    applied_at: String,
}

/// Migration that can be applied to the database
pub struct Migration {
    pub name: &'static str,
    pub sql: &'static str,
}

impl Migration {
    /// Create a new migration
    pub const fn new(name: &'static str, sql: &'static str) -> Self {
        Self { name, sql }
    }
}

/// All database migrations in order
pub const MIGRATIONS: &[Migration] = &[
    // Migration 001: Initial schema
    Migration::new(
        "001_initial_schema",
        r#"
        -- Create migration tracking table
        CREATE TABLE IF NOT EXISTS _schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        );

        -- Categories table
        CREATE TABLE IF NOT EXISTS categories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT,
            color TEXT,
            icon TEXT,
            description TEXT,
            date_created TEXT NOT NULL,
            date_modified TEXT NOT NULL,
            document_count INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (parent_id) REFERENCES categories(id)
        );

        -- Documents table
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_type TEXT NOT NULL,
            content TEXT,
            content_hash TEXT,
            total_pages INTEGER,
            current_page INTEGER,
            category TEXT,
            tags TEXT NOT NULL DEFAULT '[]',
            date_added TEXT NOT NULL,
            date_modified TEXT NOT NULL,
            date_last_reviewed TEXT,
            extract_count INTEGER NOT NULL DEFAULT 0,
            learning_item_count INTEGER NOT NULL DEFAULT 0,
            priority_score REAL NOT NULL DEFAULT 0,
            is_archived INTEGER NOT NULL DEFAULT 0,
            is_favorite INTEGER NOT NULL DEFAULT 0,
            metadata TEXT,
            FOREIGN KEY (category) REFERENCES categories(id)
        );

        CREATE INDEX IF NOT EXISTS idx_documents_date_added ON documents(date_added);
        CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
        CREATE INDEX IF NOT EXISTS idx_documents_file_type ON documents(file_type);
        CREATE INDEX IF NOT EXISTS idx_documents_is_archived ON documents(is_archived);

        -- Extracts table
        CREATE TABLE IF NOT EXISTS extracts (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            content TEXT NOT NULL,
            page_title TEXT,
            page_number INTEGER,
            highlight_color TEXT,
            notes TEXT,
            progressive_disclosure_level INTEGER NOT NULL DEFAULT 0,
            max_disclosure_level INTEGER NOT NULL DEFAULT 3,
            date_created TEXT NOT NULL,
            date_modified TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]',
            category TEXT,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
            -- Note: category is free-form text, not a foreign key to categories table
        );

        CREATE INDEX IF NOT EXISTS idx_extracts_document_id ON extracts(document_id);
        CREATE INDEX IF NOT EXISTS idx_extracts_page_number ON extracts(page_number);

        -- Learning items table
        CREATE TABLE IF NOT EXISTS learning_items (
            id TEXT PRIMARY KEY,
            extract_id TEXT,
            document_id TEXT,
            item_type TEXT NOT NULL,
            question TEXT NOT NULL,
            answer TEXT,
            cloze_text TEXT,
            cloze_ranges TEXT,
            difficulty INTEGER NOT NULL DEFAULT 3,
            interval INTEGER NOT NULL DEFAULT 0,
            ease_factor REAL NOT NULL DEFAULT 2.5,
            due_date TEXT NOT NULL,
            date_created TEXT NOT NULL,
            date_modified TEXT NOT NULL,
            last_review_date TEXT,
            review_count INTEGER NOT NULL DEFAULT 0,
            lapses INTEGER NOT NULL DEFAULT 0,
            state TEXT NOT NULL DEFAULT 'new',
            is_suspended INTEGER NOT NULL DEFAULT 0,
            tags TEXT NOT NULL DEFAULT '[]',
            FOREIGN KEY (extract_id) REFERENCES extracts(id) ON DELETE CASCADE,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_learning_items_due_date ON learning_items(due_date);
        CREATE INDEX IF NOT EXISTS idx_learning_items_state ON learning_items(state);
        CREATE INDEX IF NOT EXISTS idx_learning_items_extract_id ON learning_items(extract_id);
        CREATE INDEX IF NOT EXISTS idx_learning_items_document_id ON learning_items(document_id);

        -- Annotations table
        CREATE TABLE IF NOT EXISTS annotations (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            type TEXT NOT NULL,
            page_number INTEGER NOT NULL,
            content TEXT,
            rect TEXT,
            color TEXT NOT NULL,
            date_created TEXT NOT NULL,
            date_modified TEXT NOT NULL,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_annotations_document_id ON annotations(document_id);
        CREATE INDEX IF NOT EXISTS idx_annotations_page_number ON annotations(page_number);

        -- Review sessions table
        CREATE TABLE IF NOT EXISTS review_sessions (
            id TEXT PRIMARY KEY,
            start_time TEXT NOT NULL,
            end_time TEXT,
            items_reviewed INTEGER NOT NULL DEFAULT 0,
            correct_answers INTEGER NOT NULL DEFAULT 0,
            total_time INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_review_sessions_start_time ON review_sessions(start_time);

        -- Review results table
        CREATE TABLE IF NOT EXISTS review_results (
            id TEXT PRIMARY KEY,
            session_id TEXT,
            item_id TEXT NOT NULL,
            rating INTEGER NOT NULL,
            time_taken INTEGER NOT NULL,
            new_due_date TEXT NOT NULL,
            new_interval INTEGER NOT NULL,
            new_ease_factor REAL NOT NULL,
            timestamp TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES review_sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (item_id) REFERENCES learning_items(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_review_results_session_id ON review_results(session_id);
        CREATE INDEX IF NOT EXISTS idx_review_results_item_id ON review_results(item_id);

        -- Settings table
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            date_modified TEXT NOT NULL
        );

        -- RSS feeds table
        CREATE TABLE IF NOT EXISTS rss_feeds (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            description TEXT,
            category TEXT,
            update_interval INTEGER NOT NULL DEFAULT 3600,
            last_fetched TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            date_added TEXT NOT NULL,
            auto_queue INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_rss_feeds_is_active ON rss_feeds(is_active);

        -- RSS articles table
        CREATE TABLE IF NOT EXISTS rss_articles (
            id TEXT PRIMARY KEY,
            feed_id TEXT NOT NULL,
            url TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            author TEXT,
            published_date TEXT,
            content TEXT,
            summary TEXT,
            image_url TEXT,
            is_queued INTEGER NOT NULL DEFAULT 0,
            is_read INTEGER NOT NULL DEFAULT 0,
            date_added TEXT NOT NULL,
            FOREIGN KEY (feed_id) REFERENCES rss_feeds(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_rss_articles_feed_id ON rss_articles(feed_id);
        CREATE INDEX IF NOT EXISTS idx_rss_articles_is_queued ON rss_articles(is_queued);
        "#,
    ),
    // Migration 002: Add FSRS memory state to learning_items
    Migration::new(
        "002_add_fsrs_memory_state",
        r#"
        ALTER TABLE learning_items ADD COLUMN memory_state_stability REAL;
        ALTER TABLE learning_items ADD COLUMN memory_state_difficulty REAL;
        "#,
    ),
    // Migration 003: Add AI conversations table
    Migration::new(
        "003_add_ai_conversations",
        r#"
        CREATE TABLE IF NOT EXISTS ai_conversations (
            id TEXT PRIMARY KEY,
            document_id TEXT,
            title TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            date_created TEXT NOT NULL,
            date_modified TEXT NOT NULL,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ai_conversations_document_id ON ai_conversations(document_id);

        CREATE TABLE IF NOT EXISTS ai_messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            tokens_used INTEGER,
            FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_id ON ai_messages(conversation_id);
        "#,
    ),
    // Migration 004: Add GUIDs for RSS articles
    Migration::new(
        "004_add_rss_article_guid",
        r#"
        ALTER TABLE rss_articles ADD COLUMN guid TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_rss_articles_guid ON rss_articles(guid) WHERE guid IS NOT NULL;
        "#,
    ),
    // Migration 004: Add sync tables
    Migration::new(
        "004_add_sync_tables",
        r#"
        CREATE TABLE IF NOT EXISTS sync_config (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            endpoint TEXT,
            api_key TEXT,
            device_id TEXT NOT NULL UNIQUE,
            last_sync TEXT,
            auto_sync INTEGER NOT NULL DEFAULT 0,
            sync_interval INTEGER NOT NULL DEFAULT 3600,
            encryption_enabled INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS sync_queue (
            id TEXT PRIMARY KEY,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            action TEXT NOT NULL,
            data TEXT,
            created_at TEXT NOT NULL,
            retrried_count INTEGER NOT NULL DEFAULT 0,
            last_error TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, entity_id);
        CREATE INDEX IF NOT EXISTS idx_sync_queue_created_at ON sync_queue(created_at);
        "#,
    ),
    // Migration 005: Add document metadata
    Migration::new(
        "005_add_document_metadata",
        r#"
        -- Add language field to documents
        ALTER TABLE documents ADD COLUMN language TEXT;

        -- Add word count field
        ALTER TABLE documents ADD COLUMN word_count INTEGER;

        -- Add reading time estimate (in minutes)
        ALTER TABLE documents ADD COLUMN reading_time INTEGER;

        -- Add source URL for imported content
        ALTER TABLE documents ADD COLUMN source_url TEXT;

        -- Add author field
        ALTER TABLE documents ADD COLUMN author TEXT;

        -- Create index for language
        CREATE INDEX IF NOT EXISTS idx_documents_language ON documents(language);
        "#,
    ),
    // Migration 006: Add extract statistics
    Migration::new(
        "006_add_extract_statistics",
        r#"
        -- Add character count to extracts
        ALTER TABLE extracts ADD COLUMN char_count INTEGER;

        -- Add word count to extracts
        ALTER TABLE extracts ADD COLUMN word_count INTEGER;

        -- Add AI-generated summary
        ALTER TABLE extracts ADD COLUMN summary TEXT;

        -- Add AI-generated key points
        ALTER TABLE extracts ADD COLUMN key_points TEXT;
        "#,
    ),
    // Migration 007: Add study statistics
    Migration::new(
        "007_add_study_statistics",
        r#"
        CREATE TABLE IF NOT EXISTS study_statistics (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL UNIQUE,
            cards_reviewed INTEGER NOT NULL DEFAULT 0,
            correct_reviews INTEGER NOT NULL DEFAULT 0,
            total_study_time INTEGER NOT NULL DEFAULT 0,
            new_cards INTEGER NOT NULL DEFAULT 0,
            learning_cards INTEGER NOT NULL DEFAULT 0,
            review_cards INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_study_statistics_date ON study_statistics(date);
        "#,
    ),
    // Migration 008: Add notification settings
    Migration::new(
        "008_add_notification_settings",
        r#"
        -- Deprecated compatibility storage; v1 notification settings are local-first.
        CREATE TABLE IF NOT EXISTS notification_settings (
            id TEXT PRIMARY KEY,
            study_reminders INTEGER NOT NULL DEFAULT 1,
            cards_due INTEGER NOT NULL DEFAULT 1,
            review_completed INTEGER NOT NULL DEFAULT 1,
            document_imported INTEGER NOT NULL DEFAULT 1,
            sound_enabled INTEGER NOT NULL DEFAULT 1,
            reminder_hour INTEGER NOT NULL DEFAULT 9,
            reminder_minute INTEGER NOT NULL DEFAULT 0
        );
        "#,
    ),
    // Migration 009: Add document priority inputs
    Migration::new(
        "009_add_document_priority_inputs",
        r#"
        ALTER TABLE documents ADD COLUMN priority_rating INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE documents ADD COLUMN priority_slider INTEGER NOT NULL DEFAULT 0;
        "#,
    ),
    // Migration 010: Convert interval to REAL for FSRS 6 fractional day support
    Migration::new(
        "010_convert_interval_to_real",
        r#"
        -- Create a backup of existing intervals
        ALTER TABLE learning_items ADD COLUMN interval_backup REAL;

        -- Copy integer intervals to the new REAL column
        UPDATE learning_items SET interval_backup = CAST(interval AS REAL);

        -- Drop the old interval column
        ALTER TABLE learning_items DROP COLUMN interval;

        -- Rename the new column to interval
        ALTER TABLE learning_items RENAME COLUMN interval_backup TO interval;

        -- Set default value for new items
        UPDATE learning_items SET interval = 0.0 WHERE interval IS NULL;
        "#,
    ),
    // Migration 011: Add FSRS scheduling to extracts
    Migration::new(
        "011_add_extract_fsrs_scheduling",
        r#"
        -- FSRS memory state for extracts
        ALTER TABLE extracts ADD COLUMN memory_state_stability REAL;
        ALTER TABLE extracts ADD COLUMN memory_state_difficulty REAL;

        -- Scheduling fields for extracts
        ALTER TABLE extracts ADD COLUMN next_review_date TEXT;
        ALTER TABLE extracts ADD COLUMN last_review_date TEXT;
        ALTER TABLE extracts ADD COLUMN review_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE extracts ADD COLUMN reps INTEGER NOT NULL DEFAULT 0;

        -- Create index for due extracts
        CREATE INDEX IF NOT EXISTS idx_extracts_next_review ON extracts(next_review_date);
        "#,
    ),
    // Migration 012: Add YouTube transcripts cache
    Migration::new(
        "012_add_youtube_transcripts",
        r#"
        CREATE TABLE IF NOT EXISTS youtube_transcripts (
            id TEXT PRIMARY KEY,
            document_id TEXT,
            video_id TEXT NOT NULL,
            transcript TEXT NOT NULL,
            segments_json TEXT NOT NULL,
            date_created TEXT NOT NULL,
            date_modified TEXT NOT NULL,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_youtube_transcripts_video_id ON youtube_transcripts(video_id);
        CREATE INDEX IF NOT EXISTS idx_youtube_transcripts_document_id ON youtube_transcripts(document_id);
        "#,
    ),
    // Migration 013: Add RSS user preferences for customization
    Migration::new(
        "013_add_rss_user_preferences",
        r#"
        -- RSS user preferences for customization
        CREATE TABLE IF NOT EXISTS rss_user_preferences (
            id TEXT PRIMARY KEY,
            user_id TEXT,
            feed_id TEXT,

            -- Filter preferences
            keyword_include TEXT,
            keyword_exclude TEXT,
            author_whitelist TEXT,
            author_blacklist TEXT,
            category_filter TEXT,

            -- Display preferences
            view_mode TEXT DEFAULT 'card', -- 'card', 'list', 'compact'
            theme_mode TEXT DEFAULT 'system', -- 'system', 'light', 'dark'
            density TEXT DEFAULT 'normal', -- 'compact', 'normal', 'comfortable'
            column_count INTEGER DEFAULT 2,

            -- Display options
            show_thumbnails INTEGER DEFAULT 1,
            excerpt_length INTEGER DEFAULT 150, -- characters
            show_author INTEGER DEFAULT 1,
            show_date INTEGER DEFAULT 1,
            show_feed_icon INTEGER DEFAULT 1,

            -- Sorting preferences
            sort_by TEXT DEFAULT 'date', -- 'date', 'title', 'read_status', 'reading_time'
            sort_order TEXT DEFAULT 'desc', -- 'asc', 'desc'

            date_created TEXT NOT NULL,
            date_modified TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_rss_prefs_user_id ON rss_user_preferences(user_id);
        CREATE INDEX IF NOT EXISTS idx_rss_prefs_feed_id ON rss_user_preferences(feed_id);
        "#,
    ),
    // Migration 014: Add FSRS queue performance indexes
    Migration::new(
        "014_add_fsrs_queue_index",
        r#"
        -- Add next_reading_date column to documents table if it doesn't exist
        -- This column is used for FSRS-based queue scheduling
        ALTER TABLE documents ADD COLUMN next_reading_date TEXT;

        -- Create index on documents.next_reading_date for efficient queue queries
        -- This improves performance for FSRS-based queue scheduling where we filter
        -- documents by next_reading_date <= now (due documents)
        CREATE INDEX IF NOT EXISTS idx_documents_next_reading_date ON documents(next_reading_date);

        -- Create composite index for common queue queries
        -- This optimizes queries that filter by is_archived and sort by next_reading_date
        CREATE INDEX IF NOT EXISTS idx_documents_archived_next_reading ON documents(is_archived, next_reading_date);
        "#,
    ),
    // Migration 015: Add document cover metadata
    Migration::new(
        "015_add_document_cover_metadata",
        r#"
        ALTER TABLE documents ADD COLUMN cover_image_url TEXT;
        ALTER TABLE documents ADD COLUMN cover_image_source TEXT;
        "#,
    ),
    // Migration 016: Add document view state
    Migration::new(
        "016_add_document_view_state",
        r#"
        ALTER TABLE documents ADD COLUMN current_view_state TEXT;
        "#,
    ),
    // Migration 017: Add rich HTML content support for extracts and documents
    Migration::new(
        "017_add_rich_html_content",
        r#"
        -- Add html_content field for preserving rich HTML with inline styles
        ALTER TABLE extracts ADD COLUMN html_content TEXT;

        -- Add source_url for tracking the origin of web extracts
        ALTER TABLE extracts ADD COLUMN source_url TEXT;

        -- Add html_content field for documents (full page HTML preservation)
        ALTER TABLE documents ADD COLUMN html_content TEXT;
        "#,
    ),
    // Migration 018: Add document progress tracking columns
    Migration::new(
        "018_add_document_progress_columns",
        r#"
        -- Add scroll percentage for tracking reading progress
        ALTER TABLE documents ADD COLUMN current_scroll_percent REAL;

        -- Add CFI (Canonical Fragment Identifier) for EPUB position tracking
        ALTER TABLE documents ADD COLUMN current_cfi TEXT;
        "#,
    ),
    // Migration 019: Add unified position tracking
    Migration::new(
        "019_add_unified_position_tracking",
        r#"
        -- Add position_json column for unified DocumentPosition storage
        -- This will store serialized position data for all document types
        ALTER TABLE documents ADD COLUMN position_json TEXT;

        -- Add progress_percent for quick progress queries (0.0 to 100.0)
        ALTER TABLE documents ADD COLUMN progress_percent REAL DEFAULT 0.0;

        -- Create index for progress-based queries (Continue Reading)
        CREATE INDEX IF NOT EXISTS idx_documents_progress ON documents(progress_percent, date_modified);
        "#,
    ),
    // Migration 020: Create bookmarks table
    Migration::new(
        "020_add_bookmarks_table",
        r#"
        CREATE TABLE IF NOT EXISTS bookmarks (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            name TEXT NOT NULL,
            position_json TEXT NOT NULL,
            position_type TEXT NOT NULL,
            thumbnail TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_bookmarks_document_id ON bookmarks(document_id);
        CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at ON bookmarks(created_at);
        "#,
    ),
    // Migration 021: Create reading_sessions table
    Migration::new(
        "021_add_reading_sessions_table",
        r#"
        CREATE TABLE IF NOT EXISTS reading_sessions (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            pages_read INTEGER DEFAULT 0,
            progress_start REAL DEFAULT 0.0,
            progress_end REAL DEFAULT 0.0,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_reading_sessions_document_id ON reading_sessions(document_id);
        CREATE INDEX IF NOT EXISTS idx_reading_sessions_started_at ON reading_sessions(started_at);

        -- Create view for daily reading stats (used for streaks and goals)
        CREATE VIEW IF NOT EXISTS daily_reading_stats AS
        SELECT
            DATE(started_at) as reading_date,
            SUM(duration_seconds) as total_seconds,
            COUNT(DISTINCT document_id) as documents_read,
            SUM(pages_read) as total_pages_read,
            COUNT(*) as session_count
        FROM reading_sessions
        WHERE ended_at IS NOT NULL
        GROUP BY DATE(started_at);
        "#,
    ),
    // Migration 022: Create reading_goals table
    Migration::new(
        "022_add_reading_goals_table",
        r#"
        CREATE TABLE IF NOT EXISTS reading_goals (
            id TEXT PRIMARY KEY,
            goal_type TEXT NOT NULL, -- 'daily_minutes', 'daily_pages', 'weekly_minutes'
            target_value INTEGER NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            modified_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_reading_goals_active ON reading_goals(is_active);

        -- Create goal progress tracking table
        CREATE TABLE IF NOT EXISTS goal_progress (
            id TEXT PRIMARY KEY,
            goal_id TEXT NOT NULL,
            date TEXT NOT NULL,
            current_value REAL NOT NULL DEFAULT 0.0,
            is_completed INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (goal_id) REFERENCES reading_goals(id) ON DELETE CASCADE,
            UNIQUE(goal_id, date)
        );

        CREATE INDEX IF NOT EXISTS idx_goal_progress_goal_date ON goal_progress(goal_id, date);
        "#,
    ),
    // Migration 023: Create collections tables
    Migration::new(
        "023_add_collections_tables",
        r#"
        CREATE TABLE IF NOT EXISTS collections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT,
            collection_type TEXT NOT NULL DEFAULT 'manual', -- 'manual' or 'smart'
            filter_query TEXT, -- For smart collections
            icon TEXT,
            color TEXT,
            created_at TEXT NOT NULL,
            modified_at TEXT NOT NULL,
            FOREIGN KEY (parent_id) REFERENCES collections(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_collections_parent_id ON collections(parent_id);
        CREATE INDEX IF NOT EXISTS idx_collections_type ON collections(collection_type);

        -- Document-collection junction table
        CREATE TABLE IF NOT EXISTS document_collections (
            document_id TEXT NOT NULL,
            collection_id TEXT NOT NULL,
            added_at TEXT NOT NULL,
            PRIMARY KEY (document_id, collection_id),
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
            FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_doc_collections_document ON document_collections(document_id);
        CREATE INDEX IF NOT EXISTS idx_doc_collections_collection ON document_collections(collection_id);
        "#,
    ),
    // Migration 024: Create full-text search index
    Migration::new(
        "024_add_fulltext_search",
        r#"
        -- Drop any existing triggers first (in case this migration is being re-run)
        DROP TRIGGER IF EXISTS document_search_insert;
        DROP TRIGGER IF EXISTS document_search_update;
        DROP TRIGGER IF EXISTS document_search_delete;
        DROP TRIGGER IF EXISTS extract_search_insert;
        DROP TRIGGER IF EXISTS extract_search_update;
        DROP TRIGGER IF EXISTS extract_search_delete;

        -- Drop existing FTS5 tables if they exist (for clean re-creation)
        DROP TABLE IF EXISTS document_search;
        DROP TABLE IF EXISTS extract_search;

        -- Create FTS5 virtual table for document search
        -- Note: This may fail if FTS5 is not available, so we use a try-catch approach
        CREATE VIRTUAL TABLE IF NOT EXISTS document_search USING fts5(
            document_id UNINDEXED,
            title,
            content,
            content_type,
            tokenize = 'porter unicode61'
        );

        -- Backfill existing documents
        INSERT INTO document_search(document_id, title, content, content_type)
        SELECT id, title, COALESCE(content, ''), file_type FROM documents;

        -- Create triggers to keep search index in sync
        CREATE TRIGGER IF NOT EXISTS document_search_insert AFTER INSERT ON documents BEGIN
            INSERT INTO document_search(document_id, title, content, content_type)
            VALUES (NEW.id, NEW.title, COALESCE(NEW.content, ''), NEW.file_type);
        END;

        CREATE TRIGGER IF NOT EXISTS document_search_update AFTER UPDATE OF title, content, file_type ON documents BEGIN
            UPDATE document_search SET
                title = NEW.title,
                content = COALESCE(NEW.content, ''),
                content_type = NEW.file_type
            WHERE document_id = NEW.id;
        END;

        CREATE TRIGGER IF NOT EXISTS document_search_delete AFTER DELETE ON documents BEGIN
            DELETE FROM document_search WHERE document_id = OLD.id;
        END;

        -- Index extracts for search as well
        CREATE VIRTUAL TABLE IF NOT EXISTS extract_search USING fts5(
            extract_id UNINDEXED,
            document_id UNINDEXED,
            content,
            tokenize = 'porter unicode61'
        );

        -- Backfill existing extracts
        INSERT INTO extract_search(extract_id, document_id, content)
        SELECT id, document_id, content FROM extracts;

        CREATE TRIGGER IF NOT EXISTS extract_search_insert AFTER INSERT ON extracts BEGIN
            INSERT INTO extract_search(extract_id, document_id, content)
            VALUES (NEW.id, NEW.document_id, NEW.content);
        END;

        CREATE TRIGGER IF NOT EXISTS extract_search_update AFTER UPDATE OF content ON extracts BEGIN
            UPDATE extract_search SET content = NEW.content WHERE extract_id = NEW.id;
        END;

        CREATE TRIGGER IF NOT EXISTS extract_search_delete AFTER DELETE ON extracts BEGIN
            DELETE FROM extract_search WHERE extract_id = OLD.id;
        END;
        "#,
    ),
    // Migration 025: Backfill position_json from existing fields
    Migration::new(
        "025_backfill_position_json",
        r#"
        -- Backfill position_json from existing position fields for documents
        -- This ensures existing data is migrated to the new unified format
        UPDATE documents
        SET position_json = json_object(
            'type', CASE
                WHEN file_type = 'pdf' THEN 'page'
                WHEN file_type = 'epub' THEN 'cfi'
                WHEN file_type IN ('youtube', 'video') THEN 'time'
                ELSE 'scroll'
            END,
            'page', COALESCE(current_page, 0),
            'cfi', COALESCE(current_cfi, ''),
            'percent', COALESCE(current_scroll_percent, 0.0)
        )
        WHERE position_json IS NULL
        AND (current_page IS NOT NULL OR current_scroll_percent IS NOT NULL OR current_cfi IS NOT NULL);

        -- Calculate progress_percent for PDF documents
        UPDATE documents
        SET progress_percent = CASE
            WHEN total_pages > 0 AND current_page > 0 THEN (CAST(current_page AS REAL) / CAST(total_pages AS REAL)) * 100.0
            WHEN current_scroll_percent > 0 THEN current_scroll_percent
            ELSE 0.0
        END
        WHERE progress_percent = 0.0
        AND (current_page IS NOT NULL OR current_scroll_percent IS NOT NULL);
        "#,
    ),
    // Migration 026: Add video features tables
    Migration::new(
        "026_add_video_features",
        r#"
        -- Video bookmarks table for timestamped bookmarks
        CREATE TABLE IF NOT EXISTS video_bookmarks (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            title TEXT NOT NULL,
            time REAL NOT NULL,
            thumbnail TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_video_bookmarks_document_id ON video_bookmarks(document_id);
        CREATE INDEX IF NOT EXISTS idx_video_bookmarks_time ON video_bookmarks(time);

        -- Video chapters table for chapter navigation
        CREATE TABLE IF NOT EXISTS video_chapters (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            title TEXT NOT NULL,
            start_time REAL NOT NULL,
            end_time REAL NOT NULL,
            order_index INTEGER NOT NULL,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_video_chapters_document_id ON video_chapters(document_id);
        CREATE INDEX IF NOT EXISTS idx_video_chapters_order ON video_chapters(order_index);

        -- Video transcripts table for transcript storage
        CREATE TABLE IF NOT EXISTS video_transcripts (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            transcript TEXT NOT NULL,
            segments_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_video_transcripts_document_id ON video_transcripts(document_id);
        "#,
    ),
    // Migration 027: Add YouTube playlist subscriptions for auto-import
    Migration::new(
        "027_add_youtube_playlist_subscriptions",
        r#"
        -- YouTube playlist subscriptions table
        -- Tracks playlists that users want to auto-import from
        CREATE TABLE IF NOT EXISTS youtube_playlist_subscriptions (
            id TEXT PRIMARY KEY,
            playlist_id TEXT NOT NULL UNIQUE,  -- YouTube playlist ID (e.g., PL...)
            playlist_url TEXT NOT NULL,
            title TEXT,
            channel_name TEXT,
            channel_id TEXT,
            description TEXT,
            thumbnail_url TEXT,
            total_videos INTEGER,
            
            -- Auto-import settings
            is_active INTEGER NOT NULL DEFAULT 1,
            auto_import_new INTEGER NOT NULL DEFAULT 1,  -- Auto-import new videos when refreshing
            queue_intersperse_interval INTEGER NOT NULL DEFAULT 5,  -- Add to queue every N items
            priority_rating INTEGER NOT NULL DEFAULT 5,  -- Default priority for imported videos
            
            -- Refresh tracking
            last_refreshed_at TEXT,
            refresh_interval_hours INTEGER NOT NULL DEFAULT 24,  -- How often to check for new videos
            
            -- Metadata
            created_at TEXT NOT NULL,
            modified_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_youtube_playlist_subs_active ON youtube_playlist_subscriptions(is_active);
        CREATE INDEX IF NOT EXISTS idx_youtube_playlist_subs_id ON youtube_playlist_subscriptions(playlist_id);

        -- Track which videos from playlists have been imported
        CREATE TABLE IF NOT EXISTS youtube_playlist_videos (
            id TEXT PRIMARY KEY,
            subscription_id TEXT NOT NULL,
            video_id TEXT NOT NULL,  -- YouTube video ID (11 chars)
            video_title TEXT,
            video_duration INTEGER,  -- in seconds
            thumbnail_url TEXT,
            position INTEGER,  -- Position in playlist (0-indexed)
            
            -- Import status
            is_imported INTEGER NOT NULL DEFAULT 0,
            document_id TEXT,  -- Reference to documents table when imported
            
            -- Queue interspersion tracking
            added_to_queue INTEGER NOT NULL DEFAULT 0,
            queue_position INTEGER,  -- Position in queue (for interspersion calculation)
            
            -- Metadata
            published_at TEXT,
            discovered_at TEXT NOT NULL,
            imported_at TEXT,
            
            FOREIGN KEY (subscription_id) REFERENCES youtube_playlist_subscriptions(id) ON DELETE CASCADE,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
            UNIQUE(subscription_id, video_id)
        );

        CREATE INDEX IF NOT EXISTS idx_youtube_playlist_videos_sub ON youtube_playlist_videos(subscription_id);
        CREATE INDEX IF NOT EXISTS idx_youtube_playlist_videos_imported ON youtube_playlist_videos(is_imported);
        CREATE INDEX IF NOT EXISTS idx_youtube_playlist_videos_queue ON youtube_playlist_videos(added_to_queue);
        CREATE INDEX IF NOT EXISTS idx_youtube_playlist_videos_video_id ON youtube_playlist_videos(video_id);

        -- Queue interspersion settings table (global settings)
        CREATE TABLE IF NOT EXISTS youtube_playlist_settings (
            id TEXT PRIMARY KEY DEFAULT 'global',
            enabled INTEGER NOT NULL DEFAULT 1,
            default_intersperse_interval INTEGER NOT NULL DEFAULT 5,
            default_priority INTEGER NOT NULL DEFAULT 5,
            max_consecutive_playlist_videos INTEGER NOT NULL DEFAULT 1,  -- Never add more than N consecutive
            prefer_new_videos INTEGER NOT NULL DEFAULT 1,  -- Prioritize newer videos
            created_at TEXT NOT NULL,
            modified_at TEXT NOT NULL
        );

        -- Insert default settings
        INSERT OR IGNORE INTO youtube_playlist_settings (id, enabled, default_intersperse_interval, default_priority, max_consecutive_playlist_videos, prefer_new_videos, created_at, modified_at)
        VALUES ('global', 1, 5, 5, 1, 1, datetime('now'), datetime('now'));
        "#,
    ),
    // Migration 028: Add document scheduling columns for incremental reading
    Migration::new(
        "028_add_document_scheduling_columns",
        r#"
        -- Number of times this document has been read
        ALTER TABLE documents ADD COLUMN reading_count INTEGER NOT NULL DEFAULT 0;

        -- FSRS stability (how long memory lasts, in days)
        ALTER TABLE documents ADD COLUMN stability REAL;

        -- FSRS difficulty (1-10 scale)
        ALTER TABLE documents ADD COLUMN difficulty REAL;

        -- Total repetitions/reviews
        ALTER TABLE documents ADD COLUMN reps INTEGER;

        -- Total time spent reading (in seconds)
        ALTER TABLE documents ADD COLUMN total_time_spent INTEGER;

        -- Consecutive rating count for incremental scheduler
        -- Positive = consecutive good/easy ratings, Negative = consecutive again/hard ratings
        ALTER TABLE documents ADD COLUMN consecutive_count INTEGER;
        "#,
    ),
    // Migration 029: Add selection context to extracts
    Migration::new(
        "029_add_extract_selection_context",
        r#"
        ALTER TABLE extracts ADD COLUMN selection_context TEXT;
        "#,
    ),
    // Migration 030: Fix FTS5 search tables and triggers
    Migration::new(
        "030_fix_fts5_triggers",
        r#"
        -- Drop any orphaned triggers that might reference missing tables
        DROP TRIGGER IF EXISTS document_search_insert;
        DROP TRIGGER IF EXISTS document_search_update;
        DROP TRIGGER IF EXISTS document_search_delete;
        DROP TRIGGER IF EXISTS extract_search_insert;
        DROP TRIGGER IF EXISTS extract_search_update;
        DROP TRIGGER IF EXISTS extract_search_delete;

        -- Recreate FTS5 tables if they don't exist or are broken
        -- First, drop them to ensure clean state
        DROP TABLE IF EXISTS document_search;
        DROP TABLE IF EXISTS extract_search;

        -- Create FTS5 virtual table for document search
        CREATE VIRTUAL TABLE IF NOT EXISTS document_search USING fts5(
            document_id UNINDEXED,
            title,
            content,
            content_type,
            tokenize = 'porter unicode61'
        );

        -- Backfill existing documents
        INSERT OR IGNORE INTO document_search(document_id, title, content, content_type)
        SELECT id, title, COALESCE(content, ''), file_type FROM documents;

        -- Create triggers to keep search index in sync
        CREATE TRIGGER IF NOT EXISTS document_search_insert AFTER INSERT ON documents BEGIN
            INSERT INTO document_search(document_id, title, content, content_type)
            VALUES (NEW.id, NEW.title, COALESCE(NEW.content, ''), NEW.file_type);
        END;

        CREATE TRIGGER IF NOT EXISTS document_search_update AFTER UPDATE OF title, content, file_type ON documents BEGIN
            UPDATE document_search SET
                title = NEW.title,
                content = COALESCE(NEW.content, ''),
                content_type = NEW.file_type
            WHERE document_id = NEW.id;
        END;

        CREATE TRIGGER IF NOT EXISTS document_search_delete AFTER DELETE ON documents BEGIN
            DELETE FROM document_search WHERE document_id = OLD.id;
        END;

        -- Index extracts for search as well
        CREATE VIRTUAL TABLE IF NOT EXISTS extract_search USING fts5(
            extract_id UNINDEXED,
            document_id UNINDEXED,
            content,
            tokenize = 'porter unicode61'
        );

        -- Backfill existing extracts
        INSERT OR IGNORE INTO extract_search(extract_id, document_id, content)
        SELECT id, document_id, content FROM extracts;

        CREATE TRIGGER IF NOT EXISTS extract_search_insert AFTER INSERT ON extracts BEGIN
            INSERT INTO extract_search(extract_id, document_id, content)
            VALUES (NEW.id, NEW.document_id, NEW.content);
        END;

        CREATE TRIGGER IF NOT EXISTS extract_search_update AFTER UPDATE OF content ON extracts BEGIN
            UPDATE extract_search SET content = NEW.content WHERE extract_id = NEW.id;
        END;

        CREATE TRIGGER IF NOT EXISTS extract_search_delete AFTER DELETE ON extracts BEGIN
            DELETE FROM extract_search WHERE extract_id = OLD.id;
        END;
        "#,
    ),
    // Migration 031: Add video_extracts table for timestamp-linked video segments
    Migration::new(
        "031_add_video_extracts",
        r#"
        -- Video extracts table for timestamp-linked video segments with FSRS scheduling
        CREATE TABLE IF NOT EXISTS video_extracts (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            start_time REAL NOT NULL,
            end_time REAL NOT NULL,
            title TEXT NOT NULL,
            transcript_text TEXT,
            notes TEXT,
            tags TEXT NOT NULL DEFAULT '[]',
            thumbnail_url TEXT,
            -- FSRS memory state (stability and difficulty)
            memory_state TEXT,
            -- Scheduling fields for FSRS
            next_review_date TEXT,
            last_review_date TEXT,
            review_count INTEGER NOT NULL DEFAULT 0,
            reps INTEGER NOT NULL DEFAULT 0,
            -- Metadata
            date_created TEXT NOT NULL,
            date_modified TEXT NOT NULL,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_video_extracts_document ON video_extracts(document_id);
        CREATE INDEX IF NOT EXISTS idx_video_extracts_next_review ON video_extracts(next_review_date);
        "#,
    ),
    // Migration 032: Add transcription tables for Whisper jobs
    Migration::new(
        "032_add_transcription",
        r#"
        CREATE TABLE IF NOT EXISTS transcripts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id TEXT NOT NULL,
            chapter_id TEXT NOT NULL,
            model_used TEXT NOT NULL,
            language TEXT NOT NULL,
            status TEXT NOT NULL, -- 'pending', 'processing', 'completed', 'failed'
            error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(book_id, chapter_id)
        );

        CREATE TABLE IF NOT EXISTS transcript_segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transcript_id INTEGER NOT NULL,
            start_ms INTEGER NOT NULL,
            end_ms INTEGER NOT NULL,
            text TEXT NOT NULL,
            confidence REAL,
            FOREIGN KEY(transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_transcript_segments_time
        ON transcript_segments(transcript_id, start_ms);
        "#,
    ),
    // Migration 028: Remove foreign key constraint on extracts.category
    // The category field should be free-form text, not a reference to categories table
    Migration::new(
        "028_remove_extract_category_fk",
        r#"
        -- SQLite doesn't support dropping foreign keys directly, so we need to recreate the table
        -- Step 1: Create new table without the foreign key constraint
        CREATE TABLE IF NOT EXISTS extracts_new (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            content TEXT NOT NULL,
            page_title TEXT,
            page_number INTEGER,
            highlight_color TEXT,
            notes TEXT,
            progressive_disclosure_level INTEGER NOT NULL DEFAULT 0,
            max_disclosure_level INTEGER NOT NULL DEFAULT 3,
            date_created TEXT NOT NULL,
            date_modified TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]',
            category TEXT,
            char_count INTEGER,
            word_count INTEGER,
            summary TEXT,
            key_points TEXT,
            memory_state_stability REAL,
            memory_state_difficulty REAL,
            next_review_date TEXT,
            last_review_date TEXT,
            review_count INTEGER NOT NULL DEFAULT 0,
            reps INTEGER NOT NULL DEFAULT 0,
            html_content TEXT,
            source_url TEXT,
            selection_context TEXT,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        -- Step 2: Copy data from old table
        INSERT INTO extracts_new SELECT * FROM extracts;

        -- Step 3: Drop old table
        DROP TABLE extracts;

        -- Step 4: Rename new table
        ALTER TABLE extracts_new RENAME TO extracts;

        -- Step 5: Recreate indexes
        CREATE INDEX IF NOT EXISTS idx_extracts_document_id ON extracts(document_id);
        CREATE INDEX IF NOT EXISTS idx_extracts_page_number ON extracts(page_number);
        CREATE INDEX IF NOT EXISTS idx_extracts_next_review ON extracts(next_review_date);

        -- Step 6: Recreate FTS5 triggers for extracts
        DROP TRIGGER IF EXISTS extract_search_insert;
        DROP TRIGGER IF EXISTS extract_search_update;
        DROP TRIGGER IF EXISTS extract_search_delete;

        CREATE TRIGGER IF NOT EXISTS extract_search_insert AFTER INSERT ON extracts BEGIN
            INSERT INTO extract_search(extract_id, document_id, content)
            VALUES (NEW.id, NEW.document_id, NEW.content);
        END;

        CREATE TRIGGER IF NOT EXISTS extract_search_update AFTER UPDATE OF content ON extracts BEGIN
            UPDATE extract_search SET content = NEW.content WHERE extract_id = NEW.id;
        END;

        CREATE TRIGGER IF NOT EXISTS extract_search_delete AFTER DELETE ON extracts BEGIN
            DELETE FROM extract_search WHERE extract_id = OLD.id;
        END;
        "#,
    ),
    // Migration 029: Add is_dismissed column to documents table
    Migration::new(
        "029_add_document_is_dismissed",
        r#"
        -- Add is_dismissed column to documents table
        ALTER TABLE documents ADD COLUMN is_dismissed INTEGER NOT NULL DEFAULT 0;

        -- Create index for filtering dismissed documents
        CREATE INDEX IF NOT EXISTS idx_documents_is_dismissed ON documents(is_dismissed);
        "#,
    ),
    // Migration 033: Add image registry and flashcard image references
    Migration::new(
        "033_add_image_registry",
        r#"
        CREATE TABLE IF NOT EXISTS image_assets (
            id TEXT PRIMARY KEY,
            mime_type TEXT NOT NULL,
            file_name TEXT,
            content BLOB NOT NULL,
            byte_size INTEGER NOT NULL,
            sha256 TEXT NOT NULL UNIQUE,
            width INTEGER,
            height INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_image_assets_created_at ON image_assets(created_at);
        CREATE INDEX IF NOT EXISTS idx_image_assets_sha256 ON image_assets(sha256);

        ALTER TABLE learning_items ADD COLUMN image_asset_ids TEXT NOT NULL DEFAULT '[]';
        "#,
    ),
    // Migration 034: Add algorithm selection fields to learning items
    Migration::new(
        "034_add_algorithm_fields",
        r#"
        ALTER TABLE learning_items ADD COLUMN algorithm_type TEXT NOT NULL DEFAULT 'fsrs';
        ALTER TABLE learning_items ADD COLUMN algorithm_state TEXT;
        "#,
    ),
    Migration::new(
        "035_add_learning_item_interaction_metadata",
        r#"
        ALTER TABLE learning_items ADD COLUMN interaction_metadata TEXT;
        "#,
    ),
    Migration::new(
        "036_add_progressive_summaries",
        r#"
        ALTER TABLE extracts ADD COLUMN progressive_summaries TEXT;
        "#,
    ),
    // Migration 037: Add RSS full content fetching columns
    Migration::new(
        "037_add_rss_full_content",
        r#"
        -- Add full content fields to RSS articles for storing extracted article HTML
        ALTER TABLE rss_articles ADD COLUMN full_content TEXT;
        ALTER TABLE rss_articles ADD COLUMN full_content_fetched_at TEXT;

        -- Add auto-fetch preference to RSS feeds (always, favorites, manual)
        ALTER TABLE rss_feeds ADD COLUMN auto_fetch_full_content TEXT DEFAULT 'manual';

        -- Create index for fetching articles by content fetch status
        CREATE INDEX IF NOT EXISTS idx_rss_articles_full_content_fetched ON rss_articles(full_content_fetched_at);
        "#,
    ),
    Migration::new(
        "038_remove_document_category_fk",
        r#"
        -- SQLite doesn't support dropping foreign keys directly, so recreate the table
        -- Step 1: Create new table without the foreign key constraint on category
        CREATE TABLE IF NOT EXISTS documents_new (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_type TEXT NOT NULL,
            content TEXT,
            content_hash TEXT,
            total_pages INTEGER,
            current_page INTEGER,
            current_scroll_percent REAL,
            current_cfi TEXT,
            current_view_state TEXT,
            position_json TEXT,
            progress_percent REAL DEFAULT 0.0,
            category TEXT,
            tags TEXT NOT NULL DEFAULT '[]',
            date_added TEXT NOT NULL,
            date_modified TEXT NOT NULL,
            date_last_reviewed TEXT,
            extract_count INTEGER NOT NULL DEFAULT 0,
            learning_item_count INTEGER NOT NULL DEFAULT 0,
            priority_rating INTEGER NOT NULL DEFAULT 0,
            priority_slider INTEGER NOT NULL DEFAULT 0,
            priority_score REAL NOT NULL DEFAULT 0,
            is_archived INTEGER NOT NULL DEFAULT 0,
            is_favorite INTEGER NOT NULL DEFAULT 0,
            is_dismissed INTEGER NOT NULL DEFAULT 0,
            metadata TEXT,
            cover_image_url TEXT,
            cover_image_source TEXT,
            language TEXT,
            word_count INTEGER,
            reading_time INTEGER,
            source_url TEXT,
            author TEXT,
            next_reading_date TEXT,
            html_content TEXT,
            reading_count INTEGER NOT NULL DEFAULT 0,
            stability REAL,
            difficulty REAL,
            reps INTEGER,
            total_time_spent INTEGER,
            consecutive_count INTEGER
        );

        -- Step 2: Copy data from old table (explicit column list to avoid order mismatch)
        INSERT INTO documents_new (
            id, title, file_path, file_type, content, content_hash, total_pages, current_page,
            category, tags, date_added, date_modified, date_last_reviewed,
            extract_count, learning_item_count, priority_score, is_archived, is_favorite, metadata,
            language, word_count, reading_time, source_url, author,
            priority_rating, priority_slider, next_reading_date,
            cover_image_url, cover_image_source, current_view_state,
            html_content, current_scroll_percent, current_cfi, position_json, progress_percent,
            reading_count, stability, difficulty, reps, total_time_spent, consecutive_count,
            is_dismissed
        )
        SELECT
            id, title, file_path, file_type, content, content_hash, total_pages, current_page,
            category, tags, date_added, date_modified, date_last_reviewed,
            extract_count, learning_item_count, priority_score, is_archived, is_favorite, metadata,
            language, word_count, reading_time, source_url, author,
            priority_rating, priority_slider, next_reading_date,
            cover_image_url, cover_image_source, current_view_state,
            html_content, current_scroll_percent, current_cfi, position_json, progress_percent,
            reading_count, stability, difficulty, reps, total_time_spent, consecutive_count,
            is_dismissed
        FROM documents;

        -- Step 3: Drop old table
        DROP TABLE documents;

        -- Step 4: Rename new table
        ALTER TABLE documents_new RENAME TO documents;

        -- Step 5: Recreate indexes
        CREATE INDEX IF NOT EXISTS idx_documents_date_added ON documents(date_added);
        CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
        CREATE INDEX IF NOT EXISTS idx_documents_file_type ON documents(file_type);
        CREATE INDEX IF NOT EXISTS idx_documents_is_archived ON documents(is_archived);
        CREATE INDEX IF NOT EXISTS idx_documents_is_dismissed ON documents(is_dismissed);
        "#,
    ),
    // Migration 039: Add NewsBlur-inspired RSS features
    // Classifiers, folders, tags, annotations, clusters, discovery, FTS5, and new columns
    Migration::new(
        "039_add_newsblur_rss_features",
        r#"
        -- 1.1: rss_classifiers — intelligence training data
        CREATE TABLE IF NOT EXISTS rss_classifiers (
            id TEXT PRIMARY KEY,
            feed_id TEXT NOT NULL,
            classifier_type TEXT NOT NULL CHECK(classifier_type IN ('author', 'title', 'tag', 'feed')),
            value TEXT NOT NULL,
            sentiment TEXT NOT NULL CHECK(sentiment IN ('like', 'dislike', 'neutral')),
            scope TEXT NOT NULL DEFAULT 'feed' CHECK(scope IN ('feed', 'folder', 'global')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rss_classifiers_feed ON rss_classifiers(feed_id);
        CREATE INDEX IF NOT EXISTS idx_rss_classifiers_type ON rss_classifiers(classifier_type, sentiment);
        CREATE INDEX IF NOT EXISTS idx_rss_classifiers_scope ON rss_classifiers(scope);

        -- 1.2: rss_folders — replaces localStorage folders, supports nesting
        CREATE TABLE IF NOT EXISTS rss_folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT,
            icon TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            auto_mark_after_days INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY (parent_id) REFERENCES rss_folders(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rss_folders_parent ON rss_folders(parent_id);
        CREATE INDEX IF NOT EXISTS idx_rss_folders_sort ON rss_folders(sort_order);

        -- Junction table: feeds in folders
        CREATE TABLE IF NOT EXISTS rss_feed_folders (
            feed_id TEXT NOT NULL,
            folder_id TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (feed_id, folder_id),
            FOREIGN KEY (feed_id) REFERENCES rss_feeds(id) ON DELETE CASCADE,
            FOREIGN KEY (folder_id) REFERENCES rss_folders(id) ON DELETE CASCADE
        );

        -- 1.3: rss_tags and rss_article_tags
        CREATE TABLE IF NOT EXISTS rss_tags (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rss_article_tags (
            article_id TEXT NOT NULL,
            tag_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (article_id, tag_id),
            FOREIGN KEY (article_id) REFERENCES rss_articles(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES rss_tags(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_rss_article_tags_tag ON rss_article_tags(tag_id);

        -- 1.4: rss_annotations — highlights and notes
        CREATE TABLE IF NOT EXISTS rss_annotations (
            id TEXT PRIMARY KEY,
            article_id TEXT NOT NULL,
            annotation_type TEXT NOT NULL CHECK(annotation_type IN ('highlight', 'note', 'share')),
            content TEXT NOT NULL,
            start_offset INTEGER,
            end_offset INTEGER,
            color TEXT DEFAULT '#FFFF00',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (article_id) REFERENCES rss_articles(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_rss_annotations_article ON rss_annotations(article_id);
        CREATE INDEX IF NOT EXISTS idx_rss_annotations_type ON rss_annotations(annotation_type);

        -- 1.5: rss_story_clusters — duplicate/related detection
        CREATE TABLE IF NOT EXISTS rss_story_clusters (
            id TEXT PRIMARY KEY,
            canonical_article_id TEXT NOT NULL,
            article_id TEXT NOT NULL,
            similarity_score REAL NOT NULL,
            cluster_type TEXT NOT NULL CHECK(cluster_type IN ('duplicate', 'related')),
            created_at TEXT NOT NULL,
            FOREIGN KEY (canonical_article_id) REFERENCES rss_articles(id) ON DELETE CASCADE,
            FOREIGN KEY (article_id) REFERENCES rss_articles(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_rss_clusters_canonical ON rss_story_clusters(canonical_article_id);
        CREATE INDEX IF NOT EXISTS idx_rss_clusters_article ON rss_story_clusters(article_id);

        -- 1.6: rss_discovered_sites — site discovery cache
        CREATE TABLE IF NOT EXISTS rss_discovered_sites (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            title TEXT,
            description TEXT,
            feed_url TEXT,
            similarity_source TEXT,
            discovered_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rss_discovered_url ON rss_discovered_sites(url);

        -- 1.7: Add intelligence score columns to rss_articles
        ALTER TABLE rss_articles ADD COLUMN intelligence_score REAL DEFAULT 0;
        ALTER TABLE rss_articles ADD COLUMN intelligence_score_computed_at TEXT;

        -- 1.8: Add view_mode and layout columns to rss_feeds
        ALTER TABLE rss_feeds ADD COLUMN view_mode TEXT DEFAULT 'feed' CHECK(view_mode IN ('feed', 'original', 'text', 'story'));
        ALTER TABLE rss_feeds ADD COLUMN layout TEXT DEFAULT 'list' CHECK(layout IN ('list', 'card', 'compact', 'magazine', 'grid'));

        -- 3.4: Add auto_mark_after_days to rss_feeds
        ALTER TABLE rss_feeds ADD COLUMN auto_mark_after_days INTEGER DEFAULT NULL;

        -- 1.10: FTS5 full-text search virtual table for RSS articles
        CREATE VIRTUAL TABLE IF NOT EXISTS rss_articles_fts USING fts5(
            title,
            content,
            author,
            content=rss_articles,
            content_rowid=rowid,
            tokenize='porter unicode61'
        );

        -- FTS5 sync triggers (INSERT)
        CREATE TRIGGER IF NOT EXISTS rss_articles_fts_insert AFTER INSERT ON rss_articles BEGIN
            INSERT INTO rss_articles_fts(rowid, title, content, author)
            VALUES (NEW.rowid, NEW.title, NEW.content, NEW.author);
        END;

        -- FTS5 sync triggers (DELETE)
        CREATE TRIGGER IF NOT EXISTS rss_articles_fts_delete AFTER DELETE ON rss_articles BEGIN
            INSERT INTO rss_articles_fts(rss_articles_fts, rowid, title, content, author)
            VALUES ('delete', OLD.rowid, OLD.title, OLD.content, OLD.author);
        END;

        -- FTS5 sync triggers (UPDATE)
        CREATE TRIGGER IF NOT EXISTS rss_articles_fts_update AFTER UPDATE ON rss_articles BEGIN
            INSERT INTO rss_articles_fts(rss_articles_fts, rowid, title, content, author)
            VALUES ('delete', OLD.rowid, OLD.title, OLD.content, OLD.author);
            INSERT INTO rss_articles_fts(rowid, title, content, author)
            VALUES (NEW.rowid, NEW.title, NEW.content, NEW.author);
        END;
        "#,
    ),
    // Migration 040: Auto-transcription queue
    Migration::new(
        "040_auto_transcription_queue",
        r#"
        CREATE TABLE IF NOT EXISTS transcription_queue (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            audio_path TEXT NOT NULL,
            provider TEXT NOT NULL DEFAULT 'local',
            model_id TEXT NOT NULL,
            language TEXT NOT NULL DEFAULT 'en',
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
            error_message TEXT,
            priority INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            retry_count INTEGER NOT NULL DEFAULT 0,
            progress INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_transcription_queue_status
        ON transcription_queue(status, priority DESC, created_at ASC);
        CREATE INDEX IF NOT EXISTS idx_transcription_queue_document
        ON transcription_queue(document_id);
        "#,
    ),
    // Migration 041: Add review_log table for Anki revlog import
    Migration::new(
        "041_add_review_log",
        r#"
        CREATE TABLE IF NOT EXISTS review_log (
            id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL,
            rating INTEGER NOT NULL,
            interval_days REAL NOT NULL,
            last_interval_days REAL,
            ease_factor REAL NOT NULL,
            time_ms INTEGER NOT NULL,
            review_type INTEGER NOT NULL,
            source TEXT NOT NULL DEFAULT 'anki-import',
            anki_revlog_id INTEGER,
            timestamp TEXT NOT NULL,
            FOREIGN KEY (item_id) REFERENCES learning_items(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_review_log_item_id ON review_log(item_id);
        CREATE INDEX IF NOT EXISTS idx_review_log_timestamp ON review_log(timestamp);
        "#,
    ),
    // Migration 042: Add source_hash to extracts for import deduplication
    Migration::new(
        "042_add_extract_source_hash",
        r#"
        ALTER TABLE extracts ADD COLUMN source_hash TEXT NULL;
        CREATE INDEX IF NOT EXISTS idx_extracts_source_hash ON extracts(source_hash);
        "#,
    ),
    // Migration 043: Add podcast subscription tables
    Migration::new(
        "043_add_podcast_tables",
        r#"
        CREATE TABLE IF NOT EXISTS podcast_feeds (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            image_url TEXT,
            author TEXT,
            language TEXT,
            link TEXT,
            feed_url TEXT NOT NULL UNIQUE,
            last_fetched TEXT,
            subscribed_at TEXT NOT NULL DEFAULT (datetime('now')),
            sort_order INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS podcast_episodes (
            id TEXT PRIMARY KEY,
            feed_id TEXT NOT NULL REFERENCES podcast_feeds(id) ON DELETE CASCADE,
            guid TEXT,
            title TEXT NOT NULL,
            description TEXT,
            published_date TEXT,
            duration INTEGER,
            audio_url TEXT NOT NULL,
            audio_type TEXT,
            file_size INTEGER,
            image_url TEXT,
            link TEXT,
            played INTEGER NOT NULL DEFAULT 0,
            playback_position REAL DEFAULT 0.0,
            date_added TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(feed_id, guid)
        );

        CREATE INDEX IF NOT EXISTS idx_podcast_episodes_feed ON podcast_episodes(feed_id);
        CREATE INDEX IF NOT EXISTS idx_podcast_episodes_played ON podcast_episodes(feed_id, played);
        CREATE INDEX IF NOT EXISTS idx_podcast_episodes_published ON podcast_episodes(published_date);
        "#,
    ),
    // Migration 044: Add podcast transcript columns
    Migration::new(
        "044_add_podcast_transcript_columns",
        r#"
        -- podcast_episodes transcript columns
        ALTER TABLE podcast_episodes ADD COLUMN transcript_text TEXT DEFAULT NULL;
        ALTER TABLE podcast_episodes ADD COLUMN transcript_status TEXT DEFAULT 'none';
        ALTER TABLE podcast_episodes ADD COLUMN transcript_error TEXT DEFAULT NULL;
        ALTER TABLE podcast_episodes ADD COLUMN transcribed_at TEXT DEFAULT NULL;

        -- podcast_feeds auto-transcribe settings
        ALTER TABLE podcast_feeds ADD COLUMN auto_transcribe INTEGER DEFAULT 0;
        ALTER TABLE podcast_feeds ADD COLUMN transcribe_language TEXT DEFAULT NULL;
        "#,
    ),
    Migration::new(
        "045_add_collection_id_to_tables",
        r#"
        -- Add collection_id to core tables
        ALTER TABLE documents ADD COLUMN collection_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
        ALTER TABLE extracts ADD COLUMN collection_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
        ALTER TABLE learning_items ADD COLUMN collection_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
        ALTER TABLE review_sessions ADD COLUMN collection_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
        ALTER TABLE review_results ADD COLUMN collection_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
        ALTER TABLE annotations ADD COLUMN collection_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
        ALTER TABLE categories ADD COLUMN collection_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

        -- Indexes for collection-scoped queries
        CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection_id);
        CREATE INDEX IF NOT EXISTS idx_extracts_collection ON extracts(collection_id);
        CREATE INDEX IF NOT EXISTS idx_learning_items_collection ON learning_items(collection_id);
        "#,
    ),
    Migration::new(
        "046_cleanup_dead_collection_artifacts",
        r#"
        -- Drop the unused document_collections junction table from migration 023
        DROP TABLE IF EXISTS document_collections;
        "#,
    ),
    Migration::new(
        "047_add_collection_id_to_rss_feeds",
        r#"
        ALTER TABLE rss_feeds ADD COLUMN collection_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
        CREATE INDEX IF NOT EXISTS idx_rss_feeds_collection ON rss_feeds(collection_id);
        "#,
    ),
    // Migration 048: Create tags table for Tag-Aware Scheduling
    Migration::new(
        "048_create_tags_table",
        r#"
        CREATE TABLE IF NOT EXISTS tags (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            prerequisites TEXT NOT NULL DEFAULT '[]',
            maturity_threshold REAL NOT NULL DEFAULT 0.8,
            centroid BLOB,
            coherence REAL,
            item_count INTEGER NOT NULL DEFAULT 0,
            avg_stability REAL,
            mature_count INTEGER NOT NULL DEFAULT 0,
            date_created TEXT NOT NULL,
            date_modified TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
        "#,
    ),
    // Extract priority inheritance (incremental reading priority chain).
    Migration::new(
        "049_add_extract_priority",
        r#"
        ALTER TABLE extracts ADD COLUMN priority_score REAL NOT NULL DEFAULT 0.0;
        UPDATE extracts
        SET priority_score = COALESCE(
            (SELECT d.priority_score FROM documents d WHERE d.id = extracts.document_id),
            0.0
        );
        "#,
    ),
    // Extract dismissed flag (Forget/Dismiss/Done lifecycle).
    Migration::new(
        "050_add_extract_dismissed",
        r#"
        ALTER TABLE extracts ADD COLUMN is_dismissed INTEGER NOT NULL DEFAULT 0;
        "#,
    ),
    // Whole-library RAG chat: chunk-level document embeddings.
    Migration::new(
        "051_add_document_chunk_embeddings",
        r#"
        CREATE TABLE IF NOT EXISTS document_chunk_embeddings (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            chunk_text TEXT NOT NULL,
            embedding BLOB NOT NULL,
            content_hash TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            dimension INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_provider_model
            ON document_chunk_embeddings(provider, model);
        CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_document
            ON document_chunk_embeddings(document_id);
        CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_hash
            ON document_chunk_embeddings(content_hash);
        "#,
    ),
    // Migration 052: Per-segment + word-level timings for podcast transcripts.
    // Previously podcast transcription (run_transcription_job) concatenated all
    // Whisper segments into one text blob and DISCARDED the start_ms/end_ms,
    // so get_podcast_transcript returned a single fake segment spanning the whole
    // episode and the frontend fake-split it proportionally — there were no real
    // timings to sync audio playback highlighting against. This table stores the
    // real per-segment timings (and, when available from Groq word-level
    // transcription, the per-word timings as JSON) so the mobile podcast viewer
    // can highlight words in sync with playback. Mirrors the transcript_segments
    // table (migration 032) but keyed by podcast episode rather than book/chapter.
    Migration::new(
        "052_add_podcast_transcript_segments",
        r#"
        CREATE TABLE IF NOT EXISTS podcast_transcript_segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            episode_id TEXT NOT NULL,
            segment_index INTEGER NOT NULL,
            start_ms INTEGER NOT NULL,
            end_ms INTEGER NOT NULL,
            text TEXT NOT NULL,
            word_timings_json TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_podcast_transcript_segments_episode_time
            ON podcast_transcript_segments(episode_id, start_ms);
        "#,
    ),
    Migration::new(
        "053_sync_state_columns",
        r#"
        -- Cross-device sync support columns. These monotonic sync-clock fields
        -- (written by the frontend via nowHLC()) make safe last-writer-wins and
        -- field-level merges possible across offline devices. Several previously
        -- bare booleans/scalars (rss is_read/is_queued, podcast played/position)
        -- gain transition timestamps so concurrent edits resolve deterministically.

        -- Per-install device id, used in deterministic review ids and as the
        -- tiebreaker in sync-clock comparisons. Single row, created lazily.
        CREATE TABLE IF NOT EXISTS sync_device_id (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            value TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        -- Soft-delete / tombstone mirror for SQLite (belt-and-suspenders for
        -- late joiners alongside the Yjs tombstones).
        CREATE TABLE IF NOT EXISTS sync_tombstones (
            entity TEXT NOT NULL,
            key TEXT NOT NULL,
            deleted_at TEXT NOT NULL,
            PRIMARY KEY (entity, key)
        );
        CREATE INDEX IF NOT EXISTS idx_sync_tombstones_deleted_at ON sync_tombstones(deleted_at);

        -- Flashcards: learning_items is a denormalized SRS projection; whole-row
        -- LWW on updated_at. Backfill from date_modified for existing rows.
        ALTER TABLE learning_items ADD COLUMN updated_at TEXT;
        UPDATE learning_items SET updated_at = COALESCE(date_modified, date_created)
            WHERE updated_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_learning_items_updated_at ON learning_items(updated_at);

        -- Review log: append-only by deterministic id (item_id, reviewed_at_ms,
        -- device_id). The unique index enforces idempotency — INSERT OR IGNORE
        -- collapses replays. reviewed_at_ms holds the canonical event time used
        -- both for the deterministic id and chronological ordering.
        ALTER TABLE review_results ADD COLUMN device_id TEXT;
        ALTER TABLE review_results ADD COLUMN reviewed_at_ms INTEGER;
        UPDATE review_results
            SET reviewed_at_ms = CAST(strftime('%s', timestamp) AS INTEGER) * 1000
            WHERE reviewed_at_ms IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_review_results_deterministic
            ON review_results(item_id, reviewed_at_ms, device_id)
            WHERE reviewed_at_ms IS NOT NULL;

        ALTER TABLE review_sessions ADD COLUMN updated_at TEXT;
        ALTER TABLE review_sessions ADD COLUMN device_id TEXT;

        -- Extracts (upstream of cards; provenance). Whole-row LWW.
        ALTER TABLE extracts ADD COLUMN updated_at TEXT;
        UPDATE extracts SET updated_at = COALESCE(date_modified, date_created)
            WHERE updated_at IS NULL AND date_modified IS NOT NULL;

        -- RSS: article read/starred state gains transition timestamps so two
        -- devices toggling concurrently don't race on bare booleans.
        ALTER TABLE rss_articles ADD COLUMN read_at TEXT;
        ALTER TABLE rss_articles ADD COLUMN unread_at TEXT;
        ALTER TABLE rss_articles ADD COLUMN queued_at TEXT;
        ALTER TABLE rss_articles ADD COLUMN unqueued_at TEXT;
        ALTER TABLE rss_articles ADD COLUMN updated_at TEXT;
        UPDATE rss_articles SET read_at = date_added WHERE is_read = 1 AND read_at IS NULL;

        ALTER TABLE rss_feeds ADD COLUMN updated_at TEXT;
        ALTER TABLE rss_feeds ADD COLUMN deleted_at TEXT;
        UPDATE rss_feeds SET updated_at = date_added WHERE updated_at IS NULL;

        ALTER TABLE rss_folders ADD COLUMN updated_at TEXT;
        ALTER TABLE rss_folders ADD COLUMN deleted_at TEXT;
        UPDATE rss_folders SET updated_at = created_at WHERE updated_at IS NULL;

        ALTER TABLE rss_feed_folders ADD COLUMN updated_at TEXT;
        ALTER TABLE rss_annotations ADD COLUMN deleted_at TEXT;

        -- Podcasts: played/position are high-churn scalars; per-field clocks
        -- (played_at, position_updated_at) drive field-level merge so a position
        -- tick never clobbers a just-set played flag and vice versa.
        -- download_intent is the synced "should be downloaded" flag — each device
        -- honors it subject to its own wifi/storage settings; audio bytes are
        -- never replicated.
        ALTER TABLE podcast_episodes ADD COLUMN played_at TEXT;
        ALTER TABLE podcast_episodes ADD COLUMN unplayed_at TEXT;
        ALTER TABLE podcast_episodes ADD COLUMN position_updated_at TEXT;
        ALTER TABLE podcast_episodes ADD COLUMN download_intent INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE podcast_episodes ADD COLUMN download_intent_at TEXT;
        ALTER TABLE podcast_episodes ADD COLUMN download_intent_device TEXT;
        ALTER TABLE podcast_episodes ADD COLUMN updated_at TEXT;
        UPDATE podcast_episodes SET played_at = date_added WHERE played = 1 AND played_at IS NULL;
        UPDATE podcast_episodes SET position_updated_at = date_added
            WHERE playback_position > 0 AND position_updated_at IS NULL;

        ALTER TABLE podcast_feeds ADD COLUMN updated_at TEXT;
        ALTER TABLE podcast_feeds ADD COLUMN deleted_at TEXT;
        UPDATE podcast_feeds SET updated_at = COALESCE(subscribed_at, datetime('now'))
            WHERE updated_at IS NULL;
        "#,
    ),
    Migration::new(
        "054_dedupe_podcast_episodes",
        r#"
        -- One-time cleanup of podcast episode rows that were duplicated by the
        -- cross-device sync bug fixed alongside this migration. The receiver
        -- used to trust each device's random episode id, so the same logical
        -- episode arrived N times (once per publishing device) and created N
        -- rows. upsert_synced_podcast_episode now resolves the canonical row
        -- by (feed_id, guid) [or (feed_id, audio_url) when guid is missing],
        -- but existing installs already carry the duplicates — this collapses
        -- them.
        --
        -- Strategy per (feed_id, guid) [guid non-null] and per (feed_id,
        -- audio_url) [guid null]: pick a single keeper (the oldest row, which
        -- holds the longest playback/played history), fold the best state from
        -- every duplicate into it, repoint transcript segments, then drop the
        -- rest. Played wins if any copy is played; the latest non-null
        -- played_at/position clock + the max playback_position survive.

        -- guid-bearing episodes: pick the keeper (lowest rowid = oldest insert).
        CREATE TEMP TABLE _ep_dedupe_guid AS
        SELECT keeper_id, dupe_id FROM (
            SELECT
                (SELECT id FROM podcast_episodes e2
                   WHERE e2.feed_id = e.feed_id AND e2.guid = e.guid AND e.guid IS NOT NULL AND e.guid != ''
                   ORDER BY rowid ASC LIMIT 1) AS keeper_id,
                e.id AS dupe_id
            FROM podcast_episodes e
            WHERE e.guid IS NOT NULL AND e.guid != ''
        ) WHERE keeper_id IS NOT NULL AND dupe_id IS NOT NULL AND keeper_id != dupe_id;

        -- NULL/empty-guid episodes: dedupe by (feed_id, audio_url).
        CREATE TEMP TABLE _ep_dedupe_url AS
        SELECT keeper_id, dupe_id FROM (
            SELECT
                (SELECT id FROM podcast_episodes e2
                   WHERE e2.feed_id = e.feed_id AND e2.audio_url = e.audio_url
                     AND (e2.guid IS NULL OR e2.guid = '')
                   ORDER BY rowid ASC LIMIT 1) AS keeper_id,
                e.id AS dupe_id
            FROM podcast_episodes e
            WHERE e.guid IS NULL OR e.guid = ''
        ) WHERE keeper_id IS NOT NULL AND dupe_id IS NOT NULL AND keeper_id != dupe_id;

        -- Fold the most-progressed playback state from each dupe onto its
        -- keeper. Played wins if ANY copy is played; position takes the max;
        -- clocks take the latest non-null.
        UPDATE podcast_episodes
        SET played = 1
        WHERE id IN (SELECT keeper_id FROM _ep_dedupe_guid)
          AND EXISTS (SELECT 1 FROM _ep_dedupe_guid d
                      JOIN podcast_episodes dupe ON dupe.id = d.dupe_id
                      WHERE d.keeper_id = podcast_episodes.id AND dupe.played = 1);
        UPDATE podcast_episodes
        SET played = 1
        WHERE id IN (SELECT keeper_id FROM _ep_dedupe_url)
          AND EXISTS (SELECT 1 FROM _ep_dedupe_url d
                      JOIN podcast_episodes dupe ON dupe.id = d.dupe_id
                      WHERE d.keeper_id = podcast_episodes.id AND dupe.played = 1);

        UPDATE podcast_episodes
        SET playback_position = (
                SELECT MAX(dupe.playback_position) FROM _ep_dedupe_guid d
                JOIN podcast_episodes dupe ON dupe.id = d.dupe_id
                WHERE d.keeper_id = podcast_episodes.id
            )
        WHERE id IN (SELECT keeper_id FROM _ep_dedupe_guid);
        UPDATE podcast_episodes
        SET playback_position = (
                SELECT MAX(dupe.playback_position) FROM _ep_dedupe_url d
                JOIN podcast_episodes dupe ON dupe.id = d.dupe_id
                WHERE d.keeper_id = podcast_episodes.id
            )
        WHERE id IN (SELECT keeper_id FROM _ep_dedupe_url);

        -- Repoint transcript segments onto the keeper, then delete the dupes.
        UPDATE podcast_transcript_segments
        SET episode_id = (SELECT keeper_id FROM _ep_dedupe_guid WHERE dupe_id = podcast_transcript_segments.episode_id)
        WHERE episode_id IN (SELECT dupe_id FROM _ep_dedupe_guid);
        UPDATE podcast_transcript_segments
        SET episode_id = (SELECT keeper_id FROM _ep_dedupe_url WHERE dupe_id = podcast_transcript_segments.episode_id)
        WHERE episode_id IN (SELECT dupe_id FROM _ep_dedupe_url);

        DELETE FROM podcast_episodes WHERE id IN (SELECT dupe_id FROM _ep_dedupe_guid);
        DELETE FROM podcast_episodes WHERE id IN (SELECT dupe_id FROM _ep_dedupe_url);

        DROP TABLE _ep_dedupe_guid;
        DROP TABLE _ep_dedupe_url;
        "#,
    ),
    // Migration 055: Add RSS Reading Lists
    // Reading Lists are named, ordered selections of feed ids used to launch
    // a scoped reading session (Scroll Mode or combined article list). Unlike
    // folders (where a feed lives), a feed may belong to many Reading Lists —
    // they are queries/selections, not containers.
    Migration::new(
        "055_add_rss_reading_lists",
        r#"
        CREATE TABLE IF NOT EXISTS rss_reading_lists (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            feed_ids TEXT NOT NULL DEFAULT '[]',
            icon TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rss_reading_lists_sort
            ON rss_reading_lists(sort_order);
        "#,
    ),
    // Migration 056: durable progressive-sync journal
    //
    // The journal is intentionally separate from entity tables. Local writes
    // can enqueue a compact operation and incoming Yjs records can be applied
    // idempotently in bounded batches without making the CRDT/provider a local
    // availability dependency.
    Migration::new(
        "056_add_progressive_sync_journal",
        r#"
        CREATE TABLE IF NOT EXISTS sync_outbox (
            operation_id TEXT PRIMARY KEY,
            domain TEXT NOT NULL,
            entity_key TEXT NOT NULL,
            operation TEXT NOT NULL,
            payload TEXT,
            clock TEXT NOT NULL,
            payload_hash TEXT,
            created_at TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            last_error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sync_outbox_status_created
            ON sync_outbox(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_sync_outbox_entity
            ON sync_outbox(domain, entity_key, status);

        CREATE TABLE IF NOT EXISTS sync_inbox (
            operation_id TEXT PRIMARY KEY,
            domain TEXT NOT NULL,
            entity_key TEXT NOT NULL,
            operation TEXT NOT NULL,
            payload TEXT,
            received_at TEXT NOT NULL,
            applied_at TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            last_error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sync_inbox_status_received
            ON sync_inbox(status, received_at);

        CREATE TABLE IF NOT EXISTS sync_applied_operations (
            operation_id TEXT PRIMARY KEY,
            domain TEXT NOT NULL,
            entity_key TEXT NOT NULL,
            projection_hash TEXT,
            applied_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sync_applied_domain_key
            ON sync_applied_operations(domain, entity_key, applied_at);

        CREATE TABLE IF NOT EXISTS sync_checkpoints (
            domain TEXT PRIMARY KEY,
            cursor TEXT,
            shard TEXT,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sync_dead_letters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operation_id TEXT NOT NULL,
            domain TEXT NOT NULL,
            payload TEXT,
            error TEXT NOT NULL,
            created_at TEXT NOT NULL,
            retry_at TEXT,
            resolved_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sync_dead_letters_retry
            ON sync_dead_letters(resolved_at, retry_at);

        CREATE TABLE IF NOT EXISTS sync_projection_hashes (
            domain TEXT NOT NULL,
            bucket TEXT NOT NULL,
            projection_hash TEXT NOT NULL,
            record_count INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(domain, bucket)
        );

        CREATE TABLE IF NOT EXISTS sync_migration_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    ),
    // Legacy experimental SM-20 Bayesian matrices. Retained for rollback and
    // backward compatibility; the ensemble uses sm20_m3_matrices instead.
    Migration::new(
        "057_add_sm20_matrices",
        r#"
        CREATE TABLE IF NOT EXISTS sm20_matrices (
            id TEXT PRIMARY KEY,
            collection_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
            interval_matrix BLOB NOT NULL,
            count_matrix BLOB NOT NULL,
            date_modified TEXT NOT NULL
        );
        "#,
    ),
    // SM-20 V4 diagnostic recall fitting — retained for rollback. The ensemble
    // does not use these tables; M2's optimizer runs automatically per-review.
    Migration::new(
        "058_add_sm20_recall_optimizer",
        r#"
        CREATE TABLE IF NOT EXISTS sm20_recall_cells (
            retrievability_bucket INTEGER NOT NULL,
            difficulty_bucket INTEGER NOT NULL,
            total_count INTEGER NOT NULL DEFAULT 0 CHECK(total_count >= 0),
            pass_count INTEGER NOT NULL DEFAULT 0 CHECK(pass_count >= 0 AND pass_count <= total_count),
            date_modified TEXT NOT NULL,
            PRIMARY KEY(retrievability_bucket, difficulty_bucket)
        );

        CREATE TABLE IF NOT EXISTS sm20_optimizer_profiles (
            id TEXT PRIMARY KEY,
            model_version INTEGER NOT NULL,
            optimizer_version INTEGER NOT NULL,
            coefficient_1 REAL NOT NULL,
            coefficient_2 REAL NOT NULL,
            coefficient_3 REAL NOT NULL,
            coefficient_4 REAL NOT NULL,
            objective_score REAL,
            sample_count INTEGER NOT NULL DEFAULT 0,
            activation_state TEXT NOT NULL DEFAULT 'diagnostic',
            last_optimized_at TEXT,
            date_modified TEXT NOT NULL
        );
        "#,
    ),
    // SM-20 ensemble collection-wide state. The true SM-20 algorithm is a
    // 5-model weighted ensemble. M2 (14%) has a stateful optimizer and
    // M3 (45%) has runtime-learned 21³ Bayesian matrices. Both are
    // collection-wide and persisted here as JSON blobs.
    Migration::new(
        "059_add_sm20_ensemble_state",
        r#"
        CREATE TABLE IF NOT EXISTS sm20_m2_optimizer (
            id TEXT PRIMARY KEY DEFAULT 'global',
            collection_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
            optimizer_state BLOB NOT NULL,
            date_modified TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sm20_m3_matrices (
            id TEXT PRIMARY KEY DEFAULT 'global',
            collection_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
            outcome_count BLOB NOT NULL,
            outcome_success BLOB NOT NULL,
            smoothing_count BLOB NOT NULL,
            smoothing_value BLOB NOT NULL,
            lapse_observed BLOB NOT NULL,
            lapse_remembered BLOB NOT NULL,
            first_stage_observed BLOB NOT NULL,
            first_stage_remembered BLOB NOT NULL,
            date_modified TEXT NOT NULL
        );
        "#,
    ),
    // Algorithm Arena state (adaptive per-user weights over the five SM-20
    // competitors, mirroring the binary's [Algorithm] PA2/PA15/PA19/PA20/PAF
    // settings) plus per-user optimized model parameters:
    //   sm20_model_params rows: id='fsrs' (M5 weights), id='m4' (SM-20 kernel).
    Migration::new(
        "060_add_sm20_arena_and_model_params",
        r#"
        CREATE TABLE IF NOT EXISTS sm20_arena (
            id TEXT PRIMARY KEY DEFAULT 'global',
            collection_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
            state TEXT NOT NULL,
            date_modified TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sm20_model_params (
            id TEXT PRIMARY KEY,
            collection_id TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
            params TEXT NOT NULL,
            meta TEXT,
            date_modified TEXT NOT NULL
        );
        "#,
    ),
    Migration::new(
        "061_startup_snapshot_indexes",
        r#"
        CREATE INDEX IF NOT EXISTS idx_documents_collection_date_added
            ON documents(collection_id, date_added DESC);
        CREATE INDEX IF NOT EXISTS idx_documents_collection_modified
            ON documents(collection_id, date_modified DESC);
        CREATE INDEX IF NOT EXISTS idx_learning_items_collection_due_suspended
            ON learning_items(collection_id, due_date, is_suspended);
        "#,
    ),
    Migration::new(
        "062_add_review_algorithm_arena_provenance",
        r#"
        ALTER TABLE review_results ADD COLUMN schedule_source TEXT;
        ALTER TABLE review_results ADD COLUMN schedule_model_id TEXT;
        ALTER TABLE review_results ADD COLUMN arena_commit_id TEXT;
        ALTER TABLE review_results ADD COLUMN arena_recommended_interval REAL;
        ALTER TABLE review_results ADD COLUMN arena_decision_time_ms INTEGER;
        ALTER TABLE review_results ADD COLUMN arena_snapshot TEXT;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_review_results_arena_commit_id
            ON review_results(arena_commit_id)
            WHERE arena_commit_id IS NOT NULL;
        "#,
    ),
    Migration::new(
        "063_add_youtube_transcript_word_timings",
        r#"
        ALTER TABLE youtube_transcripts ADD COLUMN word_timings_version INTEGER NOT NULL DEFAULT 0;
        "#,
    ),
    Migration::new(
        "064_kindle_clippings_docs_are_markdown",
        r#"
        -- Kindle clippings documents are built from markdown content
        -- (highlights as blockquotes, notes as bold-prefixed paragraphs) and
        -- were historically stored with file_type = 'other'. That made the
        -- viewer fall through to the "preview not available" wall whenever
        -- the doc's `content` column was stripped (e.g. by the library list
        -- endpoint) and labeled them "other" in every UI surface. Re-type
        -- them as markdown so they preview correctly. They're identified by
        -- the synthetic `kindle://<sha>` file_path assigned at import time.
        UPDATE documents
        SET file_type = 'markdown'
        WHERE file_path LIKE 'kindle://%' AND file_type = 'other';
        "#,
    ),
    Migration::new(
        "065_seed_default_collection",
        r#"
        -- Migration 023 created the collections table but never inserted a row
        -- for the implicit default collection that migration 045 defaulted
        -- documents/extracts/learning_items/etc. collection_id to. Without a
        -- real row here, get_collections() never lists it, so once a user
        -- switches to any other collection there is no way back to this one
        -- through the collection switcher UI — even though its documents were
        -- always correctly scoped to this id and never moved anywhere.
        INSERT OR IGNORE INTO collections (id, name, collection_type, created_at, modified_at)
        VALUES ('00000000-0000-0000-0000-000000000001', 'Personal', 'manual', datetime('now'), datetime('now'));
        "#,
    ),
    Migration::new(
        "066_backfill_document_extract_count",
        r#"
        -- create_extract / delete_extract now keep documents.extract_count in
        -- sync at write time, but existing databases accumulated drift because
        -- the count used to be patched only in-memory on the client (and was
        -- then clobbered by every documents reload / collection switch). This
        -- one-shot, idempotent recount repairs the Compact View "Has extracts"
        -- signal filter and the EXTRACTS column for pre-existing rows.
        UPDATE documents
        SET extract_count = (
            SELECT COUNT(*) FROM extracts WHERE extracts.document_id = documents.id
        );
        "#,
    ),
    Migration::new(
        "067_add_document_priority_explicitly_set",
        r#"
        -- The Alt+P priority popup must seed from a document's real current
        -- priority, including an explicit value of 0 (the Lowest preset). The
        -- legacy schema stored priority_slider / priority_rating as NOT NULL
        -- INTEGER DEFAULT 0, so a document the user deliberately set to 0 was
        -- indistinguishable from one never touched, and the popup reseeded to
        -- the neutral midpoint (50) instead of 0.
        --
        -- Rather than rebuild the documents table to make the two columns
        -- nullable (which would re-activate the category FOREIGN KEY and break
        -- the many existing rows whose category is a free-form tag rather than
        -- a categories(id) row), we add a single explicit boolean sentinel.
        -- `priority_explicitly_set = 1` means the user committed a priority via
        -- update_document_priority (any value, including 0); `0` means never
        -- touched. update_document_priority always flips this to 1 on commit,
        -- and resolveDisplaySlider honors priority_slider as-is when it is set,
        -- falling back to the rating-bucket / neutral midpoint only when it is
        -- not. This carries the same information as a nullable column without
        -- touching the existing columns or their constraints.
        ALTER TABLE documents ADD COLUMN priority_explicitly_set INTEGER NOT NULL DEFAULT 0;
        "#,
    ),
    // Migration 068: migrate-sync-to-delta-log cutover state (design.md §6)
    //
    // Per-domain pull/push cursors for the delta-log transport reuse the
    // existing sync_checkpoints table (migration 056) — one row per domain,
    // keyed the same way the Yjs-era adapters already use it. What's new
    // here is the phase state machine (drained -> seeded -> dual -> verified
    // -> cutover -> quiesced -> retired) that governs the migration itself,
    // which has no existing home: it is a single row per room, not per
    // domain, and needs per-domain progress counters nested under it for the
    // P1 drain / P2 seed gates (task 6.2, 6.3).
    Migration::new(
        "068_add_sync_cutover_state",
        r#"
        CREATE TABLE IF NOT EXISTS sync_cutover_state (
            room TEXT PRIMARY KEY,
            phase TEXT NOT NULL DEFAULT 'not_started',
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sync_cutover_domain_progress (
            room TEXT NOT NULL,
            domain TEXT NOT NULL,
            drained_count INTEGER NOT NULL DEFAULT 0,
            seeded_count INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (room, domain)
        );
        "#,
    ),
    // Migration 069: file_manifest_entries — a SQLite projection for the
    // file-manifest sync domain. Historically FileManifest kept its
    // authoritative state in the Yjs `fileManifest` map with no durability,
    // so a restart (or a no-Yjs build) lost it. This table is what lets the
    // manifest survive without the Yjs document: the delta-log domain handler
    // upserts here on apply, and FileManifest hydrates its in-memory cache
    // from here on construction. One row per (room, file id); the payload is
    // the full manifest entry JSON, same shape the wire/outbox carries.
    Migration::new(
        "069_add_file_manifest_entries",
        r#"
        CREATE TABLE IF NOT EXISTS file_manifest_entries (
            id TEXT NOT NULL,
            room TEXT NOT NULL,
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (room, id)
        );
        CREATE INDEX IF NOT EXISTS idx_file_manifest_entries_room
            ON file_manifest_entries(room);
        "#,
    ),
    // Migration 070: builds before the durable delta-log projection retry
    // path could advance the room cursor after a failed child-row upsert. The
    // live failure was extracts arriving while their parent documents were
    // absent: SQLite correctly rejected the FK, but the cursor moved on and
    // never delivered those extracts again. Replaying the compacted live set
    // once is bounded and idempotent, and recovers already-affected devices.
    Migration::new(
        "070_replay_delta_log_after_projection_fix",
        r#"
        UPDATE sync_checkpoints
        SET cursor = '0'
        WHERE domain = 'deltaLog:room'
           OR domain LIKE 'deltaLog:domain:%';
        "#,
    ),
    // Migration 071: migration 070 may already have replayed and checkpointed
    // the room on an affected device before the document receiver learned to
    // reconcile a top-level wire `fileId` into SQLite metadata for an
    // equal/older-clock local row. Replay once more so those existing rows
    // gain their manifest linkage and auto-download can resolve fileId -> doc.
    Migration::new(
        "071_replay_delta_log_after_document_file_link_fix",
        r#"
        UPDATE sync_checkpoints
        SET cursor = '0'
        WHERE domain = 'deltaLog:room'
           OR domain LIKE 'deltaLog:domain:%';
        "#,
    ),
    // Migration 072: append-only review projection previously acknowledged a
    // delta-log op as soon as it was queued for a delayed SQLite batch. If the
    // batch later hit a foreign key (source-local review session or a card
    // delivered after its review), the cursor had already advanced and the
    // failed row was not placed in the durable inbox. The receiver now
    // projects each review synchronously, strips the non-portable session id,
    // and defers a missing-card child. Replay the compacted live set once to
    // recover review events consumed by the old asynchronous path.
    Migration::new(
        "072_replay_delta_log_after_review_projection_fix",
        r#"
        UPDATE sync_checkpoints
        SET cursor = '0'
        WHERE domain = 'deltaLog:room'
           OR domain LIKE 'deltaLog:domain:%';
        "#,
    ),
    // Migration 073: the runtime migration chain created `collections` in
    // migration 023 without the `is_default` column that the Collection model
    // and synced upsert have always expected. Standalone SQL migration files
    // contain the column, but this application uses the in-code migration
    // registry above, so live databases never received it. Add it in place and
    // restore the canonical Personal collection marker.
    Migration::new(
        "073_add_collections_is_default",
        r#"
        ALTER TABLE collections ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
        UPDATE collections
        SET is_default = 1
        WHERE id = '00000000-0000-0000-0000-000000000001';
        "#,
    ),
    Migration::new(
        "074_add_composite_indexes",
        r#"
        CREATE INDEX IF NOT EXISTS idx_documents_collection_state ON documents(collection_id, is_archived);
        CREATE INDEX IF NOT EXISTS idx_documents_due ON documents(next_reading_date);
        CREATE INDEX IF NOT EXISTS idx_learning_items_document_state ON learning_items(document_id, state);
        CREATE INDEX IF NOT EXISTS idx_learning_items_due ON learning_items(due_date);
        CREATE INDEX IF NOT EXISTS idx_learning_items_type ON learning_items(item_type);
        CREATE INDEX IF NOT EXISTS idx_review_log_item ON review_log(item_id, timestamp);
        "#,
    ),
    Migration::new(
        "075_add_interval_modifier",
        r#"
        ALTER TABLE documents ADD COLUMN interval_modifier REAL NOT NULL DEFAULT 1.0;
        "#,
    ),
    Migration::new(
        "076_add_first_reviewed_at",
        r#"
        ALTER TABLE documents ADD COLUMN first_reviewed_at TEXT;
        ALTER TABLE learning_items ADD COLUMN first_reviewed_at TEXT;
        "#,
    ),
    Migration::new(
        "077_backfill_first_reviewed_at",
        r#"
        UPDATE learning_items
        SET first_reviewed_at = (
            SELECT MIN(rr.timestamp)
            FROM review_results rr
            WHERE rr.item_id = learning_items.id
        )
        WHERE first_reviewed_at IS NULL
          AND EXISTS (SELECT 1 FROM review_results rr WHERE rr.item_id = learning_items.id);

        UPDATE documents
        SET first_reviewed_at = (
            SELECT MIN(rr.timestamp)
            FROM review_results rr
            JOIN learning_items li ON rr.item_id = li.id
            WHERE li.document_id = documents.id
        )
        WHERE first_reviewed_at IS NULL
          AND EXISTS (
            SELECT 1 FROM review_results rr
            JOIN learning_items li ON rr.item_id = li.id
            WHERE li.document_id = documents.id
          );
        "#,
    ),
    // Migration 078: Knowledge-tree overlay.
    // A thin `element_tree` table references the existing documents /
    // extracts / learning_items tables via (element_kind, element_ref_id) and
    // carries the tree topology columns the priority and neural queues
    // traverse (parent/child/sibling, element type, concept and inter-element
    // links, cached descendant counts). It is purely additive: the three
    // concrete tables are untouched and every existing query keeps working.
    //
    // The backfill reconstructs the tree from existing foreign keys: documents
    // become root Topic nodes, extracts become Topic children of their
    // document, and learning_items become Item children of their extract (or
    // their document when no extract is set). Sibling order within a parent is
    // by created_at, mirroring how the IR flow appends children over time.
    Migration::new(
        "078_add_element_tree_overlay",
        r#"
        CREATE TABLE IF NOT EXISTS element_tree (
            id                       INTEGER PRIMARY KEY AUTOINCREMENT,
            element_kind             TEXT    NOT NULL CHECK(element_kind IN ('document','extract','learning_item')),
            element_ref_id           TEXT    NOT NULL,
            parent_id                INTEGER REFERENCES element_tree(id) ON DELETE CASCADE,
            first_child_id           INTEGER REFERENCES element_tree(id) ON DELETE SET NULL,
            next_sibling_id          INTEGER REFERENCES element_tree(id) ON DELETE SET NULL,
            prev_sibling_id          INTEGER REFERENCES element_tree(id) ON DELETE SET NULL,
            element_type             INTEGER NOT NULL, -- 0=Topic, 1=Item, 4=Concept
            concept_link_id          INTEGER REFERENCES element_tree(id) ON DELETE SET NULL,
            inter_element_link_id    INTEGER REFERENCES element_tree(id) ON DELETE SET NULL,
            descendant_count_a       INTEGER NOT NULL DEFAULT 0, -- cached, threshold 300
            descendant_count_b       INTEGER NOT NULL DEFAULT 0, -- cached, threshold 400
            sort_order               INTEGER NOT NULL DEFAULT 0,
            created_at               TEXT    NOT NULL,
            UNIQUE (element_kind, element_ref_id)
        );

        CREATE INDEX IF NOT EXISTS idx_element_tree_parent     ON element_tree(parent_id);
        CREATE INDEX IF NOT EXISTS idx_element_tree_ref        ON element_tree(element_kind, element_ref_id);
        CREATE INDEX IF NOT EXISTS idx_element_tree_first_child ON element_tree(first_child_id);
        CREATE INDEX IF NOT EXISTS idx_element_tree_next_sibling ON element_tree(next_sibling_id);
        CREATE INDEX IF NOT EXISTS idx_element_tree_prev_sibling ON element_tree(prev_sibling_id);

        -- Backfill: documents become root Topic nodes. The element_ref_id is
        -- the document id; parent is null (a root). created_at preserves the
        -- documents' insertion order so sibling sequencing is stable.
        INSERT INTO element_tree (
            element_kind, element_ref_id, parent_id, first_child_id,
            next_sibling_id, prev_sibling_id, element_type, concept_link_id,
            inter_element_link_id, descendant_count_a, descendant_count_b,
            sort_order, created_at
        )
        SELECT
            'document', d.id, NULL, NULL, NULL, NULL, 0, NULL, NULL, 0, 0, 0,
            d.date_added
        FROM documents d
        WHERE NOT EXISTS (
            SELECT 1 FROM element_tree e
            WHERE e.element_kind = 'document' AND e.element_ref_id = d.id
        );

        -- Backfill: extracts become Topic children of their document's node.
        -- Appended as the last sibling of the document (next/prev wiring set
        -- below). Sibling order is by date_created within the document.
        INSERT INTO element_tree (
            element_kind, element_ref_id, parent_id, first_child_id,
            next_sibling_id, prev_sibling_id, element_type, concept_link_id,
            inter_element_link_id, descendant_count_a, descendant_count_b,
            sort_order, created_at
        )
        SELECT
            'extract', x.id, ed.id, NULL, NULL, NULL, 0, NULL, NULL, 0, 0,
            ROW_NUMBER() OVER (PARTITION BY x.document_id ORDER BY x.date_created),
            x.date_created
        FROM extracts x
        JOIN element_tree ed
          ON ed.element_kind = 'document' AND ed.element_ref_id = x.document_id
        WHERE NOT EXISTS (
            SELECT 1 FROM element_tree e
            WHERE e.element_kind = 'extract' AND e.element_ref_id = x.id
        );

        -- Backfill: learning_items become Item children of their extract's node
        -- when extract_id is set, else their document's node. Sibling order by
        -- date_created within the chosen parent.
        INSERT INTO element_tree (
            element_kind, element_ref_id, parent_id, first_child_id,
            next_sibling_id, prev_sibling_id, element_type, concept_link_id,
            inter_element_link_id, descendant_count_a, descendant_count_b,
            sort_order, created_at
        )
        SELECT
            'learning_item', li.id,
            COALESCE(ex.id, ed.id),
            NULL, NULL, NULL, 1, NULL, NULL, 0, 0,
            ROW_NUMBER() OVER (
                PARTITION BY COALESCE(li.extract_id, li.document_id)
                ORDER BY li.date_created
            ),
            li.date_created
        FROM learning_items li
        LEFT JOIN element_tree ex
          ON ex.element_kind = 'extract' AND ex.element_ref_id = li.extract_id
        LEFT JOIN element_tree ed
          ON ed.element_kind = 'document' AND ed.element_ref_id = li.document_id
        WHERE NOT EXISTS (
            SELECT 1 FROM element_tree e
            WHERE e.element_kind = 'learning_item' AND e.element_ref_id = li.id
        );

        -- Stitch the sibling chains and parent child pointers the
        -- `register_node` append-as-last-child logic would have produced. For
        -- each parent, order children by sort_order (created_at proxy) and wire
        -- prev/next, then point the parent's first_child_id at the earliest.
        -- First, set first_child_id for every parent to its earliest child.
        UPDATE element_tree
        SET first_child_id = (
            SELECT e2.id FROM element_tree e2
            WHERE e2.parent_id = element_tree.id
            ORDER BY e2.sort_order, e2.created_at, e2.id
            LIMIT 1
        )
        WHERE EXISTS (SELECT 1 FROM element_tree c WHERE c.parent_id = element_tree.id);

        -- next_sibling_id = the child immediately after this one (by sort_order).
        UPDATE element_tree
        SET next_sibling_id = (
            SELECT n.id FROM element_tree n
            WHERE n.parent_id = element_tree.parent_id
              AND (n.sort_order, n.created_at, n.id) > (element_tree.sort_order, element_tree.created_at, element_tree.id)
            ORDER BY n.sort_order, n.created_at, n.id
            LIMIT 1
        )
        WHERE parent_id IS NOT NULL;

        -- prev_sibling_id = the child immediately before this one.
        UPDATE element_tree
        SET prev_sibling_id = (
            SELECT p.id FROM element_tree p
            WHERE p.parent_id = element_tree.parent_id
              AND (p.sort_order, p.created_at, p.id) < (element_tree.sort_order, element_tree.created_at, element_tree.id)
            ORDER BY p.sort_order DESC, p.created_at DESC, p.id DESC
            LIMIT 1
        )
        WHERE parent_id IS NOT NULL;
        "#,
    ),
    // Migration 079: priority-queue completion for learning items.
    // Cards historically had no user-set
    // priority — their queue `priority` was derived from FSRS urgency at read
    // time, which is scheduling urgency, not importance. The priority
    // queue treats topics and items uniformly, so learning_items gain the same
    // `priority_slider` (0-100, default 50 = neutral) and `priority_score`
    // columns documents already have. The slider is the user-set importance
    // rank; FSRS urgency continues to drive *when* the card is scheduled, not
    // its importance. Default 50 (not 0) matches `resolve_priority_slider`'s
    // neutral-midpoint behavior for un-prioritized items.
    Migration::new(
        "079_add_learning_item_priority_columns",
        r#"
        ALTER TABLE learning_items ADD COLUMN priority_slider INTEGER NOT NULL DEFAULT 50;
        ALTER TABLE learning_items ADD COLUMN priority_score REAL NOT NULL DEFAULT 0.0;
        ALTER TABLE learning_items ADD COLUMN priority_explicitly_set INTEGER NOT NULL DEFAULT 0;
        "#,
    ),
    // Migration 080: neural-queue storage.
    // A distinct table from the priority queue: it holds the spreading-
    // activation-built review sequence for the optional "Go neural" creative
    // mode. `element_id` references `element_tree.id` (overlay);
    // `position` is the 1-based presentation order; `priority_value` is the
    // combined activation the algorithm computed (lower = earlier); `consumed`
    // marks elements already studied so depletion can trigger a refill.
    Migration::new(
        "080_add_neural_queue_table",
        r#"
        CREATE TABLE IF NOT EXISTS neural_queue (
            element_id    INTEGER PRIMARY KEY REFERENCES element_tree(id) ON DELETE CASCADE,
            position      INTEGER NOT NULL,
            priority_value REAL NOT NULL,
            consumed      INTEGER NOT NULL DEFAULT 0,
            updated_at    TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_neural_queue_position
            ON neural_queue(position);
        CREATE INDEX IF NOT EXISTS idx_neural_queue_consumed
            ON neural_queue(consumed, position);
        "#,
    ),
    // Migration 081: make documents.extract_count / learning_item_count
    // self-maintaining.
    //
    // Both columns were increment-only: `create_extract` and
    // `create_learning_item` each did a `+ 1` UPDATE and *nothing* anywhere
    // decremented them. Deleting an extract or a card left its document
    // claiming it forever, so the Documents view's "Has extracts" / "Has cards"
    // signals and the extract/card sorts ran on numbers that only ever grew
    // (one library had 19 extracts claimed against 6 real rows, with three
    // documents claiming extracts they no longer had).
    //
    // Triggers rather than matching decrements at every delete site: the counts
    // then cannot drift from *any* path, including FK cascades and bulk
    // imports, and no future delete can forget to pair itself with an UPDATE.
    // The manual `+ 1` bumps are removed from the Rust side in the same change
    // — leaving them would double-count.
    //
    // Cascade deletes (extract -> its learning_items) only fire triggers when
    // `PRAGMA recursive_triggers` is ON; connection.rs sets it.
    Migration::new(
        "081_document_count_triggers",
        r#"
        -- One-time repair of the drift accumulated before the triggers existed.
        UPDATE documents SET
            extract_count = (
                SELECT COUNT(*) FROM extracts e WHERE e.document_id = documents.id
            ),
            learning_item_count = (
                SELECT COUNT(*) FROM learning_items li WHERE li.document_id = documents.id
            );

        -- extracts.document_id is NOT NULL, so every row has an owner.
        CREATE TRIGGER IF NOT EXISTS trg_extracts_count_insert
        AFTER INSERT ON extracts
        BEGIN
            UPDATE documents SET extract_count = extract_count + 1
            WHERE id = NEW.document_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_extracts_count_delete
        AFTER DELETE ON extracts
        BEGIN
            UPDATE documents SET extract_count = MAX(extract_count - 1, 0)
            WHERE id = OLD.document_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_extracts_count_move
        AFTER UPDATE OF document_id ON extracts
        WHEN OLD.document_id IS NOT NEW.document_id
        BEGIN
            UPDATE documents SET extract_count = MAX(extract_count - 1, 0)
            WHERE id = OLD.document_id;
            UPDATE documents SET extract_count = extract_count + 1
            WHERE id = NEW.document_id;
        END;

        -- learning_items.document_id is nullable (Anki/NotebookLM/extension
        -- cards have no source document); `WHERE id = NULL` matches no row, so
        -- the unowned case needs no guard.
        CREATE TRIGGER IF NOT EXISTS trg_learning_items_count_insert
        AFTER INSERT ON learning_items
        BEGIN
            UPDATE documents SET learning_item_count = learning_item_count + 1
            WHERE id = NEW.document_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_learning_items_count_delete
        AFTER DELETE ON learning_items
        BEGIN
            UPDATE documents SET learning_item_count = MAX(learning_item_count - 1, 0)
            WHERE id = OLD.document_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_learning_items_count_move
        AFTER UPDATE OF document_id ON learning_items
        WHEN OLD.document_id IS NOT NEW.document_id
        BEGIN
            UPDATE documents SET learning_item_count = MAX(learning_item_count - 1, 0)
            WHERE id = OLD.document_id;
            UPDATE documents SET learning_item_count = learning_item_count + 1
            WHERE id = NEW.document_id;
        END;
        "#,
    ),
    // Migration 082: index the priority-queue order key.
    //
    // `priority_score` stopped being a standalone importance value and became
    // a position in one global priority queue — see
    // `database::priority_rank`. Every priority edit and every priority
    // readout now runs `ORDER BY priority_score` / `COUNT(*) WHERE
    // priority_score < ?` across all three element tables, which is a full
    // scan per table without these.
    Migration::new(
        "082_index_priority_score",
        r#"
        CREATE INDEX IF NOT EXISTS idx_documents_priority_score
            ON documents(priority_score);
        CREATE INDEX IF NOT EXISTS idx_extracts_priority_score
            ON extracts(priority_score);
        CREATE INDEX IF NOT EXISTS idx_learning_items_priority_score
            ON learning_items(priority_score);
        "#,
    ),
    // Migration 083: per-item activity history and the columns that make
    // active-time accrual truthful.
    //
    // Purely additive: `item_activity_log` is new, and the two `ALTER TABLE`s
    // append nullable columns. Nothing rebuilds a table and nothing rewrites
    // an existing row, so pre-change totals (notably `documents.total_time_spent`)
    // survive untouched — an item with no rows here simply has no history,
    // which is the "untracked" state the stats UI renders explicitly.
    //
    // Flashcards are deliberately absent: their history already lives in
    // `review_results`, which is the synced revlog. Forking it would create a
    // second source of truth for the same event.
    Migration::new(
        "083_add_item_activity_log",
        r#"
        CREATE TABLE IF NOT EXISTS item_activity_log (
            id TEXT PRIMARY KEY,
            item_type TEXT NOT NULL,
            item_id TEXT NOT NULL,
            surface TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            active_seconds INTEGER NOT NULL DEFAULT 0,
            rating INTEGER,
            resulting_interval_days REAL,
            progress_start REAL,
            progress_end REAL
        );

        CREATE INDEX IF NOT EXISTS idx_item_activity_log_item
            ON item_activity_log(item_type, item_id);
        CREATE INDEX IF NOT EXISTS idx_item_activity_log_started_at
            ON item_activity_log(started_at);

        ALTER TABLE extracts ADD COLUMN total_time_spent INTEGER;

        ALTER TABLE reading_sessions ADD COLUMN last_heartbeat_at TEXT;
        "#,
    ),
    // Migration 084: make long-running audiobook transcription resumable.
    // Queue entries need to retain the exact transcript chapter selected by
    // the viewer. The unique segment index turns checkpoint replays at an
    // engine timestamp boundary into harmless INSERT OR IGNORE operations.
    Migration::new(
        "084_resumable_transcription",
        r#"
        ALTER TABLE transcription_queue ADD COLUMN chapter_id TEXT;

        DELETE FROM transcript_segments
        WHERE id NOT IN (
            SELECT MIN(id)
            FROM transcript_segments
            GROUP BY transcript_id, start_ms, end_ms, text
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_transcript_segments_checkpoint
            ON transcript_segments(transcript_id, start_ms, end_ms, text);
        "#,
    ),
    // Migration 085: AI learning system — semantic index, provenance, concepts,
    // recall history, answer assessments, passage scores, index state.
    // All of these are caches / adjunct data: user content remains canonical in
    // the existing tables and every table here can be wiped and rebuilt.
    // Also folds the legacy 051 RAG chunk embeddings into the unified chunk
    // tables, and defensively creates queue_item_embeddings whose DDL only
    // ever existed in a legacy (never-applied) .sql file.
    Migration::new(
        "085_ai_learning_system",
        r#"
        CREATE TABLE IF NOT EXISTS semantic_chunks (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_id TEXT,
            ordinal INTEGER NOT NULL,
            text TEXT NOT NULL,
            heading_path TEXT NOT NULL DEFAULT '[]',
            location_json TEXT NOT NULL DEFAULT '{}',
            content_hash TEXT NOT NULL,
            token_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_semantic_chunks_document
            ON semantic_chunks(document_id, ordinal);
        CREATE INDEX IF NOT EXISTS idx_semantic_chunks_hash
            ON semantic_chunks(content_hash);

        CREATE TABLE IF NOT EXISTS semantic_chunk_embeddings (
            chunk_id TEXT PRIMARY KEY,
            embedding BLOB NOT NULL,
            model TEXT NOT NULL,
            dimension INTEGER NOT NULL,
            embedding_version INTEGER NOT NULL DEFAULT 1,
            content_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (chunk_id) REFERENCES semantic_chunks(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_semantic_chunk_embeddings_version
            ON semantic_chunk_embeddings(embedding_version, model);

        -- One-time fold of legacy whole-library RAG embeddings (051) into the
        -- unified semantic index, then retire the old table. Rows whose
        -- document no longer exists (common in DBs synced across devices,
        -- where a deletion on one side outlived the embedding on the other)
        -- are dropped: semantic_chunks carries a foreign key to documents and
        -- the fold would otherwise abort the whole migration at startup.
        INSERT INTO semantic_chunks (id, document_id, source_type, ordinal, text, content_hash, token_count, created_at, updated_at)
        SELECT id, document_id, 'document', chunk_index, chunk_text, content_hash, 0,
               datetime(created_at / 1000, 'unixepoch'), datetime(created_at / 1000, 'unixepoch')
        FROM document_chunk_embeddings
        WHERE EXISTS (
            SELECT 1 FROM documents doc WHERE doc.id = document_chunk_embeddings.document_id
        );
        INSERT INTO semantic_chunk_embeddings (chunk_id, embedding, model, dimension, embedding_version, content_hash, created_at)
        SELECT id, embedding, model, dimension, 1, content_hash, datetime(created_at / 1000, 'unixepoch')
        FROM document_chunk_embeddings
        WHERE EXISTS (
            SELECT 1 FROM semantic_chunks sc WHERE sc.id = document_chunk_embeddings.id
        );
        DROP TABLE IF EXISTS document_chunk_embeddings;

        CREATE TABLE IF NOT EXISTS ai_provenance (
            id TEXT PRIMARY KEY,
            target_kind TEXT NOT NULL,
            target_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT,
            model_class TEXT,
            input_fingerprint TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            metadata_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ai_provenance_target
            ON ai_provenance(target_kind, target_id);

        CREATE TABLE IF NOT EXISTS concepts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            normalized_name TEXT NOT NULL UNIQUE,
            description TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS concept_links (
            id TEXT PRIMARY KEY,
            source_kind TEXT NOT NULL,
            source_id TEXT NOT NULL,
            target_kind TEXT NOT NULL,
            target_id TEXT NOT NULL,
            relation_type TEXT NOT NULL,
            confidence REAL NOT NULL,
            provenance_json TEXT,
            created_by TEXT NOT NULL DEFAULT 'ai',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            is_dismissed INTEGER NOT NULL DEFAULT 0,
            proposal_fingerprint TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_concept_links_source
            ON concept_links(source_kind, source_id);
        CREATE INDEX IF NOT EXISTS idx_concept_links_target
            ON concept_links(target_kind, target_id);
        CREATE INDEX IF NOT EXISTS idx_concept_links_fingerprint
            ON concept_links(proposal_fingerprint);

        CREATE TABLE IF NOT EXISTS recall_prompt_history (
            id TEXT PRIMARY KEY,
            document_id TEXT,
            chunk_ids TEXT NOT NULL DEFAULT '[]',
            fingerprint TEXT NOT NULL,
            question TEXT NOT NULL,
            asked_at TEXT NOT NULL DEFAULT (datetime('now')),
            outcome TEXT NOT NULL DEFAULT 'asked'
        );
        CREATE INDEX IF NOT EXISTS idx_recall_prompt_history_fingerprint
            ON recall_prompt_history(fingerprint, asked_at);
        CREATE INDEX IF NOT EXISTS idx_recall_prompt_history_document
            ON recall_prompt_history(document_id, asked_at);

        CREATE TABLE IF NOT EXISTS answer_assessments (
            id TEXT PRIMARY KEY,
            review_result_id INTEGER,
            item_id TEXT,
            classification TEXT NOT NULL,
            score REAL,
            completeness REAL,
            confidence REAL,
            missing_concepts TEXT,
            misconception TEXT,
            feedback TEXT,
            suggested_correction TEXT,
            provider TEXT,
            model TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_answer_assessments_review_result
            ON answer_assessments(review_result_id);
        CREATE INDEX IF NOT EXISTS idx_answer_assessments_item
            ON answer_assessments(item_id, created_at);

        CREATE TABLE IF NOT EXISTS passage_scores (
            chunk_hash TEXT PRIMARY KEY,
            passage_type TEXT NOT NULL,
            extract_worthiness REAL NOT NULL,
            suggested_action TEXT,
            model TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS ai_index_state (
            document_id TEXT PRIMARY KEY,
            state TEXT NOT NULL DEFAULT 'unindexed',
            embedding_version INTEGER,
            chunks_indexed INTEGER NOT NULL DEFAULT 0,
            total_chunks INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            error TEXT,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );

        -- Defensive creation: this table's DDL previously existed only in a
        -- legacy .sql file that the runtime registry never applied.
        CREATE TABLE IF NOT EXISTS queue_item_embeddings (
            item_id TEXT PRIMARY KEY,
            embedding BLOB NOT NULL,
            content_hash TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            dimension INTEGER NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_queue_item_embeddings_content_hash
            ON queue_item_embeddings(content_hash);
        "#,
    ),
    // Migration 086: recreate the document_search sync triggers.
    // The documents table was rebuilt via documents_new + RENAME in an earlier
    // migration, and SQLite silently drops triggers on the renamed-away table.
    // Fresh installs therefore end up with no document_search_* triggers and an
    // empty FTS document index until a manual fts_reindex runs. Resync the
    // index and recreate the triggers (idempotent: full delete + reinsert).
    Migration::new(
        "086_fix_document_search_triggers",
        r#"
        DELETE FROM document_search WHERE document_id IN (SELECT id FROM documents);

        INSERT INTO document_search(document_id, title, content, content_type)
        SELECT id, title, COALESCE(content, ''), file_type FROM documents;

        CREATE TRIGGER IF NOT EXISTS document_search_insert AFTER INSERT ON documents BEGIN
            INSERT INTO document_search(document_id, title, content, content_type)
            VALUES (NEW.id, NEW.title, COALESCE(NEW.content, ''), NEW.file_type);
        END;

        CREATE TRIGGER IF NOT EXISTS document_search_update AFTER UPDATE OF title, content, file_type ON documents BEGIN
            UPDATE document_search SET
                title = NEW.title,
                content = COALESCE(NEW.content, ''),
                content_type = NEW.file_type
            WHERE document_id = NEW.id;
        END;

        CREATE TRIGGER IF NOT EXISTS document_search_delete AFTER DELETE ON documents BEGIN
            DELETE FROM document_search WHERE document_id = OLD.id;
        END;
        "#,
    ),
    // Migration 087: drop the cross-device sync bookkeeping tables.
    // Real-time sync was removed; these tables held replication state
    // (outbox/inbox/checkpoints/cutover), never user data. User data lives
    // in the domain tables and is untouched. DROP IF EXISTS keeps fresh
    // installs (which never created some of these) valid.
    Migration::new(
        "087_drop_sync_tables",
        r#"
        DROP TABLE IF EXISTS sync_config;
        DROP TABLE IF EXISTS sync_queue;
        DROP TABLE IF EXISTS sync_device_id;
        DROP TABLE IF EXISTS sync_tombstones;
        DROP TABLE IF EXISTS sync_outbox;
        DROP TABLE IF EXISTS sync_inbox;
        DROP TABLE IF EXISTS sync_applied_operations;
        DROP TABLE IF EXISTS sync_checkpoints;
        DROP TABLE IF EXISTS sync_dead_letters;
        DROP TABLE IF EXISTS sync_projection_hashes;
        DROP TABLE IF EXISTS sync_migration_state;
        DROP TABLE IF EXISTS sync_cutover_state;
        DROP TABLE IF EXISTS sync_cutover_domain_progress;
        "#,
    ),
    // Migration 088: RSS semantic preference learning (OpenSpec:
    // rss-semantic-preference-learning). Feedback events are the source of
    // truth; preference clusters are derived and rebuildable.
    Migration::new(
        "088_rss_preference_learning",
        r#"
        CREATE TABLE IF NOT EXISTS rss_article_feedback (
            article_id TEXT PRIMARY KEY,
            sentiment TEXT NOT NULL CHECK (sentiment IN ('like', 'dislike')),
            feedback_source TEXT NOT NULL DEFAULT 'thumbs',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rss_article_feedback_sentiment
            ON rss_article_feedback(sentiment, created_at);

        CREATE TABLE IF NOT EXISTS rss_preference_clusters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sentiment TEXT NOT NULL CHECK (sentiment IN ('like', 'dislike')),
            centroid_sum BLOB NOT NULL,
            weight REAL NOT NULL,
            last_updated INTEGER NOT NULL,
            exemplar_article_id TEXT NOT NULL,
            exemplar_title TEXT NOT NULL,
            dim INTEGER NOT NULL,
            model TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rss_preference_clusters_sentiment
            ON rss_preference_clusters(sentiment);
        "#,
    ),
    // Migration 089: Audio Editions and Hands-Free Study Mode
    Migration::new(
        "089_add_audio_editions_and_hands_free_study_mode",
        r#"
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
        "#,
    ),
    // Migration 090: user-installed Hugging Face speech model registry.
    // One row per installed HF repo (repo id + revision + runtime). The rows
    // drive the STT model picker, TTS model surface, duplicate-install
    // prevention, and restart re-detection (the frontend calls
    // get_installed_hf_models / get_transcription_profiles on boot, which
    // re-verifies files on disk).
    Migration::new(
        "090_hf_installed_models",
        r#"
        CREATE TABLE IF NOT EXISTS hf_installed_models (
            id TEXT PRIMARY KEY,
            repo_id TEXT NOT NULL,
            revision TEXT NOT NULL DEFAULT 'main',
            runtime TEXT NOT NULL,
            artifact_kind TEXT NOT NULL,
            install_dir TEXT NOT NULL,
            artifact_files TEXT NOT NULL,
            download_size_bytes INTEGER NOT NULL DEFAULT 0,
            license TEXT,
            run_contract TEXT NOT NULL,
            metadata TEXT NOT NULL,
            installed_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_hf_installed_models_repo
            ON hf_installed_models(repo_id, revision, runtime);
        "#,
    ),
    // Migration 091: durable language-learning profiles and content associations.
    // These tables are additive.  Existing document language metadata remains
    // untouched and all foreign keys point only at the new profile projection.
    Migration::new(
        "091_language_learning_profiles",
        r#"
        CREATE TABLE IF NOT EXISTS language_profiles (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL DEFAULT 'local',
            workspace_id TEXT NOT NULL DEFAULT 'default',
            name TEXT NOT NULL,
            target_language TEXT NOT NULL,
            base_language TEXT NOT NULL,
            proficiency TEXT,
            preferences_json TEXT NOT NULL DEFAULT '{}',
            processing_config_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            lifecycle TEXT NOT NULL DEFAULT 'active'
                CHECK(lifecycle IN ('active', 'archived', 'deleted')),
            version INTEGER NOT NULL DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS idx_language_profiles_scope
            ON language_profiles(account_id, workspace_id, lifecycle, updated_at);

        CREATE TABLE IF NOT EXISTS language_profile_associations (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL DEFAULT 'local',
            workspace_id TEXT NOT NULL DEFAULT 'default',
            profile_id TEXT NOT NULL,
            content_type TEXT NOT NULL CHECK(content_type IN ('document', 'media')),
            content_id TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT 'auto'
                CHECK(mode IN ('auto', 'enabled', 'disabled')),
            detection_evidence_json TEXT,
            suggestion_dismissed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE,
            UNIQUE(account_id, workspace_id, profile_id, content_type, content_id)
        );

        CREATE INDEX IF NOT EXISTS idx_language_profile_associations_content
            ON language_profile_associations(account_id, workspace_id, content_type, content_id, mode);
        CREATE INDEX IF NOT EXISTS idx_language_profile_associations_profile
            ON language_profile_associations(profile_id, mode, updated_at);

        CREATE TABLE IF NOT EXISTS language_profile_active_scopes (
            account_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            profile_id TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(account_id, workspace_id),
            FOREIGN KEY (profile_id) REFERENCES language_profiles(id) ON DELETE SET NULL
        );
        "#,
    ),
    // Migration 092: durable language-processing jobs, chunked results, and
    // paged token storage. The frontend IndexedDB implementation mirrors
    // these logical tables for browser/PWA mode; neither path stores full
    // token streams in localStorage or reactive state.
    Migration::new(
        "092_language_processing_results",
        r#"
        CREATE TABLE IF NOT EXISTS language_processing_jobs (
            job_id TEXT PRIMARY KEY,
            processing_key TEXT NOT NULL,
            state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
            next_chunk_index INTEGER NOT NULL DEFAULT 0,
            total_chunks INTEGER NOT NULL DEFAULT 0,
            completed_chunks INTEGER NOT NULL DEFAULT 0,
            retry_count INTEGER NOT NULL DEFAULT 0,
            error_code TEXT,
            error_message TEXT,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS language_processing_results (
            processing_key TEXT PRIMARY KEY,
            version_json TEXT NOT NULL,
            summary_json TEXT NOT NULL,
            chunk_count INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS language_processing_chunks (
            processing_key TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            source_start INTEGER NOT NULL,
            source_end INTEGER NOT NULL,
            chunk_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (processing_key, chunk_index)
        );

        CREATE TABLE IF NOT EXISTS language_processing_tokens (
            processing_key TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            token_index INTEGER NOT NULL,
            token_id TEXT NOT NULL,
            start_offset INTEGER NOT NULL,
            end_offset INTEGER NOT NULL,
            token_json TEXT NOT NULL,
            PRIMARY KEY (processing_key, chunk_index, token_index)
        );

        CREATE INDEX IF NOT EXISTS idx_language_processing_jobs_key
            ON language_processing_jobs(processing_key);
        CREATE INDEX IF NOT EXISTS idx_language_processing_jobs_updated
            ON language_processing_jobs(updated_at);
        CREATE INDEX IF NOT EXISTS idx_language_processing_chunks_key
            ON language_processing_chunks(processing_key, chunk_index);
        CREATE INDEX IF NOT EXISTS idx_language_processing_tokens_page
            ON language_processing_tokens(processing_key, chunk_index, token_index);
        CREATE INDEX IF NOT EXISTS idx_language_processing_results_updated
            ON language_processing_results(updated_at);
        "#,
    ),
    // Migration 093: profile-scoped lexicon, analyses, lookup evidence, and
    // bounded source occurrences. Raw occurrences are optional sync data and
    // can be rebuilt from versioned processing results.
    Migration::new(
        "093_language_lexicon_and_occurrences",
        r#"
        CREATE TABLE IF NOT EXISTS language_lexical_entries (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            language_tag TEXT NOT NULL,
            object_kind TEXT NOT NULL DEFAULT 'token'
                CHECK(object_kind IN ('token', 'phrase')),
            lexical_key TEXT NOT NULL,
            normalized_form TEXT NOT NULL,
            canonical_form TEXT NOT NULL,
            lemma TEXT,
            meanings_json TEXT NOT NULL DEFAULT '[]',
            translations_json TEXT NOT NULL DEFAULT '[]',
            part_of_speech TEXT,
            pronunciation TEXT,
            frequency REAL,
            cefr_level TEXT,
            provider_id TEXT,
            provider_version TEXT,
            processor_id TEXT,
            processor_version TEXT,
            identity_confidence REAL,
            first_encountered_at INTEGER,
            last_encountered_at INTEGER,
            encounter_count INTEGER NOT NULL DEFAULT 0,
            document_count INTEGER NOT NULL DEFAULT 0,
            lookup_count INTEGER NOT NULL DEFAULT 0,
            active_evidence_count INTEGER NOT NULL DEFAULT 0,
            passive_evidence_count INTEGER NOT NULL DEFAULT 0,
            knowledge_state TEXT,
            review_relationships_json TEXT NOT NULL DEFAULT '{}',
            user_notes TEXT,
            ignored INTEGER NOT NULL DEFAULT 0,
            proper_noun INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE,
            UNIQUE(profile_id, language_tag, object_kind, lexical_key)
        );

        CREATE INDEX IF NOT EXISTS idx_language_lexical_entries_profile_language
            ON language_lexical_entries(profile_id, language_tag, object_kind, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_language_lexical_entries_profile_recent
            ON language_lexical_entries(profile_id, last_encountered_at DESC, id);
        CREATE INDEX IF NOT EXISTS idx_language_lexical_entries_profile_lookup
            ON language_lexical_entries(profile_id, lookup_count DESC, last_encountered_at DESC);
        CREATE INDEX IF NOT EXISTS idx_language_lexical_entries_lemma
            ON language_lexical_entries(profile_id, language_tag, lemma);

        CREATE TABLE IF NOT EXISTS language_surface_forms (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            lexical_entry_id TEXT NOT NULL,
            language_tag TEXT NOT NULL,
            surface TEXT NOT NULL,
            normalized TEXT NOT NULL,
            first_seen_at INTEGER,
            last_seen_at INTEGER,
            occurrence_count INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE,
            FOREIGN KEY(lexical_entry_id) REFERENCES language_lexical_entries(id) ON DELETE CASCADE,
            UNIQUE(profile_id, language_tag, normalized)
        );

        CREATE INDEX IF NOT EXISTS idx_language_surface_forms_entry
            ON language_surface_forms(lexical_entry_id, last_seen_at DESC);
        CREATE INDEX IF NOT EXISTS idx_language_surface_forms_profile_norm
            ON language_surface_forms(profile_id, language_tag, normalized);

        CREATE TABLE IF NOT EXISTS language_lexical_analyses (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            lexical_entry_id TEXT NOT NULL,
            surface_form_id TEXT,
            token_id TEXT,
            sentence_id TEXT,
            processing_key TEXT NOT NULL,
            processor_id TEXT,
            processor_version TEXT,
            lemma TEXT,
            part_of_speech TEXT,
            morphology_json TEXT NOT NULL DEFAULT '{}',
            confidence REAL,
            authoritative INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE,
            FOREIGN KEY(lexical_entry_id) REFERENCES language_lexical_entries(id) ON DELETE CASCADE,
            FOREIGN KEY(surface_form_id) REFERENCES language_surface_forms(id) ON DELETE SET NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_language_lexical_analyses_token_version
            ON language_lexical_analyses(profile_id, processing_key, token_id)
            WHERE token_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_language_lexical_analyses_entry
            ON language_lexical_analyses(lexical_entry_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS language_analysis_versions (
            processing_key TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            language_tag TEXT NOT NULL,
            content_fingerprint TEXT NOT NULL,
            version_json TEXT NOT NULL,
            stale INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_language_analysis_versions_profile
            ON language_analysis_versions(profile_id, language_tag, updated_at DESC);

        CREATE TABLE IF NOT EXISTS language_occurrences (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            lexical_entry_id TEXT NOT NULL,
            surface_form_id TEXT,
            language_tag TEXT NOT NULL,
            surface TEXT NOT NULL,
            normalized TEXT NOT NULL,
            source_type TEXT NOT NULL,
            document_id TEXT,
            media_id TEXT,
            source_id TEXT,
            sentence_id TEXT,
            token_id TEXT,
            content_fingerprint TEXT,
            source_anchor_json TEXT,
            context_reference TEXT,
            context_hash TEXT,
            context_text TEXT,
            encountered_at INTEGER NOT NULL,
            last_encountered_at INTEGER NOT NULL,
            repeat_count INTEGER NOT NULL DEFAULT 1,
            audio_start_ms INTEGER,
            audio_end_ms INTEGER,
            was_lookup INTEGER NOT NULL DEFAULT 0,
            was_interacted INTEGER NOT NULL DEFAULT 0,
            processing_key TEXT,
            confidence REAL,
            orphan_state TEXT NOT NULL DEFAULT 'live'
                CHECK(orphan_state IN ('live', 'orphaned', 'retained')),
            orphaned_at INTEGER,
            retention_expires_at INTEGER,
            occurrence_key TEXT NOT NULL,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE,
            FOREIGN KEY(lexical_entry_id) REFERENCES language_lexical_entries(id) ON DELETE CASCADE,
            FOREIGN KEY(surface_form_id) REFERENCES language_surface_forms(id) ON DELETE SET NULL,
            UNIQUE(profile_id, occurrence_key)
        );

        CREATE INDEX IF NOT EXISTS idx_language_occurrences_profile_time
            ON language_occurrences(profile_id, encountered_at DESC, id);
        CREATE INDEX IF NOT EXISTS idx_language_occurrences_profile_document_time
            ON language_occurrences(profile_id, document_id, encountered_at DESC, id);
        CREATE INDEX IF NOT EXISTS idx_language_occurrences_profile_media_time
            ON language_occurrences(profile_id, media_id, encountered_at DESC, id);
        CREATE INDEX IF NOT EXISTS idx_language_occurrences_entry_time
            ON language_occurrences(profile_id, lexical_entry_id, encountered_at DESC, id);
        CREATE INDEX IF NOT EXISTS idx_language_occurrences_source
            ON language_occurrences(profile_id, source_type, source_id, sentence_id, token_id);
        CREATE INDEX IF NOT EXISTS idx_language_occurrences_retention
            ON language_occurrences(profile_id, orphan_state, retention_expires_at);

        CREATE TABLE IF NOT EXISTS language_lookup_events (
            id TEXT PRIMARY KEY,
            profile_id TEXT,
            lexical_entry_id TEXT,
            surface TEXT NOT NULL,
            normalized TEXT NOT NULL,
            document_id TEXT,
            media_id TEXT,
            source_anchor_json TEXT,
            looked_up_at INTEGER NOT NULL,
            provider_id TEXT,
            provider_version TEXT,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE,
            FOREIGN KEY(lexical_entry_id) REFERENCES language_lexical_entries(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_language_lookup_events_profile_time
            ON language_lookup_events(profile_id, looked_up_at DESC, id);
        CREATE INDEX IF NOT EXISTS idx_language_lookup_events_profile_norm
            ON language_lookup_events(profile_id, normalized, looked_up_at DESC);

        CREATE TABLE IF NOT EXISTS language_legacy_lookup_history (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL DEFAULT 'local',
            workspace_id TEXT NOT NULL DEFAULT 'default',
            profile_id TEXT,
            word TEXT NOT NULL,
            normalized TEXT NOT NULL,
            lookup_count INTEGER NOT NULL DEFAULT 0,
            first_seen_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL,
            last_document_id TEXT,
            migrated_at INTEGER,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE SET NULL,
            UNIQUE(account_id, workspace_id, profile_id, normalized)
        );

        CREATE INDEX IF NOT EXISTS idx_language_legacy_lookup_scope
            ON language_legacy_lookup_history(account_id, workspace_id, profile_id, last_seen_at DESC);
        "#,
    ),
    // Migration 094: profile-scoped knowledge state, evidence history, and
    // explicit memorization links. State is independent from the scheduler.
    Migration::new(
        "094_language_knowledge_states",
        r#"
        CREATE TABLE IF NOT EXISTS language_knowledge_states (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            lexical_entry_id TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'new'
                CHECK(state IN ('new', 'encountered', 'learning', 'familiar', 'known', 'ignored')),
            manual_override INTEGER NOT NULL DEFAULT 0,
            override_actor TEXT,
            override_source TEXT,
            passive_evidence INTEGER NOT NULL DEFAULT 0,
            active_evidence INTEGER NOT NULL DEFAULT 0,
            last_evidence_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE,
            FOREIGN KEY(lexical_entry_id) REFERENCES language_lexical_entries(id) ON DELETE CASCADE,
            UNIQUE(profile_id, lexical_entry_id)
        );

        CREATE INDEX IF NOT EXISTS idx_language_knowledge_states_profile_state
            ON language_knowledge_states(profile_id, state, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_language_knowledge_states_entry
            ON language_knowledge_states(profile_id, lexical_entry_id);

        CREATE TABLE IF NOT EXISTS language_knowledge_state_history (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            lexical_entry_id TEXT NOT NULL,
            previous_state TEXT NOT NULL,
            new_state TEXT NOT NULL,
            source TEXT NOT NULL,
            actor_id TEXT,
            operation_id TEXT NOT NULL,
            changed_at INTEGER NOT NULL,
            reverted_at INTEGER,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE,
            FOREIGN KEY(lexical_entry_id) REFERENCES language_lexical_entries(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_language_knowledge_history_profile_time
            ON language_knowledge_state_history(profile_id, changed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_language_knowledge_history_operation
            ON language_knowledge_state_history(profile_id, operation_id);

        CREATE TABLE IF NOT EXISTS language_knowledge_evidence_events (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            lexical_entry_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('encounter', 'lookup', 'recognition', 'production', 'manual')),
            confidence REAL,
            source_id TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            occurred_at INTEGER NOT NULL,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE,
            FOREIGN KEY(lexical_entry_id) REFERENCES language_lexical_entries(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_language_knowledge_evidence_profile_time
            ON language_knowledge_evidence_events(profile_id, occurred_at DESC);
        CREATE INDEX IF NOT EXISTS idx_language_knowledge_evidence_entry_kind
            ON language_knowledge_evidence_events(profile_id, lexical_entry_id, kind, occurred_at DESC);

        CREATE TABLE IF NOT EXISTS language_memorization_links (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            lexical_entry_id TEXT NOT NULL,
            learning_item_id TEXT NOT NULL,
            relation TEXT NOT NULL DEFAULT 'explicit',
            actor_id TEXT,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE,
            FOREIGN KEY(lexical_entry_id) REFERENCES language_lexical_entries(id) ON DELETE CASCADE,
            FOREIGN KEY(learning_item_id) REFERENCES learning_items(id) ON DELETE CASCADE,
            UNIQUE(profile_id, lexical_entry_id, learning_item_id)
        );

        CREATE INDEX IF NOT EXISTS idx_language_memorization_links_profile
            ON language_memorization_links(profile_id, lexical_entry_id);
        "#,
    ),
    // Migration 095: profile-scoped phrase/collocation candidates and
    // overlap-aware occurrences. Phrase objects remain separate from cards.
    Migration::new(
        "095_language_phrase_learning",
        r#"
        CREATE TABLE IF NOT EXISTS language_phrases (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            language_tag TEXT NOT NULL,
            phrase_key TEXT NOT NULL,
            normalized_form TEXT NOT NULL,
            canonical_form TEXT NOT NULL,
            meaning TEXT,
            translation TEXT,
            confidence REAL,
            state TEXT NOT NULL DEFAULT 'new'
                CHECK(state IN ('new', 'encountered', 'learning', 'familiar', 'known', 'ignored')),
            first_encountered_at INTEGER,
            last_encountered_at INTEGER,
            occurrence_count INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE,
            UNIQUE(profile_id, phrase_key)
        );

        CREATE INDEX IF NOT EXISTS idx_language_phrases_profile_state
            ON language_phrases(profile_id, state, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_language_phrases_profile_normalized
            ON language_phrases(profile_id, normalized_form);

        CREATE TABLE IF NOT EXISTS language_phrase_constituents (
            phrase_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            lexical_entry_id TEXT,
            surface TEXT NOT NULL,
            normalized TEXT NOT NULL,
            FOREIGN KEY(phrase_id) REFERENCES language_phrases(id) ON DELETE CASCADE,
            FOREIGN KEY(lexical_entry_id) REFERENCES language_lexical_entries(id) ON DELETE SET NULL,
            PRIMARY KEY(phrase_id, position)
        );

        CREATE INDEX IF NOT EXISTS idx_language_phrase_constituents_entry
            ON language_phrase_constituents(lexical_entry_id, phrase_id);

        CREATE TABLE IF NOT EXISTS language_phrase_occurrences (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            phrase_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            document_id TEXT,
            media_id TEXT,
            source_anchor_json TEXT,
            context_text TEXT,
            confidence REAL,
            first_seen_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL,
            repeat_count INTEGER NOT NULL DEFAULT 1,
            occurrence_key TEXT NOT NULL,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE,
            FOREIGN KEY(phrase_id) REFERENCES language_phrases(id) ON DELETE CASCADE,
            UNIQUE(profile_id, occurrence_key)
        );

        CREATE INDEX IF NOT EXISTS idx_language_phrase_occurrences_profile_time
            ON language_phrase_occurrences(profile_id, last_seen_at DESC);
        CREATE INDEX IF NOT EXISTS idx_language_phrase_occurrences_phrase
            ON language_phrase_occurrences(profile_id, phrase_id, last_seen_at DESC);

        CREATE TABLE IF NOT EXISTS language_phrase_candidates (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            normalized_form TEXT NOT NULL,
            surface TEXT NOT NULL,
            constituent_entry_ids_json TEXT NOT NULL DEFAULT '[]',
            source_anchor_json TEXT,
            confidence REAL NOT NULL,
            provider_id TEXT,
            provider_version TEXT,
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending', 'accepted', 'dismissed')),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE,
            UNIQUE(profile_id, normalized_form, source_anchor_json)
        );

        CREATE INDEX IF NOT EXISTS idx_language_phrase_candidates_profile_status
            ON language_phrase_candidates(profile_id, status, confidence DESC, created_at DESC);
        "#,
    ),
    // Migration 096: explicit language draft/provenance and review evidence.
    // Drafts are idempotency records; learning_items are still created only
    // by the explicit Memorize action through the existing scheduler path.
    Migration::new(
        "096_language_srs_drafts",
        r#"
        CREATE TABLE IF NOT EXISTS language_srs_drafts (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            lexical_entry_id TEXT,
            phrase_id TEXT,
            sentence_id TEXT,
            draft_key TEXT NOT NULL,
            item_type TEXT NOT NULL,
            question TEXT NOT NULL,
            answer TEXT,
            source_anchor_json TEXT,
            provenance_json TEXT NOT NULL DEFAULT '{}',
            provider_id TEXT,
            provider_version TEXT,
            status TEXT NOT NULL DEFAULT 'draft'
                CHECK(status IN ('draft', 'accepted', 'dismissed', 'expired')),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE,
            FOREIGN KEY(lexical_entry_id) REFERENCES language_lexical_entries(id) ON DELETE SET NULL,
            FOREIGN KEY(phrase_id) REFERENCES language_phrases(id) ON DELETE SET NULL,
            UNIQUE(profile_id, draft_key)
        );

        CREATE INDEX IF NOT EXISTS idx_language_srs_drafts_profile_status
            ON language_srs_drafts(profile_id, status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS language_srs_evidence (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            lexical_entry_id TEXT,
            phrase_id TEXT,
            learning_item_id TEXT,
            evidence_kind TEXT NOT NULL
                CHECK(evidence_kind IN ('suggested', 'accepted', 'reviewed', 'dismissed')),
            confidence REAL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            occurred_at INTEGER NOT NULL,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE,
            FOREIGN KEY(lexical_entry_id) REFERENCES language_lexical_entries(id) ON DELETE SET NULL,
            FOREIGN KEY(phrase_id) REFERENCES language_phrases(id) ON DELETE SET NULL,
            FOREIGN KEY(learning_item_id) REFERENCES learning_items(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_language_srs_evidence_profile_time
            ON language_srs_evidence(profile_id, occurred_at DESC);
        CREATE INDEX IF NOT EXISTS idx_language_srs_evidence_item
            ON language_srs_evidence(learning_item_id, occurred_at DESC);
        "#,
    ),
    // Migration 097: normalized sentence/media alignment ranges used by
    // original-audio-first replay. Stale fingerprints never resolve silently.
    Migration::new(
        "097_language_sentence_audio_alignment",
        r#"
        CREATE TABLE IF NOT EXISTS language_audio_alignments (
            id TEXT PRIMARY KEY,
            profile_id TEXT,
            source_type TEXT NOT NULL,
            source_id TEXT NOT NULL,
            sentence_id TEXT NOT NULL,
            media_id TEXT NOT NULL,
            source_fingerprint TEXT NOT NULL,
            media_fingerprint TEXT NOT NULL,
            start_ms INTEGER NOT NULL,
            end_ms INTEGER NOT NULL,
            confidence REAL NOT NULL,
            method TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'ready'
                CHECK(status IN ('ready', 'stale', 'ambiguous', 'failed')),
            provider_id TEXT,
            provider_version TEXT,
            error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE,
            UNIQUE(profile_id, source_id, sentence_id, media_id, source_fingerprint, media_fingerprint)
        );

        CREATE INDEX IF NOT EXISTS idx_language_audio_alignments_source_sentence
            ON language_audio_alignments(profile_id, source_id, sentence_id, status);
        CREATE INDEX IF NOT EXISTS idx_language_audio_alignments_media_range
            ON language_audio_alignments(media_id, start_ms, end_ms);

        CREATE TABLE IF NOT EXISTS language_audio_alignment_candidates (
            id TEXT PRIMARY KEY,
            alignment_id TEXT NOT NULL,
            transcript_text TEXT,
            media_text TEXT,
            start_ms INTEGER NOT NULL,
            end_ms INTEGER NOT NULL,
            confidence REAL NOT NULL,
            method TEXT NOT NULL,
            accepted INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(alignment_id) REFERENCES language_audio_alignments(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_language_audio_alignment_candidates_alignment
            ON language_audio_alignment_candidates(alignment_id, confidence DESC);
        "#,
    ),
    // Migration 098: shared practice attempt retention and recommendation
    // candidate lifecycle. Derived feedback is optional and never a scheduler.
    Migration::new(
        "098_language_practice_and_recommendations",
        r#"
        CREATE TABLE IF NOT EXISTS language_practice_attempts (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            mode TEXT NOT NULL CHECK(mode IN ('shadowing', 'dictation', 'writing', 'pronunciation')),
            source_type TEXT,
            source_id TEXT,
            source_anchor_json TEXT,
            prompt_text TEXT NOT NULL,
            raw_response TEXT,
            normalized_response TEXT,
            comparison_json TEXT,
            provider_id TEXT,
            provider_version TEXT,
            privacy_mode TEXT NOT NULL DEFAULT 'local-only',
            retention_expires_at INTEGER,
            active_evidence_accepted INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_language_practice_attempts_profile_time
            ON language_practice_attempts(profile_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_language_practice_attempts_source
            ON language_practice_attempts(source_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS language_recommendation_candidates (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_id TEXT NOT NULL,
            source_fingerprint TEXT NOT NULL,
            title TEXT NOT NULL,
            url TEXT,
            explanation_json TEXT NOT NULL DEFAULT '{}',
            ranking_json TEXT NOT NULL DEFAULT '{}',
            coverage_status TEXT NOT NULL DEFAULT 'pending'
                CHECK(coverage_status IN ('pending', 'fresh', 'stale', 'unavailable')),
            lifecycle TEXT NOT NULL DEFAULT 'candidate'
                CHECK(lifecycle IN ('candidate', 'accepted', 'dismissed', 'snoozed', 'expired')),
            snoozed_until INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(profile_id) REFERENCES language_profiles(id) ON DELETE CASCADE,
            UNIQUE(profile_id, source_type, source_id, source_fingerprint)
        );

        CREATE INDEX IF NOT EXISTS idx_language_recommendations_profile_lifecycle
            ON language_recommendation_candidates(profile_id, lifecycle, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_language_recommendations_coverage
            ON language_recommendation_candidates(profile_id, coverage_status, updated_at DESC);
        "#,
    ),
    // Migration 099: add lifecycle/source-version fields needed to resume a
    // compact practice session without confusing stale source results.
    Migration::new(
        "099_language_practice_attempt_status_and_fingerprint",
        r#"
        ALTER TABLE language_practice_attempts ADD COLUMN status TEXT NOT NULL DEFAULT 'prompted';
        ALTER TABLE language_practice_attempts ADD COLUMN source_fingerprint TEXT;
        CREATE INDEX IF NOT EXISTS idx_language_practice_attempts_fingerprint
            ON language_practice_attempts(profile_id, source_fingerprint, updated_at DESC);
        "#,
    ),
    // Migration 100: preserve the dictation reveal decision across durable
    // resume so a revealed answer cannot later be treated as unassisted.
    Migration::new(
        "100_language_practice_attempt_revealed",
        r#"
        ALTER TABLE language_practice_attempts ADD COLUMN revealed INTEGER NOT NULL DEFAULT 0;
        "#,
    ),
    // Migration 101: retain exact media provenance for audio-backed practice
    // without storing the recording itself in the compact attempt row.
    Migration::new(
        "101_language_practice_media_range",
        r#"
        ALTER TABLE language_practice_attempts ADD COLUMN media_id TEXT;
        ALTER TABLE language_practice_attempts ADD COLUMN start_ms INTEGER;
        ALTER TABLE language_practice_attempts ADD COLUMN end_ms INTEGER;
        CREATE INDEX IF NOT EXISTS idx_language_practice_attempts_media_range
            ON language_practice_attempts(profile_id, media_id, start_ms, end_ms);
        "#,
    ),
    // Migration 102: retain bounded browser-capture evidence, provenance, and
    // smart-organization state on registry image assets so browser-imported
    // images flow through the same deterministic/LLM tagging pipeline as
    // documents, extracts, and learning items.
    Migration::new(
        "102_image_asset_browser_metadata",
        r#"
        ALTER TABLE image_assets ADD COLUMN metadata TEXT;
        "#,
    ),
    // Migration 103: Complete Plethora identity migration — rename legacy SM-20
    // arena tables to arena_*, drop obsolete diagnostic tables, and migrate
    // learning_items.algorithm_type values to canonical Plethora identifiers.
    Migration::new(
        "103_complete_plethora_identity_migration",
        r#"
        ALTER TABLE sm20_arena RENAME TO arena_state;
        ALTER TABLE sm20_m2_optimizer RENAME TO arena_m2_optimizer;
        ALTER TABLE sm20_m3_matrices RENAME TO arena_m3_matrices;
        ALTER TABLE sm20_model_params RENAME TO arena_model_params;

        DROP TABLE IF EXISTS sm20_matrices;
        DROP TABLE IF EXISTS sm20_recall_cells;
        DROP TABLE IF EXISTS sm20_optimizer_profiles;

        UPDATE learning_items SET algorithm_type = 'adaptive' WHERE algorithm_type = 'sm18';
        UPDATE learning_items SET algorithm_type = 'precision' WHERE algorithm_type = 'sm20';
        UPDATE learning_items SET algorithm_type = 'classic' WHERE algorithm_type = 'sm2';
        UPDATE learning_items SET algorithm_type = 'classic_5' WHERE algorithm_type = 'sm5';
        UPDATE learning_items SET algorithm_type = 'classic_8' WHERE algorithm_type = 'sm8';
        UPDATE learning_items SET algorithm_type = 'classic_15' WHERE algorithm_type = 'sm15';
        "#,
    ),
    Migration::new(
        "104_transcript_segment_words_json",
        r#"
        ALTER TABLE transcript_segments ADD COLUMN words_json TEXT;
        "#,
    ),
    // Migration 105: On-device transcription checkpoints (Android STT).
    // Resume state for interrupted on-device jobs: the decode offset the job
    // reached plus how many segments the orchestrator persisted, keyed by
    // document. Additive and forward-compatible (spec:
    // android-on-device-transcription, chunked processing with resume).
    Migration::new(
        "105_transcription_checkpoints",
        r#"
        CREATE TABLE IF NOT EXISTS transcription_checkpoints (
            document_id TEXT PRIMARY KEY,
            model_id TEXT NOT NULL,
            decode_offset_ms INTEGER NOT NULL DEFAULT 0,
            segment_cursor INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        );
        "#,
    ),
    // Migration 106: Plethora Pro v2 sync local journal (PRD §10).
    // Recreates sync bookkeeping dropped in 087_drop_sync_tables using the
    // delta-log/outbox model — no Yjs tables.
    Migration::new(
        "106_plethora_pro_sync_journal",
        r#"
        CREATE TABLE IF NOT EXISTS sync_outbox (
            change_id TEXT PRIMARY KEY,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            base_revision INTEGER,
            payload BLOB NOT NULL,
            hlc TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            last_attempt_at INTEGER,
            sync_status TEXT NOT NULL DEFAULT 'pending'
        );
        CREATE INDEX IF NOT EXISTS idx_sync_outbox_status_created
            ON sync_outbox(sync_status, created_at);
        CREATE INDEX IF NOT EXISTS idx_sync_outbox_entity
            ON sync_outbox(entity_type, entity_id, sync_status);

        CREATE TABLE IF NOT EXISTS sync_cursor (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            last_server_cursor INTEGER NOT NULL DEFAULT 0,
            last_successful_sync INTEGER,
            device_id TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS sync_clock (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            logical_time INTEGER NOT NULL DEFAULT 0,
            last_physical_ms INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS sync_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        "#,
    ),
    Migration::new(
        "107_plethora_pro_sync_issues_bootstrap",
        r#"
        CREATE TABLE IF NOT EXISTS sync_issues (
            id TEXT PRIMARY KEY,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            conflict_kind TEXT NOT NULL DEFAULT 'revision',
            local_change_id TEXT,
            remote_hlc TEXT,
            server_revision INTEGER NOT NULL DEFAULT 0,
            base_revision INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'open',
            resolution TEXT,
            created_at INTEGER NOT NULL,
            resolved_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_sync_issues_status_created
            ON sync_issues(status, created_at);

        CREATE TABLE IF NOT EXISTS sync_bootstrap (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            phase TEXT NOT NULL DEFAULT 'idle',
            cursor_entity TEXT,
            cursor_id TEXT,
            total_entities INTEGER NOT NULL DEFAULT 0,
            completed_entities INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL DEFAULT 0
        );
        "#,
    ),
    Migration::new(
        "108_plethora_pro_sync_telemetry",
        r#"
        CREATE TABLE IF NOT EXISTS sync_telemetry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sync_telemetry_created
            ON sync_telemetry(created_at DESC);
        "#,
    ),
    // Sync ordering/tombstone state is deliberately separate from domain
    // timestamps. Domain date_modified/updated_at fields are user data and
    // must never be repurposed as transport clocks.
    Migration::new(
        "109_sync_entity_state",
        r#"
        CREATE TABLE IF NOT EXISTS sync_entity_state (
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            last_hlc TEXT NOT NULL,
            last_device_id TEXT NOT NULL,
            server_revision INTEGER,
            tombstoned INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (entity_type, entity_id)
        );
        CREATE INDEX IF NOT EXISTS idx_sync_entity_state_tombstone
            ON sync_entity_state(tombstoned, updated_at);

        -- A process can die after marking a row uploading, and older builds
        -- left ordinary LWW conflicts in failed forever. Both are safe to
        -- retry under the hardened idempotent protocol.
        UPDATE sync_outbox
        SET sync_status = 'pending'
        WHERE sync_status = 'uploading';

        UPDATE sync_outbox
        SET sync_status = 'pending', base_revision = NULL
        WHERE sync_status = 'failed' AND operation IN ('update', 'delete');
        "#,
    ),
    Migration::new(
        "110_sync_entity_aliases",
        r#"
        CREATE TABLE IF NOT EXISTS sync_entity_aliases (
            entity_type TEXT NOT NULL,
            source_id TEXT NOT NULL,
            canonical_id TEXT NOT NULL,
            identity_key TEXT,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (entity_type, source_id)
        );
        CREATE INDEX IF NOT EXISTS idx_sync_entity_alias_canonical
            ON sync_entity_aliases(entity_type, canonical_id);
        CREATE INDEX IF NOT EXISTS idx_sync_entity_alias_identity
            ON sync_entity_aliases(entity_type, identity_key)
            WHERE identity_key IS NOT NULL;
        "#,
    ),
    Migration::new(
        "111_sync_field_state",
        r#"
        CREATE TABLE IF NOT EXISTS sync_field_state (
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            field_group TEXT NOT NULL,
            last_hlc TEXT NOT NULL,
            last_device_id TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (entity_type, entity_id, field_group)
        );
        CREATE INDEX IF NOT EXISTS idx_sync_field_state_entity
            ON sync_field_state(entity_type, entity_id);
        "#,
    ),
    Migration::new(
        "112_sync_review_schedule_snapshots",
        r#"
        ALTER TABLE review_results ADD COLUMN sync_post_item_json TEXT;
        CREATE INDEX IF NOT EXISTS idx_review_results_sync_order
            ON review_results(item_id, reviewed_at_ms, device_id, id);
        "#,
    ),
    Migration::new(
        "113_sync_image_blob_reference",
        r#"
        ALTER TABLE image_assets ADD COLUMN sync_blob_reference TEXT;
        CREATE INDEX IF NOT EXISTS idx_image_assets_sync_blob_reference
            ON image_assets(sync_blob_reference)
            WHERE sync_blob_reference IS NOT NULL;
        "#,
    ),
    // Migration 114: transcription platform job metadata (mode, duration checkpoints).
    Migration::new(
        "114_transcription_job_metadata",
        r#"
        ALTER TABLE transcription_queue ADD COLUMN processed_duration_ms INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE transcription_queue ADD COLUMN total_duration_ms INTEGER;
        ALTER TABLE transcription_queue ADD COLUMN transcription_mode TEXT NOT NULL DEFAULT 'auto';
        "#,
    ),
    // Migration 115: FSRS-7 dual-trace memory state and migration bookkeeping.
    Migration::new(
        "115_fsrs7_memory_state_and_migration",
        r#"
        ALTER TABLE learning_items ADD COLUMN memory_state_stability_fast REAL;
        ALTER TABLE learning_items ADD COLUMN fsrs_implementation_version TEXT;
        ALTER TABLE learning_items ADD COLUMN legacy_algorithm_type TEXT;
        ALTER TABLE learning_items ADD COLUMN legacy_algorithm_state TEXT;

        CREATE TABLE IF NOT EXISTS fsrs7_migration_runs (
            id TEXT PRIMARY KEY,
            started_at INTEGER NOT NULL,
            completed_at INTEGER,
            status TEXT NOT NULL,
            items_total INTEGER NOT NULL DEFAULT 0,
            items_migrated INTEGER NOT NULL DEFAULT 0,
            last_item_id TEXT,
            error_message TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_fsrs7_migration_runs_status
            ON fsrs7_migration_runs(status, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_learning_items_fsrs7_version
            ON learning_items(fsrs_implementation_version)
            WHERE fsrs_implementation_version IS NOT NULL;
        "#,
    ),
    // Migration 116: flashcard source provenance. Nullable JSON envelope
    // (`CardSourceReference`) for cards created without an extract; cards
    // linked to extracts keep anchoring through `extracts.selection_context`.
    Migration::new(
        "116_add_learning_item_source_reference",
        r#"
        ALTER TABLE learning_items ADD COLUMN source_reference TEXT;
        "#,
    ),
    // Migration 117: Dynamic Adaptive Queue Engine storage.
    //
    // Three additive surfaces, no backfill, no rewrite of any pre-existing
    // table's rows:
    //   * daqe_model_cache     — decision-model judgements keyed by a hash of the
    //                             item's CONTENT plus the rubric version. Content
    //                             changes produce a new hash, so staleness is
    //                             implicit rather than a sweep job.
    //   * daqe_queue_snapshots — the published result of a background re-rank,
    //                             including the per-term breakdown, so the queue
    //                             can render the previous order while a new one
    //                             computes.
    //   * item_activity_log    — DAQE's dwell contract. `active_seconds` already
    //                             exists and is the verified active dwell; the new
    //                             columns carry the discarded idle time and the
    //                             interaction evidence the friction penalty reads.
    //
    // Everything is nullable so an item type that never gets measured reports
    // "untracked" (Metric<T>::Untracked) instead of a fabricated 0.
    Migration::new(
        "117_daqe_queue_engine",
        r#"
        CREATE TABLE IF NOT EXISTS daqe_model_cache (
            content_hash TEXT PRIMARY KEY,
            rubric_version INTEGER NOT NULL,
            score REAL,
            tier TEXT,
            -- INTEGER, not REAL: `evaluateNoul` is a binary gate. A REAL column
            -- invites a fractional value that no consumer would know how to read.
            gate INTEGER,
            computed_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_daqe_model_cache_computed_at
            ON daqe_model_cache(computed_at DESC);

        CREATE TABLE IF NOT EXISTS daqe_queue_snapshots (
            id TEXT PRIMARY KEY,
            collection_id TEXT,
            profile TEXT,
            knobs_json TEXT NOT NULL,
            ranked_ids_json TEXT NOT NULL,
            term_breakdown_json TEXT,
            top10_json TEXT NOT NULL,
            computed_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_daqe_queue_snapshots_lookup
            ON daqe_queue_snapshots(profile, collection_id, computed_at DESC);

        ALTER TABLE item_activity_log ADD COLUMN idle_time_ms INTEGER;
        ALTER TABLE item_activity_log ADD COLUMN scroll_depth_ratio REAL;
        ALTER TABLE item_activity_log ADD COLUMN interaction_density REAL;
        ALTER TABLE item_activity_log ADD COLUMN exit_action TEXT;
        "#,
    ),
    Migration::new(
        "118_add_saved_queues",
        r#"
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
        "#,
    ),
    Migration::new(
        "119_add_chatterbox_voice_profiles",
        r#"
        CREATE TABLE IF NOT EXISTS chatterbox_voice_profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            avatar_color TEXT,
            playback_speed REAL NOT NULL DEFAULT 1.0,
            preferred_content_types_json TEXT NOT NULL DEFAULT '[]',
            embedding_path TEXT NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_chatterbox_voice_profiles_created
            ON chatterbox_voice_profiles(created_at DESC);
        "#,
    ),
    Migration::new(
        "120_rss_customization",
        r#"
        ALTER TABLE rss_articles ADD COLUMN categories TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE rss_user_preferences ADD COLUMN font_family TEXT;
        ALTER TABLE rss_user_preferences ADD COLUMN font_size INTEGER;
        ALTER TABLE rss_user_preferences ADD COLUMN line_height REAL;
        ALTER TABLE rss_user_preferences ADD COLUMN content_width INTEGER;
        ALTER TABLE rss_user_preferences ADD COLUMN text_align TEXT;
        ALTER TABLE rss_user_preferences ADD COLUMN thumbnail_size TEXT;
        ALTER TABLE rss_user_preferences ADD COLUMN card_height TEXT;
    "#,
    ),
    Migration::new(
        "121_canonical_youtube_transcripts",
        r#"
        ALTER TABLE youtube_transcripts ADD COLUMN language TEXT;
        UPDATE documents SET content = (
            SELECT transcript FROM youtube_transcripts yt
            WHERE (yt.document_id = documents.id OR
                (documents.file_type = 'youtube' AND instr(documents.file_path, yt.video_id) > 0))
              AND trim(yt.transcript) <> '' LIMIT 1
        ) WHERE (content IS NULL OR content = '') AND EXISTS (
            SELECT 1 FROM youtube_transcripts yt
            WHERE (yt.document_id = documents.id OR
                (documents.file_type = 'youtube' AND instr(documents.file_path, yt.video_id) > 0))
              AND trim(yt.transcript) <> ''
        );
        "#,
    ),
    // Migration 122: canonical Assistant conversation ownership.
    //
    // Additive on purpose: `ai_conversations` / `ai_messages` keep their ids,
    // existing columns and foreign keys (created in migration 003, long before
    // any rows were written by a UI). New columns get honest defaults and
    // pre-existing rows stay readable ("unassigned" identity, legacy content).
    //
    // New tables:
    //   ai_conversation_turns      one row per turn (append-only lifecycle)
    //   ai_conversation_attempts   per-attempt frozen finals; retry keeps the
    //                              user turn and adds an attempt
    //   ai_conversation_drafts     per-device working draft (durable)
    //   ai_conversation_sources    source edges for reauthorization
    //   ai_message_sources         per-message validated source snapshot
    //   ai_conversation_import_journal  checkpointed legacy import log
    Migration::new(
        "122_add_canonical_conversations",
        r#"
        -- If migration 003 never ran in a legacy database, recreate its shape
        -- (without touching an existing table).
        CREATE TABLE IF NOT EXISTS ai_conversations (
            id TEXT PRIMARY KEY,
            document_id TEXT,
            title TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            date_created TEXT NOT NULL,
            date_modified TEXT NOT NULL,
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS ai_messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            tokens_used INTEGER,
            FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_ai_conversations_document_id ON ai_conversations(document_id);
        CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_id ON ai_messages(conversation_id);

        -- Additive conversation columns. `record_version` distinguishes
        -- canonical (2) from legacy (1) rows read back by rollback readers.
        ALTER TABLE ai_conversations ADD COLUMN record_version INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE ai_conversations ADD COLUMN owner_profile_id TEXT NOT NULL DEFAULT 'unassigned';
        ALTER TABLE ai_conversations ADD COLUMN collection_id TEXT;
        ALTER TABLE ai_conversations ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE ai_conversations ADD COLUMN sync_policy TEXT NOT NULL DEFAULT 'device-local';
        ALTER TABLE ai_conversations ADD COLUMN deleted_at TEXT;
        ALTER TABLE ai_conversations ADD COLUMN legacy_aliases TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE ai_conversations ADD COLUMN context_policy_json TEXT NOT NULL DEFAULT '{}';
        ALTER TABLE ai_conversations ADD COLUMN payload_json TEXT;
        ALTER TABLE ai_conversations ADD COLUMN updated_at_ms INTEGER;
        ALTER TABLE ai_conversations ADD COLUMN created_at_ms INTEGER;
        -- `provider`/`model` are NOT NULL in the legacy schema; new
        -- pre-generation conversations use this explicit sentinel rather than
        -- fabricating a provider.
        ALTER TABLE ai_conversations ADD COLUMN provider_kind TEXT NOT NULL DEFAULT 'unassigned';
        ALTER TABLE ai_conversations ADD COLUMN provider_configuration_id TEXT;

        -- Additive message columns.
        ALTER TABLE ai_messages ADD COLUMN turn_id TEXT;
        ALTER TABLE ai_messages ADD COLUMN order_key TEXT;
        ALTER TABLE ai_messages ADD COLUMN thinking TEXT;
        ALTER TABLE ai_messages ADD COLUMN evidence_json TEXT;
        ALTER TABLE ai_messages ADD COLUMN payload_json TEXT;
        ALTER TABLE ai_messages ADD COLUMN created_at_ms INTEGER;

        CREATE INDEX IF NOT EXISTS idx_ai_conversations_owner_updated
            ON ai_conversations(owner_profile_id, updated_at_ms);
        CREATE INDEX IF NOT EXISTS idx_ai_conversations_tombstone
            ON ai_conversations(deleted_at);
        CREATE INDEX IF NOT EXISTS idx_ai_messages_turn ON ai_messages(turn_id);
        CREATE INDEX IF NOT EXISTS idx_ai_messages_order ON ai_messages(conversation_id, order_key);

        CREATE TABLE IF NOT EXISTS ai_conversation_turns (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            parent_turn_id TEXT,
            user_message_id TEXT NOT NULL,
            status TEXT NOT NULL,
            accepted_attempt_id TEXT,
            request_plan_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_ai_turns_conversation
            ON ai_conversation_turns(conversation_id, created_at_ms);

        CREATE TABLE IF NOT EXISTS ai_conversation_attempts (
            id TEXT PRIMARY KEY,
            turn_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            status TEXT NOT NULL,
            failure_reason TEXT,
            detached INTEGER NOT NULL DEFAULT 0,
            request_plan_json TEXT NOT NULL,
            provider_json TEXT,
            started_at_ms INTEGER NOT NULL,
            finished_at_ms INTEGER,
            FOREIGN KEY (turn_id) REFERENCES ai_conversation_turns(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_ai_attempts_turn ON ai_conversation_attempts(turn_id);

        CREATE TABLE IF NOT EXISTS ai_conversation_drafts (
            conversation_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 0,
            text TEXT NOT NULL DEFAULT '',
            payload_json TEXT NOT NULL DEFAULT '{}',
            updated_at_ms INTEGER NOT NULL,
            PRIMARY KEY (conversation_id, device_id),
            FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS ai_conversation_sources (
            conversation_id TEXT NOT NULL,
            attachment_id TEXT NOT NULL,
            library_id TEXT,
            source_kind TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'optional',
            origin TEXT NOT NULL,
            title TEXT NOT NULL,
            content_version TEXT,
            locator_json TEXT,
            removed_at_ms INTEGER,
            payload_json TEXT,
            PRIMARY KEY (conversation_id, attachment_id),
            FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_ai_conversation_sources_library
            ON ai_conversation_sources(library_id);

        CREATE TABLE IF NOT EXISTS ai_message_sources (
            message_id TEXT NOT NULL,
            attachment_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (message_id, attachment_id),
            FOREIGN KEY (message_id) REFERENCES ai_messages(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS ai_conversation_import_journal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_profile_id TEXT NOT NULL,
            origin TEXT NOT NULL,
            record_key TEXT NOT NULL,
            record_digest TEXT NOT NULL,
            assigned_conversation_id TEXT,
            status TEXT NOT NULL,
            reason TEXT,
            raw_json TEXT,
            imported_at_ms INTEGER NOT NULL,
            UNIQUE (owner_profile_id, origin, record_digest)
        );
        CREATE INDEX IF NOT EXISTS idx_ai_import_journal_cursor
            ON ai_conversation_import_journal(owner_profile_id, origin, id);
        "#,
    ),
    // Session ingestion owns media independently of transcription and TTS editions.
    Migration::new(
        "123_recording_session_ownership",
        r#"
        CREATE TABLE recording_sessions (
            id TEXT PRIMARY KEY NOT NULL,
            document_id TEXT NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
            origin TEXT NOT NULL CHECK(origin IN ('recorded', 'file', 'transcript', 'url')),
            content_type TEXT NOT NULL,
            profile_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(profile_json)),
            capture_state TEXT NOT NULL DEFAULT 'idle' CHECK(capture_state IN
                ('idle', 'requesting-permission', 'recording', 'paused', 'interrupted',
                 'finalizing', 'saved', 'recoverable', 'failed', 'discarded')),
            ingestion_state TEXT NOT NULL DEFAULT 'staging' CHECK(ingestion_state IN
                ('staging', 'saved', 'partial', 'failed', 'cancelled')),
            transcript_id INTEGER REFERENCES transcripts(id) ON DELETE SET NULL,
            media_asset_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
            transcript_revision INTEGER NOT NULL DEFAULT 0 CHECK(transcript_revision >= 0),
            overview_json TEXT CHECK(overview_json IS NULL OR json_valid(overview_json)),
            overview_revision INTEGER CHECK(overview_revision IS NULL OR overview_revision >= 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
        );
        CREATE INDEX idx_recording_sessions_updated ON recording_sessions(updated_at, id);

        CREATE TABLE media_assets (
            id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL REFERENCES recording_sessions(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK(kind IN ('original', 'capture', 'derived')),
            relative_path TEXT NOT NULL CHECK(length(relative_path) > 0
                AND relative_path NOT LIKE '/%' AND instr(relative_path, ':') = 0
                AND instr(relative_path, char(92)) = 0 AND instr(relative_path, char(0)) = 0
                AND relative_path != '..' AND relative_path NOT LIKE '../%'
                AND relative_path NOT LIKE '%/../%' AND relative_path NOT LIKE '%/..'),
            mime TEXT NOT NULL,
            byte_length INTEGER NOT NULL DEFAULT 0 CHECK(byte_length >= 0),
            sha256 TEXT CHECK(sha256 IS NULL OR
                (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
            duration_ms INTEGER CHECK(duration_ms IS NULL OR duration_ms >= 0),
            state TEXT NOT NULL DEFAULT 'staging' CHECK(state IN
                ('staging', 'ready', 'partial', 'missing', 'deleting')),
            source_url TEXT,
            source_adapter TEXT,
            created_at TEXT NOT NULL,
            UNIQUE(session_id, relative_path)
        );
        CREATE INDEX idx_media_assets_hash ON media_assets(sha256, kind);
        CREATE INDEX idx_media_assets_session ON media_assets(session_id, id);

        CREATE TRIGGER recording_session_asset_insert BEFORE INSERT ON recording_sessions
        WHEN NEW.media_asset_id IS NOT NULL AND NOT EXISTS
            (SELECT 1 FROM media_assets WHERE id = NEW.media_asset_id AND session_id = NEW.id)
        BEGIN
            SELECT RAISE(ABORT, 'Recording asset belongs to another session');
        END;
        CREATE TRIGGER recording_session_asset_update BEFORE UPDATE OF media_asset_id ON recording_sessions
        WHEN NEW.media_asset_id IS NOT NULL AND NOT EXISTS
            (SELECT 1 FROM media_assets WHERE id = NEW.media_asset_id AND session_id = NEW.id)
        BEGIN
            SELECT RAISE(ABORT, 'Recording asset belongs to another session');
        END;
        CREATE TRIGGER recording_asset_owner_immutable BEFORE UPDATE OF session_id ON media_assets
        WHEN NEW.session_id != OLD.session_id
        BEGIN
            SELECT RAISE(ABORT, 'Recording asset ownership is immutable');
        END;

        CREATE TABLE recording_parts (
            asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
            writer_epoch TEXT NOT NULL,
            sequence INTEGER NOT NULL CHECK(sequence >= 0),
            relative_path TEXT NOT NULL CHECK(length(relative_path) > 0),
            byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
            sha256 TEXT NOT NULL CHECK(length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
            start_ms INTEGER NOT NULL CHECK(start_ms >= 0),
            duration_ms INTEGER NOT NULL CHECK(duration_ms >= 0),
            format_json TEXT NOT NULL CHECK(json_valid(format_json)),
            committed_at TEXT NOT NULL,
            PRIMARY KEY(asset_id, sequence),
            UNIQUE(asset_id, writer_epoch, sequence),
            UNIQUE(asset_id, relative_path)
        );

        CREATE TABLE recording_session_markers (
            id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL REFERENCES recording_sessions(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK(kind IN
                ('interesting', 'confusing', 'recent-extract', 'card-candidate', 'bookmark')),
            media_ms INTEGER NOT NULL CHECK(media_ms >= 0),
            window_ms INTEGER NOT NULL DEFAULT 0 CHECK(window_ms >= 0),
            part_sequence INTEGER CHECK(part_sequence IS NULL OR part_sequence >= 0),
            note TEXT,
            evidence_json TEXT CHECK(evidence_json IS NULL OR json_valid(evidence_json)),
            state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN
                ('pending', 'resolved', 'needs-confirmation')),
            created_at TEXT NOT NULL
        );
        CREATE INDEX idx_recording_markers_session
            ON recording_session_markers(session_id, media_ms, id);

        -- File deletion is journaled separately; this row survives owner deletion.
        CREATE TABLE recording_cleanup_journal (
            id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT REFERENCES recording_sessions(id) ON DELETE SET NULL,
            asset_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
            relative_path TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'failed')),
            error_code TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_recording_cleanup_status ON recording_cleanup_journal(status, created_at);
        "#,
    ),
    Migration::new(
        "124_canonical_session_segments",
        r#"
        ALTER TABLE transcripts ADD COLUMN session_id TEXT
            REFERENCES recording_sessions(id) ON DELETE SET NULL;
        ALTER TABLE transcripts ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0);
        CREATE INDEX idx_transcripts_session ON transcripts(session_id);

        -- Preserve AUTOINCREMENT's high-water mark, including deleted legacy IDs.
        CREATE TEMP TABLE _recording_segment_sequence AS
            SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'transcript_segments'), 0) AS seq;
        CREATE TABLE transcript_segments_recording (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transcript_id INTEGER NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
            start_ms INTEGER,
            end_ms INTEGER,
            text TEXT NOT NULL,
            confidence REAL,
            words_json TEXT,
            segment_key TEXT NOT NULL DEFAULT '',
            ordinal INTEGER NOT NULL DEFAULT -1 CHECK(ordinal >= -1),
            speaker_id TEXT,
            timing_kind TEXT NOT NULL DEFAULT 'measured' CHECK(timing_kind IN ('measured', 'imported', 'none')),
            revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
            metadata_json TEXT,
            CHECK((timing_kind = 'none' AND start_ms IS NULL AND end_ms IS NULL) OR
                (timing_kind IN ('measured', 'imported') AND start_ms IS NOT NULL AND end_ms IS NOT NULL
                 AND start_ms >= 0 AND end_ms >= start_ms))
        );
        INSERT INTO transcript_segments_recording
            (id, transcript_id, start_ms, end_ms, text, confidence, words_json, segment_key, ordinal)
        SELECT id, transcript_id, start_ms, end_ms, text, confidence, words_json,
            'legacy:' || id, ROW_NUMBER() OVER (PARTITION BY transcript_id ORDER BY start_ms, id) - 1
        FROM transcript_segments;
        DROP TABLE transcript_segments;
        ALTER TABLE transcript_segments_recording RENAME TO transcript_segments;
        INSERT INTO sqlite_sequence(name, seq)
            SELECT 'transcript_segments', (SELECT seq FROM _recording_segment_sequence)
            WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'transcript_segments');
        UPDATE sqlite_sequence SET seq = MAX(seq, (SELECT seq FROM _recording_segment_sequence))
            WHERE name = 'transcript_segments';
        DROP TABLE _recording_segment_sequence;

        CREATE INDEX idx_transcript_segments_time ON transcript_segments(transcript_id, start_ms);
        CREATE UNIQUE INDEX idx_transcript_segments_checkpoint
            ON transcript_segments(transcript_id, start_ms, end_ms, text);
        CREATE UNIQUE INDEX idx_transcript_segments_keys ON transcript_segments(transcript_id, segment_key);
        CREATE INDEX idx_transcript_segments_ordinal ON transcript_segments(transcript_id, ordinal, id);

        -- Legacy timed writers omit the new fields. Each inserted row is assigned
        -- its durable legacy ID before the next row, including multi-row batches.
        CREATE TRIGGER transcript_segment_legacy_identity AFTER INSERT ON transcript_segments
        WHEN NEW.segment_key = '' OR NEW.ordinal = -1
        BEGIN
            UPDATE transcript_segments SET
                segment_key = CASE WHEN NEW.segment_key = '' THEN 'legacy:' || NEW.id ELSE NEW.segment_key END,
                ordinal = CASE WHEN NEW.ordinal = -1 THEN
                    (SELECT COALESCE(MAX(ordinal), -1) + 1 FROM transcript_segments
                     WHERE transcript_id = NEW.transcript_id AND id != NEW.id)
                    ELSE NEW.ordinal END
            WHERE id = NEW.id;
        END;
        "#,
    ),
    // Migration 125: concept-link origin + lifecycle metadata
    // (change `complete-knowledge-relationships-and-coverage`).
    //
    // Additive on purpose:
    // - `origin` is IMMUTABLE creation provenance (`ai`/`user`); legacy rows
    //   default to `unknown` and are never guessed retroactively.
    // - `analysis_id` backs the five-proposals-per-analysis cap; `source_revision`
    //   records the evidence revision a proposal was derived from.
    // - `endorsed_at`/`dismissed_at`/`updated_at` make endorsement and
    //   dismissal history inspectable without rewriting `created_by` facts.
    //
    // Legacy duplicate reconciliation keeps exactly one LIVE row per
    // fingerprint, preferring an endorsed (`created_by = 'user'`) row, then the
    // earliest. Dismissed rows are retained so dismissal history survives.
    // The partial unique index then blocks concurrent duplicate live inserts
    // while still allowing multiple historical dismissed rows.
    Migration::new(
        "125_add_concept_link_origin_lifecycle",
        r#"
        ALTER TABLE concept_links ADD COLUMN origin TEXT NOT NULL DEFAULT 'unknown';
        ALTER TABLE concept_links ADD COLUMN analysis_id TEXT;
        ALTER TABLE concept_links ADD COLUMN source_revision TEXT;
        ALTER TABLE concept_links ADD COLUMN endorsed_at TEXT;
        ALTER TABLE concept_links ADD COLUMN dismissed_at TEXT;
        ALTER TABLE concept_links ADD COLUMN updated_at TEXT;

        DELETE FROM concept_links
        WHERE is_dismissed = 0
          AND proposal_fingerprint IS NOT NULL
          AND trim(proposal_fingerprint) <> ''
          AND id <> (
              SELECT keeper.id
              FROM concept_links keeper
              WHERE keeper.proposal_fingerprint = concept_links.proposal_fingerprint
                AND keeper.is_dismissed = 0
              ORDER BY CASE WHEN keeper.created_by = 'user' THEN 0 ELSE 1 END,
                       keeper.created_at ASC,
                       keeper.id ASC
              LIMIT 1
          );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_concept_links_live_fingerprint
            ON concept_links(proposal_fingerprint)
            WHERE proposal_fingerprint IS NOT NULL
              AND trim(proposal_fingerprint) <> ''
              AND is_dismissed = 0;
        CREATE INDEX IF NOT EXISTS idx_concept_links_origin_created
            ON concept_links(origin, created_at);
        CREATE INDEX IF NOT EXISTS idx_concept_links_analysis
            ON concept_links(analysis_id);
        "#,
    ),
    // Migration 126: passage-score metadata + durable dismissal keys
    // (change `complete-reader-extract-worthiness-integration`).
    // Additive only. `passage_scores` stays a derived cache keyed by the full
    // versioned passage digest; existing rows remain readable with NULL
    // metadata (treated as cache misses by the reader). No source text, source
    // geometry or document identifiers are stored here. Dismissals store only
    // opaque ids/revisions and cascade with the document.
    Migration::new(
        "126_add_passage_score_metadata_and_dismissals",
        r#"
        ALTER TABLE passage_scores ADD COLUMN reason TEXT;
        ALTER TABLE passage_scores ADD COLUMN classifier_version TEXT;
        ALTER TABLE passage_scores ADD COLUMN model_revision TEXT;
        ALTER TABLE passage_scores ADD COLUMN normalization_version TEXT;
        CREATE INDEX IF NOT EXISTS idx_passage_scores_created_at
            ON passage_scores(created_at);

        CREATE TABLE IF NOT EXISTS passage_score_dismissals (
            document_id TEXT NOT NULL,
            source_revision TEXT NOT NULL,
            passage_id TEXT NOT NULL,
            classifier_version TEXT NOT NULL,
            dismissed_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (document_id, source_revision, passage_id, classifier_version),
            FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_passage_score_dismissals_document
            ON passage_score_dismissals(document_id, source_revision);
        "#,
    ),
    Migration::new(
        "127_document_source_privacy",
        r#"
        ALTER TABLE documents ADD COLUMN is_local_only INTEGER NOT NULL DEFAULT 0 CHECK(is_local_only IN (0, 1));
        ALTER TABLE documents ADD COLUMN is_ai_excluded INTEGER NOT NULL DEFAULT 0 CHECK(is_ai_excluded IN (0, 1));
        ALTER TABLE documents ADD COLUMN privacy_version INTEGER NOT NULL DEFAULT 1 CHECK(privacy_version > 0);
        UPDATE documents SET
            is_local_only = CASE WHEN json_valid(metadata) THEN COALESCE(json_extract(metadata, '$.isLocalOnly') = 1, 0) ELSE 0 END,
            is_ai_excluded = CASE WHEN json_valid(metadata) THEN COALESCE(json_extract(metadata, '$.isAiExcluded') = 1, 0) ELSE 0 END;

        -- Derived entities inherit the current source policy without a second
        -- mutable privacy flag on cards/extracts/reviews/images.
        CREATE VIEW document_sync_ownership AS
            SELECT 'document' AS entity_type, id AS entity_id, id AS document_id FROM documents
            UNION ALL SELECT 'extract', id, document_id FROM extracts
            UNION ALL SELECT 'learning_item', id, document_id FROM learning_items
            UNION ALL SELECT 'learning_item', li.id, e.document_id
                FROM learning_items li JOIN extracts e ON e.id = li.extract_id
            UNION ALL SELECT 'review_result', r.id, li.document_id
                FROM review_results r JOIN learning_items li ON li.id = r.item_id
            UNION ALL SELECT 'review_result', r.id, e.document_id
                FROM review_results r JOIN learning_items li ON li.id = r.item_id
                JOIN extracts e ON e.id = li.extract_id
            UNION ALL SELECT 'image_asset', j.value, li.document_id
                FROM learning_items li,
                json_each(CASE WHEN json_valid(li.image_asset_ids) THEN li.image_asset_ids ELSE '[]' END) j
            UNION ALL SELECT 'image_asset', j.value, e.document_id
                FROM learning_items li JOIN extracts e ON e.id = li.extract_id,
                json_each(CASE WHEN json_valid(li.image_asset_ids) THEN li.image_asset_ids ELSE '[]' END) j;

        -- Retain restricted ownership if an extract/document link is removed.
        -- IDs only; an explicit source policy change clears its bindings.
        CREATE TABLE private_sync_ownership (
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            source_document_id TEXT NOT NULL,
            PRIMARY KEY(entity_type, entity_id, source_document_id)
        );
        CREATE INDEX idx_private_sync_source ON private_sync_ownership(source_document_id);
        CREATE VIEW card_index_restrictions AS
            SELECT o.entity_id AS card_id, o.document_id AS source_document_id, d.is_local_only, d.is_ai_excluded
                FROM document_sync_ownership o JOIN documents d ON d.id = o.document_id
                WHERE o.entity_type = 'learning_item'
            UNION ALL SELECT entity_id, source_document_id, 1, 0 FROM private_sync_ownership
                WHERE entity_type = 'learning_item';
        INSERT INTO private_sync_ownership
            SELECT DISTINCT o.entity_type, o.entity_id, o.document_id
            FROM document_sync_ownership o JOIN documents d ON d.id = o.document_id
            WHERE d.is_local_only = 1;

        DELETE FROM sync_outbox WHERE EXISTS (
            SELECT 1 FROM document_sync_ownership o JOIN documents d ON d.id = o.document_id
            WHERE o.entity_type = sync_outbox.entity_type AND o.entity_id = sync_outbox.entity_id
                AND d.is_local_only = 1
        );
        DELETE FROM semantic_chunks WHERE document_id IN (SELECT id FROM documents WHERE is_ai_excluded = 1);

        CREATE TRIGGER document_privacy_changed AFTER UPDATE OF is_local_only, is_ai_excluded ON documents
        WHEN NEW.is_local_only != OLD.is_local_only OR NEW.is_ai_excluded != OLD.is_ai_excluded
        BEGIN
            UPDATE documents SET privacy_version = OLD.privacy_version + 1 WHERE id = NEW.id;
            DELETE FROM private_sync_ownership WHERE source_document_id = NEW.id AND NEW.is_local_only = 0;
            INSERT OR IGNORE INTO private_sync_ownership
                SELECT entity_type, entity_id, document_id FROM document_sync_ownership
                WHERE document_id = NEW.id AND NEW.is_local_only = 1;
            DELETE FROM sync_outbox WHERE NEW.is_local_only = 1 AND EXISTS (
                SELECT 1 FROM private_sync_ownership o WHERE o.source_document_id = NEW.id
                    AND o.entity_type = sync_outbox.entity_type AND o.entity_id = sync_outbox.entity_id
            );
            DELETE FROM semantic_chunks WHERE document_id = NEW.id AND NEW.is_ai_excluded = 1;
            DELETE FROM semantic_chunks WHERE source_type = 'card'
                AND (NEW.is_local_only = 1 OR NEW.is_ai_excluded = 1) AND source_id IN (
                    SELECT entity_id FROM document_sync_ownership WHERE document_id = NEW.id AND entity_type = 'learning_item'
                );
        END;
        CREATE TRIGGER document_privacy_retain_before_delete BEFORE DELETE ON documents
        WHEN OLD.is_local_only = 1
        BEGIN
            INSERT OR IGNORE INTO private_sync_ownership
                SELECT entity_type, entity_id, document_id FROM document_sync_ownership WHERE document_id = OLD.id;
        END;
        CREATE TRIGGER extract_privacy_retain_before_delete BEFORE DELETE ON extracts
        BEGIN
            INSERT OR IGNORE INTO private_sync_ownership
                SELECT o.entity_type, o.entity_id, o.document_id FROM document_sync_ownership o
                JOIN documents d ON d.id = o.document_id
                WHERE o.document_id = OLD.document_id AND d.is_local_only = 1;
        END;
        CREATE TRIGGER card_privacy_retain_before_reparent BEFORE UPDATE OF document_id, extract_id ON learning_items
        BEGIN
            INSERT OR IGNORE INTO private_sync_ownership
                SELECT o.entity_type, o.entity_id, o.document_id FROM document_sync_ownership o
                JOIN documents d ON d.id = o.document_id
                WHERE d.is_local_only = 1 AND o.document_id IN (
                    SELECT document_id FROM document_sync_ownership WHERE entity_type = 'learning_item' AND entity_id = OLD.id
                );
        END;
        -- Metadata patches from older clients may add a restriction, never
        -- remove one. Explicit policy changes clear these legacy JSON keys.
        CREATE TRIGGER document_privacy_metadata AFTER UPDATE OF metadata ON documents
        WHEN json_valid(NEW.metadata)
        BEGIN
            UPDATE documents SET
                is_local_only = MAX(is_local_only, COALESCE(json_extract(NEW.metadata, '$.isLocalOnly') = 1, 0)),
                is_ai_excluded = MAX(is_ai_excluded, COALESCE(json_extract(NEW.metadata, '$.isAiExcluded') = 1, 0))
            WHERE id = NEW.id;
        END;
        -- An in-flight indexer cannot repopulate an excluded source after
        -- restriction changed while it was chunking or awaiting inference.
        CREATE TRIGGER document_privacy_chunk_insert BEFORE INSERT ON semantic_chunks
        WHEN EXISTS (SELECT 1 FROM documents WHERE id = NEW.document_id AND is_ai_excluded = 1)
        BEGIN
            SELECT RAISE(ABORT, 'Document excluded from AI');
        END;
        "#,
    ),
    // Migration 128: narrow retry-safe acceptance identity for agent learning
    // proposals. Additive: old callers leave both columns NULL and keep the
    // existing occlusion batch semantics (no duplicate enforcement change).
    // The lead allocated this identity; the registry is keyed by name, and a
    // concurrently landed 123_* recording migration keeps its own name.
    Migration::new(
        "128_add_learning_item_acceptance_idempotency",
        r#"
        ALTER TABLE learning_items ADD COLUMN acceptance_id TEXT;
        ALTER TABLE learning_items ADD COLUMN proposal_id TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_items_acceptance_proposal
            ON learning_items(acceptance_id, proposal_id)
            WHERE acceptance_id IS NOT NULL AND proposal_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_learning_items_acceptance
            ON learning_items(acceptance_id)
            WHERE acceptance_id IS NOT NULL;
        "#,
    ),
    // Migration 129: session transcription queue executor claims and leases (Task 0.11 / OpenSpec D6).
    Migration::new(
        "129_transcription_queue_session_claims",
        r#"
        ALTER TABLE transcription_queue ADD COLUMN session_id TEXT;
        ALTER TABLE transcription_queue ADD COLUMN asset_id TEXT;
        ALTER TABLE transcription_queue ADD COLUMN transcript_revision INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE transcription_queue ADD COLUMN executor TEXT;
        ALTER TABLE transcription_queue ADD COLUMN plan_json TEXT;
        ALTER TABLE transcription_queue ADD COLUMN lease_owner TEXT;
        ALTER TABLE transcription_queue ADD COLUMN lease_expires_at INTEGER;
        ALTER TABLE transcription_queue ADD COLUMN cancel_epoch INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE transcription_queue ADD COLUMN blocked_reason TEXT;
        ALTER TABLE transcription_queue ADD COLUMN authorization_json TEXT;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_transcription_queue_active_session
            ON transcription_queue(session_id, transcript_revision)
            WHERE session_id IS NOT NULL AND status IN ('pending', 'processing');

        CREATE INDEX IF NOT EXISTS idx_transcription_queue_executor_lease
            ON transcription_queue(executor, lease_expires_at, status);
        "#,
    ),
    // Migration 130: rich source associations for learning objects (Task 2.4 / OpenSpec D4/D5).
    Migration::new(
        "130_add_learning_object_sources",
        r#"
        CREATE TABLE IF NOT EXISTS learning_object_sources (
            id TEXT PRIMARY KEY NOT NULL,
            target_kind TEXT NOT NULL CHECK(target_kind IN ('card', 'extract')),
            target_id TEXT NOT NULL,
            session_id TEXT,
            document_id TEXT NOT NULL,
            evidence_json TEXT NOT NULL,
            evidence_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_object_sources_unique
            ON learning_object_sources(target_kind, target_id, evidence_hash);

        CREATE INDEX IF NOT EXISTS idx_learning_object_sources_target
            ON learning_object_sources(target_kind, target_id);

        CREATE INDEX IF NOT EXISTS idx_learning_object_sources_session
            ON learning_object_sources(session_id);

        CREATE INDEX IF NOT EXISTS idx_learning_object_sources_document
            ON learning_object_sources(document_id);
        "#,
    ),
    // Migration 131: AI learning analysis pipeline and safe staging drafts (Task 3.1 / OpenSpec D4).
    Migration::new(
        "131_add_session_analysis_pipeline",
        r#"
        CREATE TABLE IF NOT EXISTS session_analysis_runs (
            id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL REFERENCES recording_sessions(id) ON DELETE CASCADE,
            transcript_revision INTEGER NOT NULL,
            profile_hash TEXT NOT NULL,
            task_version TEXT NOT NULL,
            generation_epoch TEXT NOT NULL,
            status TEXT NOT NULL,
            blocked_reason TEXT,
            completed_units INTEGER NOT NULL DEFAULT 0,
            total_units INTEGER NOT NULL DEFAULT 0,
            lease_owner TEXT,
            lease_expires_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (session_id, transcript_revision, profile_hash, task_version, generation_epoch)
        );

        CREATE INDEX IF NOT EXISTS idx_session_analysis_runs_session
            ON session_analysis_runs(session_id, created_at);

        CREATE INDEX IF NOT EXISTS idx_session_analysis_runs_lease
            ON session_analysis_runs(lease_owner, lease_expires_at, status);

        CREATE TABLE IF NOT EXISTS session_analysis_units (
            run_id TEXT NOT NULL REFERENCES session_analysis_runs(id) ON DELETE CASCADE,
            unit_key TEXT NOT NULL,
            input_hash TEXT NOT NULL,
            segment_keys_json TEXT NOT NULL,
            status TEXT NOT NULL,
            result_json TEXT,
            attempts INTEGER NOT NULL DEFAULT 0,
            error_code TEXT,
            PRIMARY KEY (run_id, unit_key)
        );

        CREATE TABLE IF NOT EXISTS session_learning_drafts (
            id TEXT PRIMARY KEY NOT NULL,
            session_id TEXT NOT NULL REFERENCES recording_sessions(id) ON DELETE CASCADE,
            run_id TEXT REFERENCES session_analysis_runs(id) ON DELETE SET NULL,
            kind TEXT NOT NULL CHECK(kind IN ('card', 'extract')),
            status TEXT NOT NULL CHECK(status IN ('proposed', 'rejected', 'accepted', 'superseded')),
            revision INTEGER NOT NULL DEFAULT 1,
            payload_json TEXT NOT NULL,
            evidence_json TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            concept_key TEXT,
            duplicate_json TEXT,
            accepted_target_id TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_session_learning_drafts_unique_run
            ON session_learning_drafts(session_id, run_id, content_hash, kind)
            WHERE run_id IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_session_learning_drafts_lookup
            ON session_learning_drafts(session_id, status, created_at, id);

        CREATE INDEX IF NOT EXISTS idx_session_learning_drafts_run
            ON session_learning_drafts(run_id);
        "#,
    ),
    // Local-only audio authority; no sync entity or legacy progress key is removed.
    Migration::new(
        "132_global_audio_checkpoints",
        include_str!("audio_playback.sql"),
    ),
    Migration::new(
        "133_video_extract_lifecycle",
        r#"
        ALTER TABLE video_extracts ADD COLUMN first_seen_at TEXT;
        ALTER TABLE video_extracts ADD COLUMN last_seen_at TEXT;
        -- Source IDs are immutable evidence, deliberately not cascading foreign keys.
        CREATE TABLE video_extract_review_events (
            operation_id TEXT PRIMARY KEY NOT NULL,
            extract_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
            reviewed_at TEXT NOT NULL,
            receipt_json TEXT NOT NULL
        );
        CREATE INDEX idx_video_extract_review_events_extract
            ON video_extract_review_events(extract_id, reviewed_at);
        "#,
    ),
    Migration::new(
        "134_extract_priority_slider",
        "ALTER TABLE extracts ADD COLUMN priority_slider INTEGER CHECK (priority_slider BETWEEN 0 AND 100);",
    ),
    Migration::new(
        "135_queue_external_priorities",
        r#"
        CREATE TABLE queue_external_priorities (kind TEXT NOT NULL, item_id TEXT NOT NULL, slider INTEGER NOT NULL CHECK (slider BETWEEN 0 AND 100), PRIMARY KEY (kind, item_id));
        CREATE TRIGGER queue_priority_rss_deleted AFTER DELETE ON rss_articles BEGIN
            DELETE FROM queue_external_priorities WHERE kind = 'rss-article' AND item_id = OLD.id;
        END;
        CREATE TRIGGER queue_priority_podcast_deleted AFTER DELETE ON podcast_episodes BEGIN
            DELETE FROM queue_external_priorities WHERE kind = 'podcast-episode' AND item_id = OLD.id;
        END;
        CREATE TRIGGER queue_priority_video_deleted AFTER DELETE ON video_extracts BEGIN
            DELETE FROM queue_external_priorities WHERE kind = 'video-extract' AND item_id = OLD.id;
        END;
        "#,
    ),

];

/// Get the migrations directory path
fn get_migrations_dir() -> Result<PathBuf> {
    let mut exe_path = std::env::current_exe()
        .map_err(|e| PlethoraError::Internal(format!("Failed to get exe path: {}", e)))?;

    // Navigate from the executable to the migrations folder
    // Structure: target/debug/incrementum -> migrations/
    if let Some(parent) = exe_path.parent() {
        exe_path = parent.to_path_buf();
    }

    // Check if we're in development (running from cargo)
    let dev_migrations = exe_path
        .parent()
        .map(|p| p.join("src-tauri").join("migrations"));

    if let Some(ref path) = dev_migrations {
        if path.exists() {
            return Ok(path.clone());
        }
    }

    // Production path: migrations/ next to the executable
    let prod_migrations = exe_path.join("migrations");
    if prod_migrations.exists() {
        return Ok(prod_migrations);
    }

    // Fallback: try current working directory
    let cwd_migrations = std::env::current_dir()
        .map_err(|e| PlethoraError::Internal(format!("Failed to get cwd: {}", e)))?
        .join("src-tauri")
        .join("migrations");

    if cwd_migrations.exists() {
        return Ok(cwd_migrations);
    }

    Err(PlethoraError::Internal(
        "Could not locate migrations directory".to_string(),
    ))
}

/// Split SQL into individual statements, respecting CREATE TRIGGER ... BEGIN ... END blocks
fn split_sql_statements(sql: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut in_trigger = false;
    let mut trigger_depth: usize = 0;
    let mut current_stmt = String::new();

    for line in sql.lines() {
        let trimmed = line.trim();

        if trimmed.to_uppercase().starts_with("CREATE TRIGGER") {
            if !current_stmt.is_empty() {
                let stmt = current_stmt.trim();
                if !stmt.is_empty() {
                    statements.push(stmt.to_string());
                }
                current_stmt.clear();
            }
            in_trigger = true;
            trigger_depth = 0;
            current_stmt.push_str(line);
        } else if in_trigger {
            current_stmt.push('\n');
            current_stmt.push_str(line);

            // Track BEGIN/END depth
            trigger_depth = trigger_depth
                .saturating_add(line.matches("BEGIN").count())
                .saturating_sub(line.matches("END").count());

            // Check if trigger ends (END; at depth 0)
            if trimmed.ends_with("END;") && trigger_depth == 0 {
                in_trigger = false;
                let trigger_sql = current_stmt.trim();
                if !trigger_sql.is_empty() {
                    statements.push(trigger_sql.to_string());
                }
                current_stmt.clear();
            }
        } else {
            // Regular statement - accumulate until semicolon
            // Add newline between lines to preserve structure
            if !current_stmt.is_empty() {
                current_stmt.push('\n');
            }
            current_stmt.push_str(line);

            // Check for statement terminator (semicolon at end of line)
            if trimmed.ends_with(';') {
                let stmt = current_stmt.trim();
                if !stmt.is_empty() {
                    let cleaned: String = stmt
                        .lines()
                        .filter(|l| !l.trim().starts_with("--"))
                        .collect::<Vec<_>>()
                        .join("\n");
                    if !cleaned.trim().is_empty() {
                        statements.push(cleaned);
                    }
                }
                current_stmt.clear();
            }
        }
    }

    let stmt = current_stmt.trim();
    if !stmt.is_empty() {
        let cleaned: String = stmt
            .lines()
            .filter(|l| !l.trim().starts_with("--"))
            .collect::<Vec<_>>()
            .join("\n");
        if !cleaned.trim().is_empty() {
            statements.push(cleaned);
        }
    }

    statements
}

/// Apply a single migration and record it, all inside one transaction.
async fn apply_migration(pool: &Pool<Sqlite>, migration: &Migration) -> Result<()> {
    eprintln!("Applying migration: {}", migration.name);

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| PlethoraError::Internal(format!("Failed to start transaction: {}", e)))?;

    // Split statements while respecting BEGIN...END blocks (for triggers)
    let statements = split_sql_statements(migration.sql);
    eprintln!("  Executing {} statements", statements.len());
    for (i, statement) in statements.iter().enumerate() {
        eprintln!("  Statement {}: {} bytes", i + 1, statement.len());
        eprintln!(
            "  First 100 chars: {}",
            &statement.chars().take(100).collect::<String>()
        );
        sqlx::query(statement)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                PlethoraError::Internal(format!(
                    "Migration {} failed at statement {}: {}",
                    migration.name,
                    i + 1,
                    e
                ))
            })?;
    }

    // Record migration
    let applied_at = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO _schema_migrations (name, applied_at) VALUES (?1, ?2)")
        .bind(migration.name)
        .bind(&applied_at)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            PlethoraError::Internal(format!(
                "Failed to record migration {}: {}",
                migration.name, e
            ))
        })?;

    // Commit transaction
    tx.commit().await.map_err(|e| {
        PlethoraError::Internal(format!(
            "Failed to commit migration {}: {}",
            migration.name, e
        ))
    })?;

    eprintln!("Migration {} applied successfully", migration.name);
    Ok(())
}

/// Run all pending migrations
pub async fn run_migrations(pool: &Pool<Sqlite>) -> Result<()> {
    // Ensure migration tracking table exists
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS _schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to create migrations table: {}", e)))?;

    let applied: Vec<String> =
        sqlx::query_as::<_, (String,)>("SELECT name FROM _schema_migrations ORDER BY applied_at")
            .fetch_all(pool)
            .await
            .map_err(|e| {
                PlethoraError::Internal(format!("Failed to fetch applied migrations: {}", e))
            })?
            .into_iter()
            .map(|(name,)| name)
            .collect();

    // Apply pending migrations
    for migration in MIGRATIONS {
        if applied.contains(&migration.name.to_string()) {
            continue;
        }

        apply_migration(pool, migration).await?;
    }

    eprintln!("All migrations applied successfully");
    Ok(())
}

/// Get the current schema version
pub async fn get_current_version(pool: &Pool<Sqlite>) -> Result<Option<String>> {
    let result = sqlx::query_as::<_, (String,)>(
        "SELECT name FROM _schema_migrations ORDER BY applied_at DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| PlethoraError::Internal(format!("Failed to get schema version: {}", e)))?;

    Ok(result.map(|(name,)| name))
}

/// Check if database needs migration
pub async fn needs_migration(pool: &Pool<Sqlite>) -> Result<bool> {
    let (applied_count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) as count FROM _schema_migrations")
            .fetch_one(pool)
            .await
            .map_err(|e| {
                PlethoraError::Internal(format!("Failed to check migration status: {}", e))
            })?;

    Ok(applied_count < MIGRATIONS.len() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;

    const RECORDING_OWNERSHIP_MIGRATION: &str = "123_recording_session_ownership";

    #[tokio::test]
    async fn recording_privacy_upgrade_retains_legacy_restrictions_and_orphan_ownership() {
        let pool = pool_migrated_up_to("127_document_source_privacy").await;
        sqlx::query("INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified, metadata) VALUES ('private', 'Private', 'private.wav', 'audio', '2026-10-20', '2026-10-20', '{\"isLocalOnly\":true,\"isAiExcluded\":true}'), ('public', 'Public', 'public.wav', 'audio', '2026-10-20', '2026-10-20', NULL)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO extracts (id, document_id, content, date_created, date_modified) VALUES ('private-extract', 'private', 'Private quote', '2026-10-20', '2026-10-20')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO learning_items (id, document_id, extract_id, item_type, question, due_date, date_created, date_modified) VALUES ('cross-card', 'public', 'private-extract', 'flashcard', 'Private question', '2026-10-20', '2026-10-20', '2026-10-20')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO sync_outbox (change_id, entity_type, entity_id, operation, payload, hlc, created_at, sync_status) VALUES ('pending-private', 'learning_item', 'cross-card', 'update', X'7B7D', '1:0', 1, 'pending')")
            .execute(&pool).await.unwrap();
        run_migrations(&pool).await.unwrap();
        let policy: (bool, bool, i64) = sqlx::query_as("SELECT is_local_only, is_ai_excluded, privacy_version FROM documents WHERE id = 'private'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(policy, (true, true, 1));
        let pending: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sync_outbox WHERE entity_id = 'cross-card'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(pending, 0);
        // Existing source deletion cascades to linked cards. Retention flows
        // explicitly detach first; policy must survive that detachment.
        sqlx::query("UPDATE learning_items SET extract_id = NULL WHERE id = 'cross-card'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM extracts WHERE id = 'private-extract'")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM documents WHERE id = 'private'")
            .execute(&pool)
            .await
            .unwrap();
        let retained: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM private_sync_ownership WHERE entity_type = 'learning_item' AND entity_id = 'cross-card' AND source_document_id = 'private'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(retained, 1);
        let question: String =
            sqlx::query_scalar("SELECT question FROM learning_items WHERE id = 'cross-card'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(question, "Private question");
        assert!(sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&pool)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn recording_canonical_upgrade_keeps_segment_ids_words_indexes_and_sequence() {
        let pool = pool_migrated_up_to("124_canonical_session_segments").await;
        sqlx::query("INSERT INTO transcripts (id, book_id, chapter_id, model_used, language, status) VALUES (1, 'legacy', 'legacy', 'fake-local', 'en', 'completed')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO transcript_segments (id, transcript_id, start_ms, end_ms, text, confidence, words_json) VALUES (5, 1, 100, 500, 'Riemannian', 0.8, '[{\"word\":\"Riemannian\",\"start_ms\":100,\"end_ms\":500}]'), (901, 1, 600, 700, 'deleted', NULL, NULL)")
            .execute(&pool).await.unwrap();
        sqlx::query("DELETE FROM transcript_segments WHERE id = 901")
            .execute(&pool)
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        run_migrations(&pool).await.unwrap();
        let row: (i64, String, i64, i64, String, Option<f64>, Option<String>) = sqlx::query_as(
            "SELECT id, segment_key, ordinal, start_ms, text, confidence, words_json FROM transcript_segments WHERE id = 5"
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(
            (row.0, row.1.as_str(), row.2, row.3, row.4.as_str()),
            (5, "legacy:5", 0, 100, "Riemannian")
        );
        assert_eq!(row.5, Some(0.8));
        assert!(row.6.unwrap().contains("Riemannian"));
        sqlx::query("INSERT INTO transcript_segments (transcript_id, start_ms, end_ms, text) VALUES (1, 800, 900, 'legacy next'), (1, 900, 1000, 'legacy again')")
            .execute(&pool).await.unwrap();
        let next: Vec<(i64, String, i64)> = sqlx::query_as(
            "SELECT id, segment_key, ordinal FROM transcript_segments WHERE id > 5 ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(next[0].0 > 901);
        assert_eq!(next[0].1, format!("legacy:{}", next[0].0));
        assert_eq!((next[0].2, next[1].2), (1, 2));
        for index in [
            "idx_transcript_segments_time",
            "idx_transcript_segments_checkpoint",
            "idx_transcript_segments_keys",
            "idx_transcript_segments_ordinal",
        ] {
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
            )
            .bind(index)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(count, 1);
        }
        assert!(sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&pool)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn recording_canonical_untimed_rows_are_not_legacy_playback_positions() {
        let pool = pool_migrated_up_to("124_canonical_session_segments").await;
        run_migrations(&pool).await.unwrap();
        sqlx::query("INSERT INTO transcripts (id, book_id, chapter_id, model_used, language, status) VALUES (1, 'session', 'session', 'import', 'en', 'completed')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO transcript_segments (transcript_id, text, segment_key, ordinal, timing_kind) VALUES (1, 'E = mc² 🤔', '1:text:0', 0, 'none')")
            .execute(&pool).await.unwrap();
        let row: (Option<i64>, Option<i64>, Option<f64>, String) = sqlx::query_as("SELECT start_ms, end_ms, confidence, text FROM transcript_segments WHERE segment_key = '1:text:0'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(row, (None, None, None, "E = mc² 🤔".into()));
        let timed_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM transcript_segments WHERE transcript_id = 1 AND start_ms IS NOT NULL AND end_ms IS NOT NULL")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(timed_count, 0);
        assert!(sqlx::query("INSERT INTO transcript_segments (transcript_id, start_ms, end_ms, text, segment_key, timing_kind) VALUES (1, 0, 0, 'fake timing', 'bad', 'none')")
            .execute(&pool).await.is_err());
        assert!(sqlx::query("INSERT INTO transcript_segments (transcript_id, text, segment_key, timing_kind) VALUES (1, 'duplicate key', '1:text:0', 'none')")
            .execute(&pool).await.is_err());
    }

    #[tokio::test]
    async fn recording_canonical_rebuild_preserves_empty_table_high_water_mark() {
        let pool = pool_migrated_up_to("124_canonical_session_segments").await;
        sqlx::query("INSERT INTO transcripts (id, book_id, chapter_id, model_used, language, status) VALUES (1, 'empty', 'empty', 'local', 'en', 'completed')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO transcript_segments (id, transcript_id, start_ms, end_ms, text) VALUES (901, 1, 0, 100, 'deleted')")
            .execute(&pool).await.unwrap();
        sqlx::query("DELETE FROM transcript_segments")
            .execute(&pool)
            .await
            .unwrap();
        run_migrations(&pool).await.unwrap();
        sqlx::query("INSERT INTO transcript_segments (transcript_id, start_ms, end_ms, text) VALUES (1, 0, 100, 'new')")
            .execute(&pool).await.unwrap();
        let id: i64 = sqlx::query_scalar("SELECT id FROM transcript_segments")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(id > 901);
    }

    /// Freeze the old projection before upgrade: additive columns are not
    /// mutations of existing user fields and must not create false failures.
    async fn recording_user_fields(pool: &Pool<Sqlite>) -> Vec<(String, String)> {
        let mut projections = Vec::new();
        for table in [
            "documents",
            "extracts",
            "learning_items",
            "review_sessions",
            "review_results",
        ] {
            let columns = sqlx::query(&format!("PRAGMA table_info({table})"))
                .fetch_all(pool)
                .await
                .unwrap();
            let fields = columns
                .iter()
                .map(|row| {
                    let name: String = row.get("name");
                    format!("'{name}', \"{name}\"")
                })
                .collect::<Vec<_>>()
                .join(", ");
            projections.push((table.to_owned(), fields));
        }
        projections
    }

    async fn recording_user_data_hash(
        pool: &Pool<Sqlite>,
        projections: &[(String, String)],
    ) -> String {
        use sha2::{Digest, Sha256};
        let mut digest = Sha256::new();
        for (table, fields) in projections {
            let rows: Vec<String> = sqlx::query_scalar(&format!(
                "SELECT json_object({fields}) FROM {table} ORDER BY id"
            ))
            .fetch_all(pool)
            .await
            .unwrap();
            digest.update(table.as_bytes());
            digest.update(serde_json::to_vec(&rows).unwrap());
        }
        format!("{:x}", digest.finalize())
    }

    async fn seed_recording_owner(pool: &Pool<Sqlite>, suffix: &str) {
        sqlx::query("INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified) VALUES (?1, 'Recording', 'pending', 'audio', '2026-10-20', '2026-10-20')")
            .bind(format!("doc-{suffix}")).execute(pool).await.unwrap();
        sqlx::query("INSERT INTO recording_sessions (id, document_id, origin, content_type, created_at, updated_at) VALUES (?1, ?2, 'recorded', 'lecture', '2026-10-20', '2026-10-20')")
            .bind(format!("session-{suffix}")).bind(format!("doc-{suffix}"))
            .execute(pool).await.unwrap();
    }

    #[tokio::test]
    async fn recording_ownership_upgrade_preserves_all_seeded_user_rows() {
        let pool = pool_migrated_up_to(RECORDING_OWNERSHIP_MIGRATION).await;
        sqlx::query("INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified) VALUES ('legacy-doc', 'Lecture', '/audio/legacy.wav', 'audio', '2026-01-01', '2026-01-01')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO extracts (id, document_id, content, date_created, date_modified) VALUES ('legacy-extract', 'legacy-doc', 'Original quotation', '2026-01-01', '2026-01-01')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO learning_items (id, document_id, extract_id, item_type, question, answer, due_date, date_created, date_modified, review_count, memory_state_stability, memory_state_difficulty, state) VALUES ('legacy-card', 'legacy-doc', 'legacy-extract', 'qa', 'Original question?', 'Original answer', '2026-11-01', '2026-01-01', '2026-01-01', 7, 12.5, 4.5, 'review')")
            .execute(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO review_sessions (id, start_time) VALUES ('legacy-review', '2026-01-01')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO review_results (id, session_id, item_id, rating, time_taken, new_due_date, new_interval, new_ease_factor, timestamp) VALUES ('legacy-result', 'legacy-review', 'legacy-card', 3, 12, '2026-11-01', 7, 2.5, '2026-01-01')")
            .execute(&pool).await.unwrap();
        let projections = recording_user_fields(&pool).await;
        let before = recording_user_data_hash(&pool, &projections).await;
        run_migrations(&pool).await.unwrap();
        run_migrations(&pool).await.unwrap();
        assert_eq!(before, recording_user_data_hash(&pool, &projections).await);
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM _schema_migrations WHERE name = ?1")
                .bind(RECORDING_OWNERSHIP_MIGRATION)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 1);
        assert!(sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&pool)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn recording_ownership_constraints_prevent_cross_session_links_and_duplicate_parts() {
        let pool = pool_migrated_up_to(RECORDING_OWNERSHIP_MIGRATION).await;
        run_migrations(&pool).await.unwrap();
        seed_recording_owner(&pool, "a").await;
        seed_recording_owner(&pool, "b").await;
        sqlx::query("INSERT INTO media_assets (id, session_id, kind, relative_path, mime, created_at) VALUES ('asset-a', 'session-a', 'capture', 'capture.wav', 'audio/wav', '2026-10-20')")
            .execute(&pool).await.unwrap();
        assert!(sqlx::query(
            "UPDATE recording_sessions SET media_asset_id = 'asset-a' WHERE id = 'session-b'"
        )
        .execute(&pool)
        .await
        .is_err());
        sqlx::query(
            "UPDATE recording_sessions SET media_asset_id = 'asset-a' WHERE id = 'session-a'",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert!(sqlx::query(
            "UPDATE media_assets SET session_id = 'session-b' WHERE id = 'asset-a'"
        )
        .execute(&pool)
        .await
        .is_err());
        assert!(sqlx::query("INSERT INTO recording_sessions (id, document_id, origin, content_type, created_at, updated_at) VALUES ('duplicate', 'doc-a', 'file', 'meeting', 'now', 'now')")
            .execute(&pool).await.is_err());
        assert!(sqlx::query("INSERT INTO media_assets (id, session_id, kind, relative_path, mime, created_at) VALUES ('bad-path', 'session-a', 'original', '../outside.wav', 'audio/wav', 'now')")
            .execute(&pool).await.is_err());
        let insert = "INSERT INTO recording_parts (asset_id, writer_epoch, sequence, relative_path, byte_length, sha256, start_ms, duration_ms, format_json, committed_at) VALUES ('asset-a', 'epoch-a', 0, 'parts/0.wav', 320, ?1, 0, 10, '{}', 'now') ON CONFLICT(asset_id, sequence) DO NOTHING";
        for _ in 0..2 {
            sqlx::query(insert)
                .bind("a".repeat(64))
                .execute(&pool)
                .await
                .unwrap();
        }
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM recording_parts")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        assert!(sqlx::query("INSERT INTO recording_session_markers (id, session_id, kind, media_ms, created_at) VALUES ('bad-marker', 'session-a', 'flashcard', 0, 'now')")
            .execute(&pool).await.is_err());
    }

    #[tokio::test]
    async fn recording_ownership_deletion_retains_cleanup_journal_and_checks_foreign_keys() {
        let pool = pool_migrated_up_to(RECORDING_OWNERSHIP_MIGRATION).await;
        run_migrations(&pool).await.unwrap();
        seed_recording_owner(&pool, "a").await;
        sqlx::query("INSERT INTO media_assets (id, session_id, kind, relative_path, mime, created_at) VALUES ('asset-a', 'session-a', 'capture', 'capture.wav', 'audio/wav', 'now')")
            .execute(&pool).await.unwrap();
        sqlx::query(
            "UPDATE recording_sessions SET media_asset_id = 'asset-a' WHERE id = 'session-a'",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO recording_cleanup_journal (id, session_id, asset_id, relative_path, created_at, updated_at) VALUES ('cleanup-a', 'session-a', 'asset-a', 'session-a/capture.wav', 'now', 'now')")
            .execute(&pool).await.unwrap();
        sqlx::query("DELETE FROM documents WHERE id = 'doc-a'")
            .execute(&pool)
            .await
            .unwrap();
        let retained: (Option<String>, Option<String>, String) = sqlx::query_as("SELECT session_id, asset_id, status FROM recording_cleanup_journal WHERE id = 'cleanup-a'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(retained, (None, None, "pending".into()));
        assert!(sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&pool)
            .await
            .unwrap()
            .is_empty());
    }

    /// Name of the migration that adds per-item activity history. The
    /// upgrade test stops just short of it so it can seed a realistic
    /// pre-change database first.
    const ACTIVITY_LOG_MIGRATION: &str = "083_add_item_activity_log";

    /// Build an in-memory database with every migration up to (but not
    /// including) `stop_before` applied, so a test can seed rows that look
    /// like they predate the migration under test.
    async fn pool_migrated_up_to(stop_before: &str) -> Pool<Sqlite> {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            // One connection: `sqlite::memory:` gives every connection its own
            // private database, so a larger pool would migrate one and query
            // another.
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("open in-memory database");

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS _schema_migrations (
                name TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("create migrations table");

        for migration in MIGRATIONS {
            if migration.name == stop_before {
                return pool;
            }
            apply_migration(&pool, migration)
                .await
                .unwrap_or_else(|e| panic!("migration {} failed: {}", migration.name, e));
        }

        panic!("migration {} not found", stop_before);
    }

    #[tokio::test]
    async fn activity_log_migration_upgrades_a_seeded_database_without_touching_totals() {
        let pool = pool_migrated_up_to(ACTIVITY_LOG_MIGRATION).await;

        // Seed rows the way a pre-change installation would have them: a
        // document that already accumulated time, an extract, and a
        // learning item.
        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified, total_time_spent)
             VALUES ('doc-1', 'Seeded document', '/tmp/seeded.pdf', 'pdf', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 4242)",
        )
        .execute(&pool)
        .await
        .expect("seed document");

        sqlx::query(
            "INSERT INTO extracts (id, document_id, content, date_created, date_modified)
             VALUES ('ext-1', 'doc-1', 'Seeded extract', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("seed extract");

        sqlx::query(
            "INSERT INTO learning_items (id, item_type, question, date_created, date_modified, due_date)
             VALUES ('item-1', 'flashcard', 'Seeded question?', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("seed learning item");

        // Apply the rest of the migrations, including the one under test.
        run_migrations(&pool).await.expect("migrations apply");

        // The new table and its indexes exist.
        let (activity_table,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'item_activity_log'",
        )
        .fetch_one(&pool)
        .await
        .expect("check item_activity_log");
        assert_eq!(activity_table, 1, "item_activity_log should be created");

        for index in [
            "idx_item_activity_log_item",
            "idx_item_activity_log_started_at",
        ] {
            let (count,): (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
            )
            .bind(index)
            .fetch_one(&pool)
            .await
            .expect("check index");
            assert_eq!(count, 1, "{index} should be created");
        }

        // The additive columns exist and default to NULL on existing rows —
        // NULL, not 0, is what lets the UI say "not recorded" instead of
        // fabricating a zero.
        let (extract_total,): (Option<i64>,) =
            sqlx::query_as("SELECT total_time_spent FROM extracts WHERE id = 'ext-1'")
                .fetch_one(&pool)
                .await
                .expect("read extracts.total_time_spent");
        assert_eq!(extract_total, None);

        sqlx::query(
            "INSERT INTO reading_sessions (id, document_id, started_at) VALUES ('sess-1', 'doc-1', '2026-01-02T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("insert reading session");
        let (heartbeat,): (Option<String>,) =
            sqlx::query_as("SELECT last_heartbeat_at FROM reading_sessions WHERE id = 'sess-1'")
                .fetch_one(&pool)
                .await
                .expect("read reading_sessions.last_heartbeat_at");
        assert_eq!(heartbeat, None);

        // Pre-existing totals are untouched — the migration never recomputes.
        let (document_total,): (Option<i64>,) =
            sqlx::query_as("SELECT total_time_spent FROM documents WHERE id = 'doc-1'")
                .fetch_one(&pool)
                .await
                .expect("read documents.total_time_spent");
        assert_eq!(document_total, Some(4242));

        // And the seeded rows all survive.
        for (table, id) in [
            ("documents", "doc-1"),
            ("extracts", "ext-1"),
            ("learning_items", "item-1"),
        ] {
            let (count,): (i64,) =
                sqlx::query_as(&format!("SELECT COUNT(*) FROM {table} WHERE id = ?1"))
                    .bind(id)
                    .fetch_one(&pool)
                    .await
                    .expect("count seeded row");
            assert_eq!(count, 1, "{table} row {id} should survive the migration");
        }
    }

    #[tokio::test]
    async fn extract_priority_migration_preserves_legacy_rank_keys() {
        let pool = pool_migrated_up_to("134_extract_priority_slider").await;
        sqlx::query("INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified) VALUES ('parent', 'Parent', '/tmp/a.pdf', 'pdf', '2026-01-01', '2026-01-01')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO extracts (id, document_id, content, date_created, date_modified, priority_score) VALUES ('child', 'parent', 'text', '2026-01-01', '2026-01-01', 12.375)")
            .execute(&pool).await.unwrap();
        run_migrations(&pool).await.unwrap();
        run_migrations(&pool).await.unwrap();
        let saved: (f64, Option<i32>) = sqlx::query_as("SELECT priority_score, priority_slider FROM extracts WHERE id = 'child'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(saved, (12.375, None));
    }

    #[tokio::test]
    async fn activity_log_migration_is_idempotent_across_repeated_runs() {
        let pool = pool_migrated_up_to(ACTIVITY_LOG_MIGRATION).await;
        run_migrations(&pool).await.expect("first run");
        run_migrations(&pool).await.expect("second run");

        let (applied,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM _schema_migrations WHERE name = ?1")
                .bind(ACTIVITY_LOG_MIGRATION)
                .fetch_one(&pool)
                .await
                .expect("count applied migration");
        assert_eq!(applied, 1);
    }

    #[tokio::test]
    async fn practice_reveal_migration_upgrades_existing_and_fresh_databases() {
        let pool = pool_migrated_up_to("100_language_practice_attempt_revealed").await;
        run_migrations(&pool)
            .await
            .expect("apply practice reveal migration");
        run_migrations(&pool)
            .await
            .expect("repeat practice reveal migration");

        let columns = sqlx::query("PRAGMA table_info(language_practice_attempts)")
            .fetch_all(&pool)
            .await
            .expect("inspect practice attempts");
        let revealed = columns
            .iter()
            .find(|row| row.get::<String, _>("name") == "revealed");
        assert!(
            revealed.is_some(),
            "existing databases gain the revealed column"
        );
        assert_eq!(revealed.unwrap().get::<String, _>("dflt_value"), "0");
        for name in ["media_id", "start_ms", "end_ms"] {
            assert!(
                columns
                    .iter()
                    .any(|row| row.get::<String, _>("name") == name),
                "existing databases gain {name}"
            );
        }
        let (index_count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_language_practice_attempts_media_range'")
            .fetch_one(&pool)
            .await
            .expect("inspect practice media range index");
        assert_eq!(index_count, 1);
    }

    #[tokio::test]
    async fn migration_failure_rolls_back_schema_and_tracking_record() {
        let pool = pool_migrated_up_to("100_language_practice_attempt_revealed").await;
        let migration = Migration::new(
            "test_language_practice_atomic_failure",
            "ALTER TABLE language_practice_attempts ADD COLUMN temporary_failure_marker TEXT;\nALTER TABLE table_that_does_not_exist ADD COLUMN impossible TEXT;",
        );

        assert!(apply_migration(&pool, &migration).await.is_err());
        let columns = sqlx::query("PRAGMA table_info(language_practice_attempts)")
            .fetch_all(&pool)
            .await
            .expect("inspect practice attempts after rollback");
        assert!(!columns
            .iter()
            .any(|row| row.get::<String, _>("name") == "temporary_failure_marker"));
        let (tracked,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM _schema_migrations WHERE name = ?1")
                .bind(migration.name)
                .fetch_one(&pool)
                .await
                .expect("inspect migration tracking after rollback");
        assert_eq!(tracked, 0);
    }

    #[tokio::test]
    async fn complete_plethora_identity_migration_renames_tables_and_updates_algorithm_types() {
        let pool = pool_migrated_up_to("103_complete_plethora_identity_migration").await;

        // Seed legacy learning_items rows
        sqlx::query("INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified) VALUES ('doc-test', 'Test Doc', '/test.md', 'markdown', datetime('now'), datetime('now'))")
            .execute(&pool)
            .await
            .expect("insert test doc");
        sqlx::query("INSERT INTO learning_items (id, document_id, item_type, question, answer, algorithm_type, due_date, date_created, date_modified) VALUES ('item-sm18', 'doc-test', 'flashcard', 'Q1', 'A1', 'sm18', datetime('now'), datetime('now'), datetime('now'))")
            .execute(&pool)
            .await
            .expect("insert sm18 item");
        sqlx::query("INSERT INTO learning_items (id, document_id, item_type, question, answer, algorithm_type, due_date, date_created, date_modified) VALUES ('item-sm20', 'doc-test', 'flashcard', 'Q2', 'A2', 'sm20', datetime('now'), datetime('now'), datetime('now'))")
            .execute(&pool)
            .await
            .expect("insert sm20 item");

        run_migrations(&pool).await.expect("apply migration 103");

        // Verify algorithm_type values updated
        let (algo_18,): (String,) =
            sqlx::query_as("SELECT algorithm_type FROM learning_items WHERE id = 'item-sm18'")
                .fetch_one(&pool)
                .await
                .expect("query item-sm18");
        assert_eq!(algo_18, "adaptive");

        let (algo_20,): (String,) =
            sqlx::query_as("SELECT algorithm_type FROM learning_items WHERE id = 'item-sm20'")
                .fetch_one(&pool)
                .await
                .expect("query item-sm20");
        assert_eq!(algo_20, "precision");

        // Verify renamed tables exist
        for table in [
            "arena_state",
            "arena_m2_optimizer",
            "arena_m3_matrices",
            "arena_model_params",
        ] {
            let (count,): (i64,) = sqlx::query_as(&format!(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '{table}'"
            ))
            .fetch_one(&pool)
            .await
            .expect("check table exists");
            assert_eq!(count, 1, "table {table} should exist");
        }

        // Verify dropped tables do not exist
        for table in [
            "sm20_matrices",
            "sm20_recall_cells",
            "sm20_optimizer_profiles",
            "sm20_arena",
        ] {
            let (count,): (i64,) = sqlx::query_as(&format!(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '{table}'"
            ))
            .fetch_one(&pool)
            .await
            .expect("check table does not exist");
            assert_eq!(count, 0, "table {table} should be dropped");
        }
    }

    #[tokio::test]
    async fn migration_106_creates_sync_journal_tables() {
        let pool = pool_migrated_up_to("105_transcription_checkpoints").await;
        run_migrations(&pool).await.expect("apply migration 106");

        for table in ["sync_outbox", "sync_cursor", "sync_clock", "sync_meta"] {
            let (count,): (i64,) = sqlx::query_as(&format!(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '{table}'"
            ))
            .fetch_one(&pool)
            .await
            .expect("table lookup");
            assert_eq!(count, 1, "table {table} should exist");
        }
    }

    #[test]
    fn test_migrations_defined() {
        assert!(!MIGRATIONS.is_empty(), "Should have at least one migration");
    }

    #[tokio::test]
    async fn source_reference_migration_adds_nullable_column_without_touching_rows() {
        let pool = pool_migrated_up_to("116_add_learning_item_source_reference").await;

        // Seed rows the way a pre-116 installation would have them.
        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified)
             VALUES ('doc-1', 'Seeded document', '/tmp/seeded.pdf', 'pdf', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("seed document");

        sqlx::query(
            "INSERT INTO learning_items (id, item_type, question, date_created, date_modified, due_date)
             VALUES ('item-1', 'flashcard', 'Seeded question?', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("seed learning item");

        run_migrations(&pool).await.expect("migrations apply");

        // The column exists and is nullable (NULL inserted cleanly).
        sqlx::query("UPDATE learning_items SET source_reference = NULL WHERE id = 'item-1'")
            .execute(&pool)
            .await
            .expect("null source_reference round-trips");

        // Pre-existing rows are not backfilled.
        let (source_reference,): (Option<String>,) =
            sqlx::query_as("SELECT source_reference FROM learning_items WHERE id = 'item-1'")
                .fetch_one(&pool)
                .await
                .expect("read learning_items.source_reference");
        assert_eq!(source_reference, None);

        // And the seeded rows survive.
        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM learning_items WHERE id = 'item-1'")
                .fetch_one(&pool)
                .await
                .expect("count seeded row");
        assert_eq!(count, 1);
    }

    #[test]
    fn test_migration_names_unique() {
        let mut names = std::collections::HashSet::new();
        for migration in MIGRATIONS {
            assert!(
                names.insert(&migration.name),
                "Migration name '{}' is not unique",
                migration.name
            );
        }
    }

    #[test]
    fn test_migration_names_ordered() {
        // Some historical fixes were appended later while preserving runtime dependency order.
        // Keep this allowlist explicit so any new out-of-order entries fail the test.
        let allowed_backfills = std::collections::HashSet::from([
            "028_remove_extract_category_fk",
            "029_add_document_is_dismissed",
        ]);

        for window in MIGRATIONS.windows(2) {
            if window[0].name < window[1].name {
                continue;
            }

            assert!(
                allowed_backfills.contains(window[1].name),
                "Migrations not ordered: {} should come before {}",
                window[0].name,
                window[1].name
            );
        }
    }

    #[tokio::test]
    async fn daqe_migration_adds_tables_and_nullable_dwell_columns_without_touching_rows() {
        let pool = pool_migrated_up_to("117_daqe_queue_engine").await;

        // Seed a pre-117 activity row the way an existing installation would.
        sqlx::query(
            "INSERT INTO item_activity_log (id, item_type, item_id, surface, started_at, active_seconds)
             VALUES ('act-1', 'document', 'doc-1', 'reader', '2026-01-01T00:00:00Z', 90)",
        )
        .execute(&pool)
        .await
        .expect("seed activity row");

        run_migrations(&pool).await.expect("migrations apply");

        for table in ["daqe_model_cache", "daqe_queue_snapshots"] {
            let (count,): (i64,) = sqlx::query_as(&format!(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '{table}'"
            ))
            .fetch_one(&pool)
            .await
            .expect("table lookup");
            assert_eq!(count, 1, "table {table} should exist");
        }

        // The new dwell columns are nullable and default to NULL: a pre-117 row
        // reads as "never measured", never as a fabricated 0.
        let (idle, scroll, density, exit): (Option<i64>, Option<f64>, Option<f64>, Option<String>) =
            sqlx::query_as(
                "SELECT idle_time_ms, scroll_depth_ratio, interaction_density, exit_action
             FROM item_activity_log WHERE id = 'act-1'",
            )
            .fetch_one(&pool)
            .await
            .expect("seeded row survives");
        assert_eq!(idle, None, "idle_time_ms is untracked, not zero");
        assert_eq!(scroll, None, "scroll_depth_ratio is untracked, not zero");
        assert_eq!(density, None, "interaction_density is untracked, not zero");
        assert_eq!(exit, None, "exit_action is untracked");

        // The pre-existing active dwell is untouched by the migration.
        let (active,): (i64,) =
            sqlx::query_as("SELECT active_seconds FROM item_activity_log WHERE id = 'act-1'")
                .fetch_one(&pool)
                .await
                .expect("active_seconds preserved");
        assert_eq!(active, 90);

        // The cache accepts a row keyed by content hash.
        sqlx::query(
            "INSERT INTO daqe_model_cache (content_hash, rubric_version, score, tier, gate, computed_at)
             VALUES ('hash-1', 1, 0.75, 'medium-analysis', 1.0, '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("insert cache row");

        let (hash, version): (String, i64) =
            sqlx::query_as("SELECT content_hash, rubric_version FROM daqe_model_cache")
                .fetch_one(&pool)
                .await
                .expect("read cache row");
        assert_eq!(hash, "hash-1");
        assert_eq!(version, 1);

        // A snapshot accepts a full DAQE payload.
        sqlx::query(
            "INSERT INTO daqe_queue_snapshots
             (id, collection_id, profile, knobs_json, ranked_ids_json, top10_json, computed_at)
             VALUES ('snap-1', NULL, 'default', '{}', '[\"a\"]', '[\"a\"]', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("insert snapshot row");

        let (ranked, top10): (String, String) = sqlx::query_as(
            "SELECT ranked_ids_json, top10_json FROM daqe_queue_snapshots WHERE id = 'snap-1'",
        )
        .fetch_one(&pool)
        .await
        .expect("read snapshot row");
        assert_eq!(ranked, "[\"a\"]");
        assert_eq!(top10, "[\"a\"]");
    }

    #[tokio::test]
    async fn daqe_model_cache_rejects_a_duplicate_content_hash() {
        let pool = pool_migrated_up_to("117_daqe_queue_engine").await;
        run_migrations(&pool).await.expect("migrations apply");

        let insert = |pool: &Pool<Sqlite>| {
            let pool = pool.clone();
            async move {
                sqlx::query(
                    "INSERT INTO daqe_model_cache (content_hash, rubric_version, score, computed_at)
                     VALUES ('same-hash', 1, 0.5, '2026-01-01T00:00:00Z')",
                )
                .execute(&pool)
                .await
            }
        };

        insert(&pool).await.expect("first insert");
        assert!(
            insert(&pool).await.is_err(),
            "content_hash is the cache identity, so a duplicate must be rejected"
        );
    }

    #[tokio::test]
    async fn canonical_youtube_transcript_migration_adds_language_and_backfills_empty_content() {
        let pool = pool_migrated_up_to("121_canonical_youtube_transcripts").await;

        // A pre-change installation: the video viewer cached a transcript in
        // `youtube_transcripts` but never wrote `documents.content`, so the
        // document rows that FTS5 / Document Q&A read stayed empty.
        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified, content)
             VALUES ('yt-doc-1', 'Cached talk', 'https://www.youtube.com/watch?v=vid-1', 'youtube', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '')",
        )
        .execute(&pool)
        .await
        .expect("seed youtube document");

        // A document whose content is already present must never be rewritten.
        sqlx::query(
            "INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified, content)
             VALUES ('pdf-doc-1', 'Untouched', '/tmp/other.pdf', 'pdf', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'Existing body')",
        )
        .execute(&pool)
        .await
        .expect("seed filled document");

        sqlx::query(
            "INSERT INTO youtube_transcripts (id, document_id, video_id, transcript, segments_json, date_created, date_modified)
             VALUES ('yt-1', 'yt-doc-1', 'vid-1', '[00:00] Hello world', '[]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("seed transcript");

        run_migrations(&pool).await.expect("migrations apply");

        // The language column exists and is nullable on existing rows.
        let language: Option<String> =
            sqlx::query_scalar("SELECT language FROM youtube_transcripts WHERE id = 'yt-1'")
                .fetch_one(&pool)
                .await
                .expect("read language");
        assert_eq!(language, None, "language is unrecorded, not fabricated");

        // The cached transcript backfilled the empty document content, and
        // the FTS5 trigger carried it into document_search.
        let (content,): (String,) =
            sqlx::query_as("SELECT content FROM documents WHERE id = 'yt-doc-1'")
                .fetch_one(&pool)
                .await
                .expect("read backfilled content");
        assert_eq!(content, "[00:00] Hello world");
        let (search_hits,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM document_search WHERE document_id = 'yt-doc-1' AND content LIKE '%Hello world%'",
        )
        .fetch_one(&pool)
        .await
        .expect("read document_search");
        assert_eq!(search_hits, 1, "backfill should sync into FTS5");

        // Non-empty content is left exactly as it was.
        let (unchanged,): (String,) =
            sqlx::query_as("SELECT content FROM documents WHERE id = 'pdf-doc-1'")
                .fetch_one(&pool)
                .await
                .expect("read untouched content");
        assert_eq!(unchanged, "Existing body");
    }

    /// Migration 122 must be additive: legacy `ai_conversations` /
    /// `ai_messages` rows (migration-003 shape, long predating any UI writer)
    /// stay byte-identical in their original columns, foreign keys keep
    /// cascading, and unknown legacy payloads survive untouched while
    /// canonical columns get honest defaults.
    #[tokio::test]
    async fn canonical_conversation_migration_preserves_legacy_rows() {
        let pool = pool_migrated_up_to("122_add_canonical_conversations").await;

        sqlx::query("INSERT INTO documents (id, title, file_path, file_type, date_added, date_modified) VALUES ('doc-legacy', 'Legacy Doc', '/legacy.md', 'markdown', datetime('now'), datetime('now'))")
            .execute(&pool)
            .await
            .expect("seed document");
        sqlx::query("INSERT INTO ai_conversations (id, document_id, title, provider, model, date_created, date_modified) VALUES ('conv-legacy', 'doc-legacy', 'Legacy thread', 'openai', 'gpt-4o-mini', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')")
            .execute(&pool)
            .await
            .expect("seed legacy conversation");
        sqlx::query("INSERT INTO ai_conversations (id, document_id, title, provider, model, date_created, date_modified) VALUES ('conv-orphan', NULL, 'Orphaned', 'ollama', 'llama3.1:8b', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')")
            .execute(&pool)
            .await
            .expect("seed orphan conversation");
        for i in 0..3 {
            sqlx::query("INSERT INTO ai_messages (id, conversation_id, role, content, timestamp, tokens_used) VALUES (?1, 'conv-legacy', ?2, ?3, '2026-08-01T00:00:00.000Z', ?4)")
                .bind(format!("legacy-m{i}"))
                .bind(if i % 2 == 0 { "user" } else { "assistant" })
                .bind(format!("Legacy message {i}"))
                .bind(if i % 2 == 0 { None::<i64> } else { Some(120_i64) })
                .execute(&pool)
                .await
                .expect("seed legacy message");
        }

        run_migrations(&pool).await.expect("apply migration 122");

        // Original columns are untouched.
        let (title, provider, model): (String, String, String) = sqlx::query_as(
            "SELECT title, provider, model FROM ai_conversations WHERE id = 'conv-legacy'",
        )
        .fetch_one(&pool)
        .await
        .expect("read legacy conversation");
        assert_eq!(title, "Legacy thread");
        assert_eq!(provider, "openai");
        assert_eq!(model, "gpt-4o-mini");

        // Honest defaults: rows are device-local, unassigned, version 1.
        let (version, owner, sync_policy, revision, deleted): (i64, String, String, i64, Option<String>) =
            sqlx::query_as("SELECT record_version, owner_profile_id, sync_policy, revision, deleted_at FROM ai_conversations WHERE id = 'conv-legacy'")
                .fetch_one(&pool)
                .await
                .expect("read canonical defaults");
        assert_eq!(version, 1, "legacy rows are version 1 until imported");
        assert_eq!(owner, "unassigned");
        assert_eq!(sync_policy, "device-local");
        assert_eq!(revision, 0);
        assert!(deleted.is_none());

        // Legacy messages keep their original content and nullability.
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM ai_messages WHERE conversation_id = 'conv-legacy' AND turn_id IS NULL AND order_key IS NULL",
        )
        .fetch_one(&pool)
        .await
        .expect("count legacy messages");
        assert_eq!(count, 3);
        let (null_tokens,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM ai_messages WHERE conversation_id = 'conv-legacy' AND tokens_used IS NULL",
        )
        .fetch_one(&pool)
        .await
        .expect("count null tokens");
        assert_eq!(null_tokens, 2);

        // Foreign keys still cascade from migration 003.
        sqlx::query("DELETE FROM ai_conversations WHERE id = 'conv-legacy'")
            .execute(&pool)
            .await
            .expect("delete conversation");
        let (remaining,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM ai_messages WHERE conversation_id = 'conv-legacy'",
        )
        .fetch_one(&pool)
        .await
        .expect("count after cascade");
        assert_eq!(remaining, 0, "message cascade preserved");

        // New tables exist and are empty on an upgraded database.
        for table in [
            "ai_conversation_turns",
            "ai_conversation_attempts",
            "ai_conversation_drafts",
            "ai_conversation_sources",
            "ai_message_sources",
            "ai_conversation_import_journal",
        ] {
            let (exists,): (i64,) = sqlx::query_as(&format!(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '{table}'"
            ))
            .fetch_one(&pool)
            .await
            .expect("check table exists");
            assert_eq!(exists, 1, "table {table} should exist");
        }
    }

    /// Re-applying the additive migration (a crash between the DDL and the
    /// tracking row, then a restart) must be a no-op for schema and data.
    #[tokio::test]
    async fn canonical_conversation_migration_is_additive_on_rerun() {
        let pool = pool_migrated_up_to("122_add_canonical_conversations").await;
        run_migrations(&pool).await.expect("first application");
        sqlx::query("INSERT INTO ai_conversations (id, title, provider, model, record_version, owner_profile_id, date_created, date_modified, updated_at_ms) VALUES ('conv-canonical', 'Canonical', 'unassigned', 'unassigned', 2, 'local:device-a', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 1)")
            .execute(&pool)
            .await
            .expect("seed canonical row");
        // Re-running migrations finds 122 already recorded and does nothing.
        run_migrations(&pool).await.expect("second application");
        let (owner,): (String,) = sqlx::query_as(
            "SELECT owner_profile_id FROM ai_conversations WHERE id = 'conv-canonical'",
        )
        .fetch_one(&pool)
        .await
        .expect("read canonical row");
        assert_eq!(owner, "local:device-a");
    }

    /// A pre-imported (version-2) row read by an old reader must still expose
    /// the legacy columns it knows; this asserts the read-compatibility
    /// contract the rollback path depends on.
    #[tokio::test]
    async fn canonical_rows_remain_readable_through_legacy_columns() {
        let pool = pool_migrated_up_to("122_add_canonical_conversations").await;
        run_migrations(&pool).await.expect("apply migration 122");
        sqlx::query("INSERT INTO ai_conversations (id, title, provider, model, record_version, owner_profile_id, revision, date_created, date_modified, updated_at_ms, provider_kind) VALUES ('conv-v2', 'Canonical title', 'unassigned', 'unassigned', 2, 'local:device-a', 4, '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', 5000, 'unassigned')")
            .execute(&pool)
            .await
            .expect("seed canonical row");
        // The legacy read shape (title/provider/model/dates) still resolves.
        let (title, created, modified): (String, String, String) = sqlx::query_as(
            "SELECT title, date_created, date_modified FROM ai_conversations WHERE id = 'conv-v2'",
        )
        .fetch_one(&pool)
        .await
        .expect("legacy-shaped read");
        assert_eq!(title, "Canonical title");
        assert_eq!(created, "2026-08-01T00:00:00.000Z");
        assert_eq!(modified, "2026-08-02T00:00:00.000Z");
    }

    /// Migration 123 is additive and enforces the narrow acceptance identity.
    #[tokio::test]
    async fn learning_item_acceptance_migration_is_additive_and_unique() {
        let pool = pool_migrated_up_to("128_add_learning_item_acceptance_idempotency").await;
        run_migrations(&pool).await.expect("apply migration 123");

        let (acceptance_column,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM pragma_table_info('learning_items') WHERE name = 'acceptance_id'",
        )
        .fetch_one(&pool)
        .await
        .expect("acceptance column");
        assert_eq!(acceptance_column, 1);

        let (proposal_column,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM pragma_table_info('learning_items') WHERE name = 'proposal_id'",
        )
        .fetch_one(&pool)
        .await
        .expect("proposal column");
        assert_eq!(proposal_column, 1);

        // An old caller (no keys) remains fully compatible.
        sqlx::query(
            "INSERT INTO learning_items (id, item_type, question, date_created, date_modified, due_date) VALUES ('legacy-item', 'flashcard', 'Legacy?', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("legacy insert");
        let (null_keys,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM learning_items WHERE id = 'legacy-item' AND acceptance_id IS NULL AND proposal_id IS NULL",
        )
        .fetch_one(&pool)
        .await
        .expect("legacy row");
        assert_eq!(null_keys, 1);

        sqlx::query(
            "INSERT INTO learning_items (id, item_type, question, date_created, date_modified, due_date, acceptance_id, proposal_id) VALUES ('agent-item-1', 'flashcard', 'Agent?', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 'run-1', 'run-1:p1')",
        )
        .execute(&pool)
        .await
        .expect("agent insert");

        let duplicate = sqlx::query(
            "INSERT INTO learning_items (id, item_type, question, date_created, date_modified, due_date, acceptance_id, proposal_id) VALUES ('agent-item-2', 'flashcard', 'Other?', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 'run-1', 'run-1:p1')",
        )
        .execute(&pool)
        .await;
        assert!(
            duplicate.is_err(),
            "the (acceptance_id, proposal_id) pair must be unique"
        );

        // A second proposal in the same acceptance run is allowed.
        sqlx::query(
            "INSERT INTO learning_items (id, item_type, question, date_created, date_modified, due_date, acceptance_id, proposal_id) VALUES ('agent-item-3', 'flashcard', 'Second?', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 'run-1', 'run-1:p2')",
        )
        .execute(&pool)
        .await
        .expect("second proposal insert");

        // Re-running migrations (tracking row present) is a no-op.
        run_migrations(&pool).await.expect("second application");
    }

    #[tokio::test]
    async fn migration_125_preserves_endorsements_and_dismissals_and_labels_legacy_origin_unknown()
    {
        let pool = pool_migrated_up_to("125_add_concept_link_origin_lifecycle").await;

        sqlx::query(
            "INSERT INTO concepts (id, name, normalized_name) VALUES ('c1', 'A', 'a'), ('c2', 'B', 'b')",
        )
        .execute(&pool)
        .await
        .expect("seed concepts");

        // Legacy rows predate origin/lifecycle columns. `fp-dup` deliberately
        // has both an endorsed row and a later AI duplicate.
        for (id, fingerprint, created_by, dismissed) in [
            ("legacy-endorsed", Some("fp-dup"), "user", 0),
            ("legacy-ai-dupe", Some("fp-dup"), "ai", 0),
            ("legacy-dismissed", Some("fp-dismissed"), "ai", 1),
            ("legacy-null", None, "ai", 0),
        ] {
            sqlx::query(
                "INSERT INTO concept_links (id, source_kind, source_id, target_kind, target_id, \
                 relation_type, confidence, created_by, created_at, is_dismissed, proposal_fingerprint) \
                 VALUES (?1, 'document', 'doc-1', 'concept', 'c1', 'related-to', 0.8, ?2, ?3, ?4, ?5)",
            )
            .bind(id)
            .bind(created_by)
            .bind(if id == "legacy-endorsed" {
                "2026-01-02T00:00:00Z"
            } else {
                "2026-01-01T00:00:00Z"
            })
            .bind(dismissed)
            .bind(fingerprint)
            .execute(&pool)
            .await
            .expect("seed legacy link");
        }

        run_migrations(&pool).await.expect("apply 125");

        // Endorsed row wins the duplicate reconciliation.
        let live: Vec<(String, String)> = sqlx::query_as(
            "SELECT id, origin FROM concept_links \
             WHERE proposal_fingerprint = 'fp-dup' AND is_dismissed = 0 ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .expect("live duplicates");
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].0, "legacy-endorsed");
        assert_eq!(live[0].1, "unknown", "legacy origin is never guessed");

        // Dismissal history survives and also remains origin unknown.
        let dismissed: (String, String) = sqlx::query_as(
            "SELECT id, origin FROM concept_links WHERE proposal_fingerprint = 'fp-dismissed'",
        )
        .fetch_one(&pool)
        .await
        .expect("dismissed row");
        assert_eq!(dismissed.0, "legacy-dismissed");
        assert_eq!(dismissed.1, "unknown");

        // New notifications/lifecycle columns exist and default correctly for
        // legacy rows.
        let (origin, endorsed_at): (String, Option<String>) = sqlx::query_as(
            "SELECT origin, endorsed_at FROM concept_links WHERE id = 'legacy-endorsed'",
        )
        .fetch_one(&pool)
        .await
        .expect("legacy lifecycle");
        assert_eq!(origin, "unknown");
        assert!(endorsed_at.is_none());

        // The partial unique index blocks concurrent live duplicates…
        let duplicate = sqlx::query(
            "INSERT INTO concept_links (id, source_kind, source_id, target_kind, target_id, \
             relation_type, confidence, created_by, created_at, is_dismissed, proposal_fingerprint, origin) \
             VALUES ('new-dupe', 'document', 'doc-1', 'concept', 'c1', 'related-to', 0.8, 'ai', \
                     '2026-01-03T00:00:00Z', 0, 'fp-dup', 'ai')",
        )
        .execute(&pool)
        .await;
        assert!(duplicate.is_err(), "only one live row per fingerprint");

        // …while multiple dismissed history rows remain allowed.
        for id in ["dismissed-a", "dismissed-b"] {
            sqlx::query(
                "INSERT INTO concept_links (id, source_kind, source_id, target_kind, target_id, \
                 relation_type, confidence, created_by, created_at, is_dismissed, proposal_fingerprint, origin) \
                 VALUES (?1, 'document', 'doc-1', 'concept', 'c1', 'related-to', 0.8, 'ai', \
                         '2026-01-03T00:00:00Z', 1, 'fp-history', 'ai')",
            )
            .bind(id)
            .execute(&pool)
            .await
            .expect("dismissed history rows are not uniqueness-limited");
        }
    }

    #[tokio::test]
    async fn migration_rollback_keeps_concept_link_schema_intact() {
        let pool = pool_migrated_up_to("125_add_concept_link_origin_lifecycle").await;
        run_migrations(&pool).await.expect("apply 125");

        let bad = Migration::new(
            "999_rollback_probe",
            "ALTER TABLE concept_links ADD COLUMN rollback_probe TEXT; THIS IS NOT SQL;",
        );
        assert!(apply_migration(&pool, &bad).await.is_err());

        let columns = sqlx::query("PRAGMA table_info(concept_links)")
            .fetch_all(&pool)
            .await
            .expect("inspect concept_links");
        assert!(
            !columns
                .iter()
                .any(|row| row.get::<String, _>("name") == "rollback_probe"),
            "failed migration must roll back its DDL"
        );
        let (tracked,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM _schema_migrations WHERE name = '999_rollback_probe'",
        )
        .fetch_one(&pool)
        .await
        .expect("tracking row");
        assert_eq!(tracked, 0);
    }
}
