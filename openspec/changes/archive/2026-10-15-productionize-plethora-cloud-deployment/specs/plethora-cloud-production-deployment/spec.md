# plethora-cloud-production-deployment

Production deployment capability for Plethora Cloud API.

## ADDED Requirements

### Requirement: Disposable application server

The production deployment SHALL be stateless at the compute layer. Authoritative customer data SHALL reside in external managed PostgreSQL and S3-compatible object storage. Loss of the VPS SHALL require only secrets restoration and container redeployment — not restoration of local databases or uploaded files.

#### Scenario: VPS disaster recovery

- **WHEN** a production VPS is catastrophically lost
- **THEN** an operator can provision a new VPS, restore `.env.production`, pull the container image, run migrations, and start services
- **AND** Plethora Cloud resumes without restoring local disk volumes

### Requirement: Production Compose topology

Production Compose SHALL include only edge proxy and API services. It SHALL NOT run PostgreSQL or authoritative blob storage volumes by default.

#### Scenario: Production service list

- **WHEN** `compose.production.yml` is inspected
- **THEN** it contains `caddy` and `api` services
- **AND** it does not contain a `db` service or `uploads` volume for customer data

### Requirement: TLS reverse proxy

Production SHALL terminate HTTPS at Caddy. Only ports 80 and 443 SHALL be exposed publicly. The API container SHALL NOT publish port 3000 to the host.

#### Scenario: Public port exposure

- **WHEN** production Compose is running
- **THEN** host ports 80 and 443 are bound to Caddy
- **AND** the API is reachable only on the internal Docker network

### Requirement: Deploy script

A deploy script SHALL validate prerequisites, run database migrations safely, bring up services, and wait for readiness.

#### Scenario: First deployment

- **WHEN** an operator runs `scripts/deploy-production.sh` with valid `.env.production`
- **THEN** migrations execute via a one-shot container
- **AND** API and Caddy start
- **AND** the script exits non-zero if readiness checks fail

### Requirement: CI image publishing

CI SHALL build and publish versioned Docker images to GHCR. Production SHALL deploy by image tag, not mutable local builds only.

#### Scenario: Image rollback

- **WHEN** a deployment fails after migration
- **THEN** an operator can set a previous image tag and redeploy without rebuilding on the VPS

### Requirement: Operator documentation

Production deployment documentation SHALL cover VPS bootstrap, Neon configuration, R2 configuration, DNS, firewall, first deploy, upgrade, rollback, and disaster recovery.

#### Scenario: Clean-machine deploy

- **WHEN** an operator follows `docs/deploy/PLETHORA_CLOUD_PRODUCTION.md` on a fresh Ubuntu VPS
- **THEN** they can deploy Plethora Cloud without reading application source code
