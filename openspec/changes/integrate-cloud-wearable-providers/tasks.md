## Tasks

- [x] C-T01 Implement PKCE S256 OAuth flow manager, single-use CSRF `state` registry, `127.0.0.1:0` loopback callback listener, and mobile deep-link callback handler in `src-tauri/src/health/oauth.rs`
- [x] C-T02 Implement stateless server OAuth broker & signed webhook endpoint (`GET /providers`, `POST /:provider/{exchange,refresh,revoke,webhook}`) in `server/src/routes/v1/healthOAuth.ts` + mount in `server/src/index.ts`
- [x] C-T03 Implement rate-limit-aware HTTP client with `Retry-After` jitter backoff, pagination, and structured error mapping in `src-tauri/src/health/http_client.rs`
- [x] C-T04 Implement authoritative provider capability catalog (`Tier 1 + Tier 2`) and readiness state resolver in `src-tauri/src/health/providers/catalog.rs`
- [ ] C-T05 Implement Oura Cloud API v2, WHOOP Developer API v2, Google Health API v4 (no legacy Fitbit endpoints), and Garmin Commercial Health API connectors/parsers in `src-tauri/src/health/providers/`
- [x] C-T06 Write server HMAC/replay unit tests (`server/src/__tests__/healthOAuth.test.ts`) and Rust mock-HTTP contract tests covering pagination, token refresh, `429`, `401` revocation, `403` partial scope, and malformed payloads
