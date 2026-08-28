import { getPool } from './connection.js';

const schema = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  subscription_tier VARCHAR(20) DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Files table (for document file storage)
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename VARCHAR(500) NOT NULL,
  content_type VARCHAR(100),
  size_bytes BIGINT,
  storage_path TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  sync_version BIGINT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_sync ON files(user_id, sync_version);

-- Documents table (mirrors Rust model)
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(500) NOT NULL,
  file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  file_path TEXT,
  file_type VARCHAR(50) NOT NULL,
  content TEXT,
  content_hash VARCHAR(64),
  total_pages INTEGER,
  current_page INTEGER DEFAULT 1,
  current_scroll_percent DOUBLE PRECISION,
  current_cfi TEXT,
  category VARCHAR(255),
  tags JSONB DEFAULT '[]',
  date_added TIMESTAMPTZ NOT NULL,
  date_modified TIMESTAMPTZ NOT NULL,
  date_last_reviewed TIMESTAMPTZ,
  extract_count INTEGER DEFAULT 0,
  learning_item_count INTEGER DEFAULT 0,
  priority_rating INTEGER DEFAULT 3,
  priority_slider INTEGER DEFAULT 50,
  priority_score DOUBLE PRECISION DEFAULT 50.0,
  is_archived BOOLEAN DEFAULT FALSE,
  is_favorite BOOLEAN DEFAULT FALSE,
  is_dismissed BOOLEAN DEFAULT FALSE,
  metadata JSONB,
  next_reading_date TIMESTAMPTZ,
  reading_count INTEGER DEFAULT 0,
  stability DOUBLE PRECISION,
  difficulty DOUBLE PRECISION,
  reps INTEGER,
  total_time_spent INTEGER,
  deleted_at TIMESTAMPTZ,
  sync_version BIGINT DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_sync ON documents(user_id, sync_version);

-- Extracts table
CREATE TABLE IF NOT EXISTS extracts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL,
  content TEXT NOT NULL,
  page_title VARCHAR(500),
  page_number INTEGER,
  highlight_color VARCHAR(50),
  notes TEXT,
  progressive_disclosure_level INTEGER DEFAULT 0,
  max_disclosure_level INTEGER DEFAULT 3,
  date_created TIMESTAMPTZ NOT NULL,
  date_modified TIMESTAMPTZ NOT NULL,
  tags JSONB DEFAULT '[]',
  category VARCHAR(255),
  memory_state_stability DOUBLE PRECISION,
  memory_state_difficulty DOUBLE PRECISION,
  next_review_date TIMESTAMPTZ,
  last_review_date TIMESTAMPTZ,
  review_count INTEGER DEFAULT 0,
  reps INTEGER DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  sync_version BIGINT DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_extracts_user ON extracts(user_id);
CREATE INDEX IF NOT EXISTS idx_extracts_document ON extracts(document_id);
CREATE INDEX IF NOT EXISTS idx_extracts_sync ON extracts(user_id, sync_version);

-- Learning items table
CREATE TABLE IF NOT EXISTS learning_items (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  extract_id UUID,
  document_id UUID,
  item_type VARCHAR(50) NOT NULL,
  question TEXT NOT NULL,
  answer TEXT,
  cloze_text TEXT,
  difficulty DOUBLE PRECISION DEFAULT 0.3,
  interval INTEGER DEFAULT 0,
  ease_factor DOUBLE PRECISION DEFAULT 2.5,
  due_date TIMESTAMPTZ,
  date_created TIMESTAMPTZ NOT NULL,
  date_modified TIMESTAMPTZ NOT NULL,
  last_review_date TIMESTAMPTZ,
  review_count INTEGER DEFAULT 0,
  lapses INTEGER DEFAULT 0,
  state VARCHAR(50) DEFAULT 'new',
  is_suspended BOOLEAN DEFAULT FALSE,
  tags JSONB DEFAULT '[]',
  memory_state_stability DOUBLE PRECISION,
  memory_state_difficulty DOUBLE PRECISION,
  deleted_at TIMESTAMPTZ,
  sync_version BIGINT DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_learning_items_user ON learning_items(user_id);
CREATE INDEX IF NOT EXISTS idx_learning_items_sync ON learning_items(user_id, sync_version);

-- Sync state tracking
CREATE TABLE IF NOT EXISTS sync_cursors (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_sync_version BIGINT DEFAULT 0,
  last_sync_at TIMESTAMPTZ DEFAULT NOW()
);

-- Devices table (per-device keypair & identity)
CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  public_key VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

-- Sessions table (rotating refresh token family tracking)
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(255) NOT NULL,
  family_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_family ON sessions(family_id);

-- Jobs table (async worker lifecycle)
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'queued',
  params_json JSONB NOT NULL DEFAULT '{}',
  result_json JSONB,
  error_json JSONB,
  progress_current INTEGER,
  progress_total INTEGER,
  progress_unit VARCHAR(50),
  idempotency_key VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_idempotency ON jobs(user_id, idempotency_key);

-- Usage records table (metering & cost tracking)
CREATE TABLE IF NOT EXISTS usage_records (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability VARCHAR(100) NOT NULL,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  units BIGINT NOT NULL DEFAULT 1,
  cost_usd_micros BIGINT DEFAULT 0,
  provider VARCHAR(100),
  model VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_records_user ON usage_records(user_id, created_at);

-- Quota state table (real-time usage and window limits)
CREATE TABLE IF NOT EXISTS quota_state (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability VARCHAR(100) NOT NULL,
  used BIGINT NOT NULL DEFAULT 0,
  limit_val BIGINT NOT NULL DEFAULT 0,
  "window" VARCHAR(50) NOT NULL DEFAULT 'monthly',
  resets_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, capability)
);

-- Capability grants table
CREATE TABLE IF NOT EXISTS capability_grants (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability VARCHAR(100) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reason VARCHAR(50),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, capability)
);

-- Purchases table (active store subscriptions and checkout records)
CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  product_id VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  transaction_id VARCHAR(255),
  period VARCHAR(50) DEFAULT 'monthly',
  renewal_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id, status);

-- Subscription events (audit log of store webhooks)
CREATE TABLE IF NOT EXISTS subscription_events (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Webhook idempotency deduplication table
CREATE TABLE IF NOT EXISTS webhook_dedupe (
  event_id VARCHAR(255) PRIMARY KEY,
  provider VARCHAR(50) NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sync records table (encrypted record deltas v2)
CREATE TABLE IF NOT EXISTS sync_records (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  table_kind VARCHAR(100) NOT NULL,
  record_id VARCHAR(255) NOT NULL,
  hlc VARCHAR(100) NOT NULL,
  device_id VARCHAR(255) NOT NULL,
  payload_ciphertext TEXT NOT NULL,
  aad VARCHAR(500) NOT NULL,
  key_version INTEGER DEFAULT 1,
  seq_number BIGSERIAL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_records_user_seq ON sync_records(user_id, seq_number);
CREATE INDEX IF NOT EXISTS idx_sync_records_dedupe ON sync_records(user_id, device_id, hlc);

CREATE TABLE IF NOT EXISTS processed_changes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  change_id VARCHAR(255) NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, change_id)
);

CREATE TABLE IF NOT EXISTS entity_revisions (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, entity_type, entity_id)
);

-- Sync device cursors
CREATE TABLE IF NOT EXISTS sync_device_cursors (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id VARCHAR(255) NOT NULL,
  last_seq BIGINT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, device_id)
);

CREATE TABLE IF NOT EXISTS blob_objects (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_hash VARCHAR(255) NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  storage_key TEXT NOT NULL,
  content_type VARCHAR(255) NOT NULL DEFAULT 'application/octet-stream',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_blob_objects_user ON blob_objects(user_id);

-- API tokens for public cloud API (Proposal 20)
CREATE TABLE IF NOT EXISTS api_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  token_prefix VARCHAR(20) NOT NULL,
  scopes JSONB NOT NULL DEFAULT '["read"]',
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);

-- Webhooks for automation events (Proposal 20)
CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret VARCHAR(255) NOT NULL,
  events JSONB NOT NULL DEFAULT '[]',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks(user_id);

-- Remote inbox items (Proposal 19)
CREATE TABLE IF NOT EXISTS inbox_items (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title VARCHAR(500),
  excerpt TEXT,
  content_html TEXT,
  tags JSONB DEFAULT '[]',
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inbox_items_user_status ON inbox_items(user_id, status);

-- Migrations
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(20) DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN DEFAULT FALSE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS current_scroll_percent DOUBLE PRECISION;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS current_cfi TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_id UUID;
ALTER TABLE files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE files ADD COLUMN IF NOT EXISTS sync_version BIGINT DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_files_sync ON files(user_id, sync_version);

-- Store transactions (openspec change implement-native-ios-storekit2-billing §6.3).
-- Authoritative, VERIFIED Apple transaction records keyed by the durable
-- original_transaction_id. Rows are only ever written after the signed JWS
-- verified against Apple's certificate chain (server/src/billing/jws.ts).
CREATE TABLE IF NOT EXISTS store_transactions (
  id UUID PRIMARY KEY,
  original_transaction_id VARCHAR(64) UNIQUE NOT NULL,
  transaction_id VARCHAR(64) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  product_id VARCHAR(100) NOT NULL,
  environment VARCHAR(20) NOT NULL,
  status VARCHAR(30) NOT NULL,
  app_account_token UUID,
  expires_at TIMESTAMPTZ,
  revocation_at TIMESTAMPTZ,
  revocation_reason BIGINT,
  signed_payload TEXT NOT NULL,
  signed_date TIMESTAMPTZ,
  verified_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_store_transactions_user ON store_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_store_transactions_token ON store_transactions(app_account_token);

-- Legacy-row policy for the pre-existing unverified "purchases" table:
-- every row written before this change was created WITHOUT any verification
-- (the old /v1/billing/validate ignored receipt data entirely) and therefore
-- CANNOT be trusted. They are marked verified=FALSE and are invisible to all
-- verified-data reads (/v1/billing/subscriptions, /v1/billing/restore). Each
-- row is re-derived from Apple's verified data on first reconciliation
-- (client JWS post or ASNS notification); nothing is deleted automatically.
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Job worker columns (productionize-plethora-cloud-deployment)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS locked_by VARCHAR(100);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS timeout_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_jobs_claimable ON jobs(status, created_at) WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS job_events (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  payload_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, created_at);

-- Sync blob offload to object storage (large ciphertext → R2)
ALTER TABLE sync_records ADD COLUMN IF NOT EXISTS blob_storage_key TEXT;

-- Postgres-backed rate limiting (multi-instance safe)
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key VARCHAR(255) PRIMARY KEY,
  hit_count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Play Store provider column on verified transactions
ALTER TABLE store_transactions ADD COLUMN IF NOT EXISTS provider VARCHAR(50) NOT NULL DEFAULT 'appstore';

-- Play purchase token hash for deduplicated lookups (never store raw tokens in indexed columns)
ALTER TABLE store_transactions ADD COLUMN IF NOT EXISTS purchase_token_hash VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_transactions_play_token
  ON store_transactions(purchase_token_hash) WHERE purchase_token_hash IS NOT NULL;

-- Play obfuscatedExternalAccountId is not always a UUID
ALTER TABLE store_transactions ALTER COLUMN app_account_token TYPE VARCHAR(255);

`;

export async function migrate(): Promise<void> {
  const pool = getPool();
  await pool.query(schema);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  import('./connection.js').then(async ({ initMigrationDatabase, closeDatabase }) => {
    await initMigrationDatabase();
    try {
      await migrate();
    } finally {
      await closeDatabase();
    }
    process.exit(0);
  }).catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
