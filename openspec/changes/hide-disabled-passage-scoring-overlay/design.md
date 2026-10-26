## Context

See `proposal.md` for the motivation. The passage-scoring hook distinguishes the explicit
feature toggle from operational readiness: scoring runs only when both are true, while the
model-readiness warning is derived from the feature toggle. Its returned warning and
visibility are not currently gated by that toggle. Controller cleanup clears results and
the open passage, but leaves status and its reason in hook state.

## Goals / Non-Goals

**Goals:**

- Hide the scoring overlay as soon as the explicit feature toggle is off.
- Clear transient scoring status, results, and open-passage state when disabled.
- Preserve model-readiness and authorization warnings while the feature remains enabled.

**Non-Goals:**

- Change remote authorization policy or classify passages while the feature is disabled.
- Attribute OpenRouter traffic observed after restart to passage scoring; that requires a
  separate investigation of the task responsible.

## Decisions

1. **Use `featureEnabled` for presentation gating.** Gate the surfaced status reason and
   returned `visible` value on the explicit feature toggle. Do not use the combined
   operational `enabled` value for these presentation decisions: it also requires model
   readiness and would hide legitimate model-unavailable warnings while scoring is opted in.

2. **Clear transient state on disable.** Add an effect keyed by `featureEnabled` that, when
   false, sets the status reason to `null`, sets the status to `disabled`, empties the result
   map, and clears the open passage id. Keep the existing controller cleanup for adapter
   disposal and result/open-passage cleanup.

3. **Test the state transition at the reader integration boundary.** Extend the hook
   integration coverage so a remote-authorization denial produces a visible warning while
   enabled, then rerendering with the feature disabled hides the warning immediately. Also
   cover the enabled-but-model-unavailable case so presentation gating cannot regress to the
   combined readiness flag.

## Risks / Trade-offs

- **A status callback could arrive while disabling:** the controller is disposed by the
  existing lifecycle effect, and the presentation gate hides the overlay on the disabled
  render before the state-clearing effect runs.
- **Over-gating could hide readiness help:** use the explicit toggle for presentation and
  retain coverage for warnings while enabled but not ready.
