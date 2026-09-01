import { stepMemoryState } from "./schedule";
import type { Fsrs7MemoryState, Fsrs7Parameters, Fsrs7ReviewLogEntry } from "./types";

export function replayHistory(
  w: Fsrs7Parameters,
  reviews: Fsrs7ReviewLogEntry[],
  startingState?: Fsrs7MemoryState | null,
): Fsrs7MemoryState {
  let state: Fsrs7MemoryState = startingState ?? {
    stability: 0,
    difficulty: 0,
    stability_fast: 0,
  };

  for (let index = 0; index < reviews.length; index += 1) {
    const review = reviews[index];
    state = stepMemoryState(w, state, review.delta_t, review.rating, index);
  }

  return state;
}
