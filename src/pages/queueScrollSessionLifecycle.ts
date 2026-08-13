/**
 * Decide whether a Queue Scroll session-build effect run may replace the
 * established item order.
 *
 * `isRating` remains an effect dependency so entering the lock cancels an
 * in-flight async build. The first run after the lock is released must also be
 * skipped: rating/dismissal already removed the current item in place, and a
 * fresh composition would restart the greedy mix at the current numeric index
 * and replace the successor that was just revealed.
 */
export function shouldBuildScrollSession({
  isRating,
  wasRating,
}: {
  isRating: boolean;
  wasRating: boolean;
}): boolean {
  return !isRating && !wasRating;
}
