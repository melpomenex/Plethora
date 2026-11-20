## 1. Identify and restore the episode thread

- [x] 1.1 Pass a stable episode-scoped conversation ID through `PodcastManager` to the shared Assistant from the episode list, player, and transcript viewer. Verify that all three open the same thread and that an out-of-order transcript load cannot replace it.
- [x] 1.2 Hydrate and save the episode's messages, text draft, and scope through the existing Assistant store. Verify dismiss and reopen, route unmount and remount, reload, draft-only state, and stale SQLite hydration after a newer save or clear.
- [x] 1.3 Keep the loaded transcript as the active source and leave shared legacy records in place. Verify same-title episodes stay isolated in the composer and outgoing prompt, and verify a transcript refresh preserves the thread while updating the source for subsequent prompts.

## 2. Preserve submitted turns through navigation

- [x] 2.1 Move ownership of ordinary podcast replies to the episode session lifecycle and bind the panel to its pending and final state. Use a deferred provider reply to verify that closing or navigating away preserves the submitted question and commits the answer once to the original episode. Verify that reopening before completion shows the pending state without dispatching again.
- [x] 2.2 Record failed or interrupted attempts and wire explicit Stop, Clear Chat, and retry to invalidate the correct attempt. Verify provider failure while detached, reload during generation, retry of the same question, stale replies after stop or clear, and isolation across episodes and profile changes.
- [x] 2.3 Keep view effects and authorization tied to their origin. Verify that a detached result cannot open a confirmation or mutate the newly active view, and that restoring a saved result never reruns a completed tool action.

## 3. Verify the podcast workflow

- [x] 3.1 Exercise the complete workflow through desktop close and mobile Back or swipe, navigation out of Podcasts, reopen from a different entry point, and a transcript-grounded follow-up that refers to a previous answer. Verify that the global and document Assistant paths still pass their existing persistence and grounding tests.
- [x] 3.2 Run the focused podcast and Assistant tests, the TypeScript check, and `npm run bench:check`. Record the results for implementation review.

## Verification

- Focused podcast and Assistant suites: 5 files, 34 tests passed.
- `npx tsc --noEmit`: passed.
- `npm run bench:check`: passed; all 77 baselined benchmarks met the gate. Seven faster-than-baseline measurements emitted stale-baseline warnings.
- Bundle budget: passed at 30.0 MB.
