## Context

`useFeatureReadiness("learning-agent")` returns a row with both:

- `status` — the aggregate verdict (`ready`, `checking`, `setup-required`,
  `model-download-required`, `unavailable-platform`, `error`, ...), and
- `limitations` — safe *disclosure* keys collected from operations that are
  usable but degraded (`collectLimitations`, `src/lib/ai/features/registry.ts:503`).

The Assistant currently treats `limitations[0]` as the blocking reason whenever the
row is not `ready`:

```ts
// src/components/assistant/AssistantPanel.tsx:600
const agentUnavailableReason = !agentAvailability.available
  ? LEARNING_AGENT_AVAILABILITY_MESSAGES[...]
  : agentReadinessRow && agentReadinessRow.status !== "ready"
    ? agentReadinessRow.limitations[0] ?? t("assistant.agent.modeBlocked")
    : null;
```

The value is then interpolated into `assistant.mode.unavailable` without translation
(`:3708`, `:3717`, `:4300`). On mobile, embeddings are unavailable, so the optional
embedding dependency adds `ai.limitation.lexicalRetrieval`
(`src/lib/ai/features/registry.ts:143`) to *every* learning-agent row; any non-ready
status therefore reports lexical retrieval as the reason, rendered as a raw key.

## Decision

1. **Blocking reason = unmet dependency.** Derive the reason from the readiness row's
   `dependencies`, choosing the first dependency whose `state` is one of
   `missing`, `unsupported`, `unknown`, or `checking`, and use its `reasonKey` when
   present. This matches how `FeatureReadinessPanel` and `AIDiagnosticsModal` describe
   setup problems and keeps the copy content-free (the registry guarantees reason keys
   never contain endpoints, credentials or document text).
2. **Translate at the boundary.** The derived reason is passed through `t()` before it
   is interpolated. `assistant.mode.unavailable` keeps `{reason}` as a plain string
   placeholder, so locales stay interchangeable.
3. **Limitations stay secondary.** If the row is not ready *and* carries limitations,
   the notice shows only the blocking reason. A ready row may still show its limitation
   elsewhere (feature readiness panel); it must never be used to block entry.
4. **Fallback unchanged.** When no unmet dependency exposes a `reasonKey`, keep
   `t("assistant.agent.modeBlocked")` so the notice is never empty and never a key.

### Why not reorder limitations or add a new field

- Reordering `collectLimitations` to put lexical retrieval last would only hide this
  instance; any other optional degradation would leak next.
- Adding a `blockingReasonKey` to `FeatureReadiness` duplicates data already present in
  `dependencies[]` and would require every probe/test fixture to populate it.
- Special-casing `ai.limitation.lexicalRetrieval` in the Assistant is a symptom patch;
  the row must remain free to report any limitation.

## Risks / Trade-offs

- A `checking` row can report a transient reason; that matches the existing behaviour
  (the row is not ready yet) and is preferable to showing an unrelated limitation.
- Selecting the first unmet dependency depends on the registry's deterministic
  dependency order; tests pin the ordering for the learning-agent operation.
- Translation of `reasonKey` copies the existing pattern already used by
  `FeatureReadinessPanel` (`t(limitation)` per entry) and `AIDiagnosticsModal`.

## Migration

None. No persisted state, schema, or provider configuration changes; only render-time
derivation of an existing value.
