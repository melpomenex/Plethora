import { stepMemoryState } from "./schedule";
export function replayHistory(w, reviews, startingState) {
    let state = startingState ?? {
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
//# sourceMappingURL=replay.js.map