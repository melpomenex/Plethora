# plethora-cloud-object-storage Specification

## Purpose
The Plethora Cloud API (server/) is implemented as an Express service with v1 routes for auth, billing, sync, jobs, entitlements, and usage — but it is deployed nowhere in production today. The existing docker-compose.yml is a local dev stack with bundled Postgres, local disk uploads, weak default secrets, and no TLS. Operators cannot provision a small VPS and deploy safely without reverse-engineering the codebase.

## Requirements

### Requirement: S3-compatible storage backend

Production SHALL use an S3-compatible object store (e.g. Cloudflare R2) for authoritative binary storage. The VPS local disk SHALL NOT be the authoritative home for PDFs, EPUBs, audio, video, synced document binaries, generated cloud artifacts, or large job outputs.

#### Scenario: Production storage configuration

- **WHEN** `PLETHORA_ENV=production` and object storage env vars are missing
- **THEN** the API refuses to start with an actionable configuration error

### Requirement: Presigned URLs

The storage backend SHALL support presigned upload and download URLs so clients can transfer large binaries without proxying all traffic through the API server.

#### Scenario: Signed download

- **WHEN** a handler requests a download URL for a stored object key
- **THEN** the storage backend returns a time-limited presigned HTTPS URL
- **AND** the URL targets the configured S3-compatible endpoint

### Requirement: Development local fallback

Development MAY use local filesystem storage when S3 is not configured. Production SHALL NOT fall back to local authoritative storage.

#### Scenario: Dev without S3

- **WHEN** `PLETHORA_ENV` is not `production` and `S3_ENDPOINT` is unset
- **THEN** legacy file routes MAY use `STORAGE_PATH` local disk
- **AND** production startup does not allow this fallback
