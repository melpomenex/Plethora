## Why

Passage scoring can keep a remote-authorization warning or prior results in hook state after the user disables the feature, and the overlay can continue to render them. Disabling scoring should remove its UI immediately, while users who leave scoring enabled should still see warnings when model readiness or remote authorization prevents scoring.

## What Changes

- Make passage-scoring overlay visibility and surfaced status reasons respect the user-facing feature toggle.
- Clear transient scoring status, results, and open-passage state when the feature is disabled.
- Add a regression scenario for enabling scoring, receiving a remote-authorization warning, then disabling scoring and seeing the warning disappear immediately.
- Keep warnings for unavailable dependencies visible while the feature remains enabled.
- Treat OpenRouter requests observed after restarting with passage scoring disabled as a separate attribution investigation; this change does not assume those requests come from passage scoring.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ai-knowledge-relationships`: clarify that disabled passage scoring hides its overlay and stale scoring state, while enabled scoring may still surface readiness or authorization warnings.

## Impact

The passage-scoring hook and its reader integration tests are affected. The hook is used by document and RSS readers. No API or dependency changes are expected.
