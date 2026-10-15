# plethora-cloud-production-readiness

Production readiness, configuration validation, and graceful lifecycle for Plethora Cloud API.

## ADDED Requirements

### Requirement: Production configuration validation

The API SHALL validate required production configuration at startup and fail fast with actionable error messages.

#### Scenario: Missing JWT secret

- **WHEN** `PLETHORA_ENV=production` and `JWT_SECRET` is missing or equals the development default
- **THEN** the process exits before accepting traffic

#### Scenario: Missing database URL

- **WHEN** `DATABASE_URL` is unset
- **THEN** the process exits with a clear error

### Requirement: Health and readiness endpoints

The API SHALL expose liveness and readiness endpoints suitable for Docker and reverse-proxy health checks.

#### Scenario: Liveness

- **WHEN** `GET /health` is called
- **THEN** the response is 200 with `{ status: "ok" }` if the process is running

#### Scenario: Readiness

- **WHEN** `GET /ready` is called and PostgreSQL is reachable
- **THEN** the response is 200
- **WHEN** PostgreSQL is unreachable
- **THEN** the response is 503

### Requirement: Graceful shutdown

The API SHALL handle SIGTERM by stopping new connections, draining in-flight requests, and closing the database pool.

#### Scenario: Container stop

- **WHEN** the process receives SIGTERM
- **THEN** the HTTP server closes gracefully within a bounded timeout
- **AND** the database connection pool is closed

### Requirement: Production security gates

In production, the API SHALL reject weak secrets, protect metrics, authenticate API token management routes, and reject unsigned non-Apple billing webhooks.

#### Scenario: Metrics protection

- **WHEN** `PLETHORA_ENV=production` and `METRICS_TOKEN` is set
- **THEN** `GET /metrics` requires `Authorization: Bearer <METRICS_TOKEN>`

#### Scenario: API token management auth

- **WHEN** a client calls `POST /v1/api/tokens` without a valid user JWT
- **THEN** the response is 401
