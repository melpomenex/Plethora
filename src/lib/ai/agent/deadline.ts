/**
 * One hard run deadline shared by every stage of an agent run (task 2.1).
 *
 * The existing `AgentBoundsTracker` checks wall-clock time between tool/model
 * steps, but it cannot interrupt a slow retrieval or a final model turn. This
 * module owns the single `AbortController` for a run and links it to every
 * lifecycle signal the user can cause:
 *
 *   - Stop (external signal),
 *   - conversation switch / source change / feature flag off / unmount (the
 *     caller aborts the same external signal), and
 *   - the absolute deadline (one timer, never reset per turn).
 *
 * `remainingMs()` is passed into each `runTask` (and used as the bounds
 * wall-clock window) so no turn receives a fresh allowance. When the deadline
 * fires the controller aborts; callers distinguish deadline expiry from a
 * user cancellation through `expiredByDeadline()` and never retry remotely
 * after either.
 */

import { MAX_AGENT_WALL_CLOCK_MS } from "./bounds";

export interface AgentRunDeadline {
  /** Combined signal: aborts on Stop, lifecycle changes or the deadline. */
  readonly signal: AbortSignal;
  /** Milliseconds left before the absolute deadline (never negative). */
  remainingMs(): number;
  /** The absolute deadline has passed (even if no abort listener ran yet). */
  expired(): boolean;
  /** True when the controller was aborted by the clock rather than the user. */
  expiredByDeadline(): boolean;
  /** External caller aborted (Stop, source change, conversation switch, unmount). */
  cancelledExternally(): boolean;
  /** Release the timer/listener. Idempotent. */
  dispose(): void;
}

export interface CreateAgentDeadlineOptions {
  /** Caller signal linking user Stop + lifecycle changes. */
  signal?: AbortSignal;
  /** Absolute budget for the whole run. Defaults to the 60s agent bound. */
  wallClockMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
  /** Injectable timer seam (tests). */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export function createAgentDeadline(
  options: CreateAgentDeadlineOptions = {}
): AgentRunDeadline {
  const wallClockMs = options.wallClockMs ?? MAX_AGENT_WALL_CLOCK_MS;
  const now = options.now ?? Date.now;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const startedAt = now();
  const deadlineAt = startedAt + Math.max(0, wallClockMs);
  const controller = new AbortController();
  let disposed = false;
  let external = false;
  let byDeadline = false;

  const onExternalAbort = () => {
    if (disposed || controller.signal.aborted) return;
    external = true;
    controller.abort();
  };

  if (options.signal) {
    if (options.signal.aborted) onExternalAbort();
    else options.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  const timer = setTimeoutFn(() => {
    if (disposed || controller.signal.aborted) return;
    byDeadline = true;
    controller.abort();
  }, Math.max(0, deadlineAt - now()));

  // `setTimeout` in browsers returns a number; in Node a Timeout object. Keep
  // the opaque handle so both environments can clear it.
  const handle = timer as unknown as ReturnType<typeof setTimeout>;

  return {
    signal: controller.signal,
    remainingMs: () => Math.max(0, deadlineAt - now()),
    expired: () => byDeadline || now() >= deadlineAt,
    expiredByDeadline: () => byDeadline,
    cancelledExternally: () => external,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeoutFn(handle);
      options.signal?.removeEventListener("abort", onExternalAbort);
    },
  };
}
