# Implementation Tasks

## 1. Interface-first (unblocks 3/4/6/16–20 in parallel)
- [ ] 1.1 Error envelope + stable code set + middleware skeleton (`server/src/middleware/`)
- [ ] 1.2 `jobs/registry.ts` kind-plugin interface (schema/timeout/attempts/concurrency/quota/handler)
- [ ] 1.3 TS `src/lib/plethoraCloud/` + Rust `plethora_cloud/` client skeletons (CloudJobService surface, error mapping)
- [ ] 1.4 Contract section in roadmap doc; quota envelope schema

## 2. Service framework
- [ ] 2.1 Remove deprecated `/sync` + `/files` routes; `/v1` mounting + request-id + structured logging (no payloads)
- [ ] 2.2 Auth middleware integration point (proposal 3 contract; dev static tokens until landed)
- [ ] 2.3 Rate limiter (account+IP token buckets) + payload caps + SSRF guard
- [ ] 2.4 Versioned Postgres migrations tooling + tables: jobs, job_events, usage_records, quota_state, capability_grants, quota_envelopes, provider_keys

## 3. Job system
- [ ] 3.1 Worker loop: SKIP LOCKED claims, per-kind concurrency, timeouts, lock-expiry recovery
- [ ] 3.2 Retry/backoff+jitter, max attempts, cancellation checkpoints, progress writes (rate-limited)
- [ ] 3.3 Idempotency keys; `GET /v1/jobs?since=` resync; SSE events endpoint + pull fallback
- [ ] 3.4 Artifact storage: S3-compatible client, signed download URLs, per-kind TTL
- [ ] 3.5 Reference job kind (`noop_probe` or `embed_batch` stub) proving the lifecycle end-to-end

## 4. Quotas & cost controls
- [ ] 4.1 Quota envelopes config + pre-flight middleware + response headers + `GET /v1/usage`
- [ ] 4.2 Completion metering (transactional usage_records) + period rollover/reset job
- [ ] 4.3 Per-account daily cost ceiling + per-kind budget guard kill switches + alert emission points
- [ ] 4.4 Grace policy per capability (finish-started default)

## 5. Provider registry
- [ ] 5.1 ProviderRegistry (env credentials, cost fns, timeouts, circuit breakers, health state)
- [ ] 5.2 Register first providers (one LLM, one embedding) as reference implementations

## 6. Deployment & validation
- [ ] 6.1 Evolve Docker/compose; staging deployment; secrets via env; `docs/` deployment + API reference
- [ ] 6.2 Integration tests: lifecycle/crash-recovery/idempotency/parallel SKIP LOCKED; quota math; envelope contract; SSRF
- [ ] 6.3 CI load smoke with recorded latency baseline; security authz matrix tests
