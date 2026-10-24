CREATE TABLE IF NOT EXISTS audio_playback_checkpoint (
    profile_key TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK(source_kind IN ('audiobook', 'podcast', 'audio_edition', 'recording')),
    source_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK(schema_version = 1),
    checkpoint_sequence INTEGER NOT NULL CHECK(checkpoint_sequence >= 0),
    owner_epoch TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY(profile_key, source_kind, source_id)
);
CREATE TABLE IF NOT EXISTS audio_playback_session (
    profile_key TEXT PRIMARY KEY NOT NULL,
    owner_epoch TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK(schema_version = 1),
    native_owner_epoch TEXT,
    native_owner_sequence INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL DEFAULT '{}',
    updated_at_ms INTEGER NOT NULL
);
