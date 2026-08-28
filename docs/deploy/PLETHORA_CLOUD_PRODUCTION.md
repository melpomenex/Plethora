# Plethora Cloud — Production Deployment Guide

This guide walks you from a fresh Ubuntu/Debian VPS to a running Plethora Cloud API at `https://api.<your-domain>`.

**Architecture:** Disposable VPS (Caddy + API) → Neon PostgreSQL + Cloudflare R2. The VPS holds no authoritative customer data.

**Initial production topology (Plethora Cloud):**

```text
Plethora API (HostingBy.Design VPS, Netherlands)
        |
        |  nearby European network path
        v
Neon PostgreSQL (AWS eu-central-1 / Frankfurt)
        |
        +---- Cloudflare R2 (EU object storage, `plethora-production` bucket)
```

The API server is generic PostgreSQL-compatible — it does not depend on Neon-specific features beyond a standard `DATABASE_URL`.

---

## Prerequisites

| Service | Purpose |
|---------|---------|
| VPS | ~4 vCPU, 6 GB RAM, 100 GB NVMe, Ubuntu 22.04+ or Debian 12+ (Netherlands recommended for EU latency) |
| Domain | e.g. `api.plethora.app` |
| [Neon](https://neon.tech) | Managed PostgreSQL (`aws-eu-central-1` / Frankfurt for EU production) |
| [Cloudflare R2](https://developers.cloudflare.com/r2/) | S3-compatible object storage |
| [Cloudflare DNS](https://dash.cloudflare.com) | DNS + optional proxy (recommended) |
| Apple Developer | App Store Server API credentials for billing |
| GitHub | GHCR image pull access |

---

## 1. VPS Bootstrap

SSH into your VPS as root or a sudo user:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker Engine + Compose plugin (Debian/Ubuntu — use the host's VERSION_CODENAME)
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# On Ubuntu, use `linux/ubuntu` instead of `linux/debian` in the gpg and apt list URLs above.

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add your user to docker group (log out/in after)
sudo usermod -aG docker $USER

# Firewall — only SSH, HTTP, HTTPS
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## 2. Obtain Deployment Files

```bash
# Option A: clone the repo (deploy only needs compose + deploy/ + scripts/)
git clone https://github.com/melpomenex/Plethora.git
cd Plethora

# Option B: copy only deployment artifacts
# compose.production.yml, deploy/Caddyfile, scripts/deploy-production.sh, .env.production.example
```

---

## 3. Configure Neon PostgreSQL

Plethora production uses **Neon Lakebase Postgres only** — not Neon Auth, Object Storage, Functions, or other beta services. User files and artifacts stay in Cloudflare R2 (`S3_*`).

1. Create or select project `plethora-production` at [console.neon.tech](https://console.neon.tech) in region **AWS eu-central-1 (Frankfurt)** for EU production
2. Database name: `plethora` (default Neon `neondb` also works; Frankfurt production uses `plethora`)
3. Use the `production` branch (or your primary branch)
4. Copy **both** connection strings with `sslmode=require`:
   - **Pooled** (`-pooler` hostname) → `DATABASE_URL` (API runtime)
   - **Direct** (no `-pooler`) → `DATABASE_URL_UNPOOLED` (migrations only)
5. Set in `.env.production`:
   ```
   DATABASE_URL=<pooled connection string>
   DATABASE_URL_UNPOOLED=<direct connection string>
   DATABASE_SSL=true
   PG_POOL_MAX=8
   ```

With the [Neon CLI](https://neon.com/docs/cli/install.md) linked to the project (`neon link`), `neon env pull --file .env.production` can populate these without committing secrets. `.env.production` is gitignored.

Neon handles backups and scale-to-zero. You do not back up Postgres from the VPS.

### Connection pooling

| Traffic | URL variable | Neon endpoint |
|---------|--------------|---------------|
| API / workers | `DATABASE_URL` | Pooled (`-pooler`) |
| `npm run db:migrate` / deploy migrate profile | `DATABASE_URL_UNPOOLED` | Direct |

Default `PG_POOL_MAX=8` suits one API container on a ~4 vCPU VPS. If you run multiple API containers, lower per-instance (e.g. `5` × 3 instances) so total connections stay within Neon limits.

### Health checks vs autosuspend

| Endpoint | Queries DB? | Use for |
|----------|-------------|---------|
| `GET /health` | No | Docker liveness, process-up checks |
| `GET /ready` | Yes (`SELECT 1`) | Post-deploy verification, load-balancer readiness |

Production Compose uses `/health` for the container healthcheck so Docker does not wake Neon every 30s. Use `/ready` manually after deploy or from an external monitor at a low frequency — not as a high-frequency liveness probe.

---

## 4. Configure Cloudflare R2

Plethora uses the existing S3-compatible storage layer (`server/src/storage/`) with these **runtime** variables only:

| Variable | Purpose |
|----------|---------|
| `S3_ENDPOINT` | R2 S3 API endpoint |
| `S3_REGION` | `auto` for R2 |
| `S3_BUCKET` | Bucket name (production: `plethora-production`) |
| `S3_ACCESS_KEY_ID` | R2 S3 access key (not Cloudflare API token) |
| `S3_SECRET_ACCESS_KEY` | R2 S3 secret key |

Optional: `SYNC_BLOB_OFFLOAD_BYTES` (default `65536`) — ciphertext larger than this goes to R2 instead of Postgres.

### 4a. Enable R2 (one-time)

If Wrangler returns error `10042`, enable R2 in the Cloudflare dashboard first:

1. [dash.cloudflare.com](https://dash.cloudflare.com) → your account → **R2 Object Storage**
2. Accept terms / enable R2 if prompted

### 4b. Create EU production bucket

Create bucket **`plethora-production`** with:

| Setting | Value |
|---------|-------|
| Storage class | **Standard** |
| Jurisdiction | **European Union (EU)** |
| Location hint | **Western Europe** (`weur`) — optional |

**Wrangler (after `npx wrangler login`):**

```bash
npx wrangler r2 bucket create plethora-production \
  --jurisdiction eu \
  --storage-class Standard
```

**Dashboard:** R2 → **Create bucket** → name `plethora-production` → jurisdiction **EU** → storage class **Standard**.

Verify:

```bash
npx wrangler r2 bucket list
npx wrangler r2 bucket info plethora-production
```

### 4c. EU S3 endpoint

For **EU jurisdiction** buckets, use the jurisdiction-specific endpoint (not the global one):

```text
https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com
```

Find `<ACCOUNT_ID>` in Cloudflare dashboard → R2 → **Manage R2 API Tokens** (shown as Account ID), or from any R2 overview page.

Set in `.env.production`:

```bash
S3_ENDPOINT=https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=plethora-production
S3_ACCESS_KEY_ID=<from R2 API token>
S3_SECRET_ACCESS_KEY=<from R2 API token — shown once>
```

### 4d. Least-privilege R2 API token

**Wrangler can create the bucket** (`wrangler r2 bucket create …`) but **cannot mint S3 Access Key / Secret Key** — those are only issued from the R2 dashboard (shown once).

Cloudflare dashboard → **R2** → **Manage R2 API Tokens** → **Create API token**:

1. **Permissions:** Object Read & Write
2. **Scope:** Apply to **specific bucket(s)** → select `plethora-production` only
3. Copy **Access Key ID** and **Secret Access Key** immediately (secret shown once)

Do **not** use a global Cloudflare API token as Plethora's runtime credential.

### 4e. Verify connectivity

```bash
set -a && source .env.production && set +a
cd server && npm run verify:r2
```

This uploads a small test object under `__plethora_smoke__/`, verifies bytes, and deletes it.

### Security notes

- Bucket must remain **private** — do not enable public `r2.dev` access for user content
- Presigned URL helpers exist in code but **no HTTP routes expose them yet**; sync blobs still flow API ↔ R2
- CORS on the bucket is **not required** until client-direct presigned transfers are implemented
- Production Compose has **no** local upload volume; object data is not authoritative on the VPS

R2 durability/versioning is managed in Cloudflare. No blob backup from the VPS is required.

---

## 5. Create Production Environment File

```bash
cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production   # fill in all values
```

Generate secrets:
```bash
# JWT_SECRET (min 32 chars)
openssl rand -base64 48

# METRICS_TOKEN
openssl rand -hex 32
```

Required variables — see `.env.production.example` for the full list:
- `PLETHORA_API_HOST` — your API domain (e.g. `api.plethora.app`)
- `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (migrations), `JWT_SECRET`, `CORS_ORIGINS`
- `S3_*` (all four)
- `METRICS_TOKEN`
- `APP_STORE_*` (for billing)
- `PLETHORA_CLOUD_IMAGE` — pin a version tag, not `latest`, for production

---

## 6. DNS Configuration

In Cloudflare (or your DNS provider):

| Type | Name | Value | Proxy |
|------|------|-------|-------|
| A | `api` | `<VPS IPv4>` | Proxied (orange cloud) recommended |

If using Cloudflare proxy:
- SSL/TLS mode: **Full (strict)** once Caddy has a valid cert, or **Full** during first deploy
- Caddy obtains Let's Encrypt certs automatically when `PLETHORA_API_HOST` resolves to this server

---

## 7. Apple App Store Billing

1. App Store Connect → Users and Access → **Integrations** → App Store Connect API → create key
2. Download the `.p8` private key
3. Set in `.env.production`:
   ```
   APP_STORE_KEY_ID=<key id>
   APP_STORE_ISSUER_ID=<issuer id>
   APP_STORE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
   APP_STORE_BUNDLE_ID=com.plethora.app
   APP_STORE_ENV=production
   ```
4. Register ASNS v2 webhook URL in App Store Connect:
   ```
   https://api.<your-domain>/v1/billing/webhooks/appstore
   ```

Sandbox E2E on a physical device: see `docs/deploy/APPLE_SANDBOX_E2E.md`.

---

## 7b. Google Play Billing (Android)

1. Google Play Console → **Monetization setup** → link a Google Cloud project
2. Create a service account with **Google Play Android Developer** role; download JSON key
3. Play Console → **Monetization** → **Real-time developer notifications** → create Pub/Sub topic
4. GCP → Pub/Sub → create push subscription to:
   ```
   https://api.<your-domain>/v1/billing/webhooks/playstore
   ```

Set in `.env.production`:
```
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
GOOGLE_PLAY_PACKAGE_NAME=com.plethora.app
GOOGLE_PLAY_RTDN_AUDIENCE=https://api.<your-domain>/v1/billing/webhooks/playstore
```

Client purchase UI requires the native `plethora-playbilling` Android plugin (server verification is ready).

---

## 8. First Deployment

```bash
# Log in to GHCR (if image is private; public images skip this)
docker login ghcr.io

# Publish first GHCR image (one-time, or after server changes)
PUSH=1 ./scripts/publish-cloud-image.sh
# Or: push to main — .github/workflows/cloud-server.yml publishes automatically

# Deploy (includes api + worker + caddy)
chmod +x scripts/deploy-production.sh
./scripts/deploy-production.sh
```

The script will:
1. Validate `.env.production`
2. Validate compose configuration
3. Pull (or build) the API image
4. Run database migrations (`docker compose --profile migrate run --rm migrate`)
5. Start `api` + `caddy`
6. Wait for `/ready`

### Build locally instead of pulling

```bash
BUILD_LOCAL=1 ./scripts/deploy-production.sh
```

---

## 9. Verify Deployment

```bash
# Liveness
curl -s https://api.<your-domain>/health | jq .

# Readiness
curl -s https://api.<your-domain>/ready | jq .

# Metrics (requires bearer token)
curl -s -H "Authorization: Bearer $METRICS_TOKEN" \
  https://api.<your-domain>/metrics | head

# Docker status
docker compose -f compose.production.yml --env-file .env.production ps

# Logs
docker compose -f compose.production.yml --env-file .env.production logs -f api
```

---

## 10. Upgrade

```bash
# Pin new image version in .env.production
# PLETHORA_CLOUD_IMAGE=ghcr.io/melpomenex/plethora-cloud:sha-abc1234

docker compose -f compose.production.yml --env-file .env.production pull api
./scripts/deploy-production.sh
```

Migrations run automatically on each deploy unless `SKIP_MIGRATE=1`.

---

## 11. Rollback

```bash
# 1. Set previous image tag in .env.production
# PLETHORA_CLOUD_IMAGE=ghcr.io/melpomenex/plethora-cloud:sha-<previous>

# 2. Skip migrate if schema is compatible
SKIP_MIGRATE=1 ./scripts/deploy-production.sh
```

Only rollback the application if migrations since the previous version were **additive** (`IF NOT EXISTS`). Destructive migrations require a database restore from Neon point-in-time recovery.

---

## 12. Disaster Recovery

If the VPS is lost:

1. Provision a new VPS (repeat §1)
2. Restore `.env.production` from secure backup (password manager, encrypted vault)
3. Point DNS A record to new VPS IP
4. Clone/copy deployment files
5. `docker login ghcr.io` (if needed)
6. `./scripts/deploy-production.sh`

**No customer data restoration is needed** — Postgres lives in Neon, blobs in R2.

Back up independently:
- `.env.production` (all secrets)
- Apple `.p8` key
- DNS configuration notes

---

## 13. Operational Checks

```bash
# Resource usage
docker stats --no-stream

# Disk usage
df -h
docker system df

# Database connectivity (from API container)
docker compose -f compose.production.yml --env-file .env.production \
  exec api wget -qO- http://127.0.0.1:3000/ready

# Restart API only
docker compose -f compose.production.yml --env-file .env.production restart api
```

---

## 14. Scaling Path

Current: single VPS with one API container.

To scale horizontally:
1. Deploy identical stacks on multiple VPS instances (or increase replicas behind a load balancer)
2. All instances share the same `DATABASE_URL` (use Neon connection pooler)
3. All instances share the same R2 bucket
4. Reduce `PG_POOL_MAX` per instance (e.g. 5 with 3 instances)
5. Use Cloudflare load balancing or round-robin DNS

API containers remain stateless. No Redis required for initial scale-out (rate limits are per-instance).

---

## Known Limitations (v1)

- **Feature job kinds** — only `noop_probe` is implemented; kinds like `document_reconstruct` and `transcribe` register in future proposals.
- **Android purchase UI** — server Play verification + RTDN are ready; native `plethora-playbilling` plugin still required for in-app purchase flow.
- **Legacy routes disabled** — `/sync`, `/files` not mounted when `ENABLE_LEGACY_ROUTES=false` (production default).

---

## Plethora Pro Sync (v2)

Production rollout for encrypted delta sync is documented in [PLETHORA_SYNC_ROLLOUT.md](./PLETHORA_SYNC_ROLLOUT.md).

Required routes: `/v1/sync/*`, `/v1/blobs/*` with `requireCloudSync` middleware. Configure R2 for blob presigned URLs. Client flag `PLETHORA_SYNC_V2` defaults on for Pro when unset.

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Deploy fails config validation | Run server locally with same env; read error messages |
| `/ready` returns 503 | `DATABASE_URL` correct? Neon IP allowlist? `DATABASE_SSL=true`? |
| Caddy cert errors | DNS pointing to VPS? Port 80 open? `PLETHORA_API_HOST` matches DNS? |
| API won't start | `docker compose logs api` — usually missing `JWT_SECRET`, `S3_*`, or `METRICS_TOKEN` |
| Billing webhooks fail | ASNS URL registered? TLS valid? Only `appstore` provider allowed in production |
