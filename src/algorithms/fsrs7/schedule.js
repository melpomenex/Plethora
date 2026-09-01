export const S_MIN = 0.0001;
export const S_MAX = 36500.0;
export const D_MIN = 1.0;
export const D_MAX = 10.0;
const DR_MIN = 0.0001;
const DR_MAX = 0.9999;
const INTERVAL_NEWTON_ITERS = 7;
const BISECTION_ITERS = 50;
const MIN_T = 1.0 / 86_400.0;
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
function initDifficultyScalar(w, rating) {
    const r = clamp(Math.round(rating), 1, 4);
    return w[4] - Math.exp(w[5] * (r - 1)) + 1.0;
}
function linearDampingScalar(deltaD, oldD) {
    return ((10.0 - oldD) * deltaD) / 9.0;
}
function meanReversionScalar(init, current) {
    return init * 0.01 + current * 0.99;
}
function nextDifficultyScalarForRetention(w, d, rating, retention) {
    const r = clamp(Math.round(rating), 1, 4);
    let deltaD = -w[6] * (r - 3.0);
    if (r === 1) {
        deltaD *= retention + 0.1;
    }
    const newD = d + linearDampingScalar(deltaD, d);
    return clamp(meanReversionScalar(initDifficultyScalar(w, 4), newD), D_MIN, D_MAX);
}
function stabilityForSetScalar(w, lastS, lastD, retrievability, rating, start) {
    const r = clamp(Math.round(rating), 1, 4);
    const hardPenalty = r === 2 ? w[start + 6] : 1.0;
    const easyBonus = r === 4 ? w[start + 7] : 1.0;
    const newSFail = w[start + 3] *
        (Math.pow(lastS + 1.0, w[start + 4]) - 1.0) *
        Math.exp((1.0 - retrievability) * w[start + 5]);
    const pls = Math.min(lastS, newSFail);
    const sinc = Math.exp(w[start] - 1.5) *
        (11.0 - lastD) *
        Math.pow(lastS, -w[start + 1]) *
        (Math.exp((1.0 - retrievability) * w[start + 2]) - 1.0) *
        hardPenalty *
        easyBonus +
        1.0;
    const newSSuccess = Math.max(pls, lastS * sinc);
    const raw = r > 1 ? newSSuccess : pls;
    return clamp(raw, S_MIN, S_MAX);
}
function fastComponentRecallScalar(w, t, sFast) {
    const elapsed = Math.max(0.0, t);
    const stabilityFast = clamp(sFast, S_MIN, S_MAX);
    const decay1Mag = clamp(w[23] * Math.pow(stabilityFast, w[33] - 0.3), 0.01, 0.95);
    const decay1 = -decay1Mag;
    const factor1 = Math.exp(Math.min(Math.log(w[25]) / decay1, 60.0)) - 1.0;
    return Math.pow(1.0 + factor1 * (elapsed / stabilityFast), decay1);
}
export function forgettingCurveScalarForState(w, t, state) {
    const elapsed = Math.max(0.0, t);
    const s = Math.max(state.stability, S_MIN);
    const sFast = Math.max(state.stability_fast, S_MIN);
    const d = clamp(state.difficulty, D_MIN, D_MAX);
    const decay1Mag = clamp(w[23] * Math.pow(sFast, w[33] - 0.3), 0.01, 0.95);
    const decay1 = -decay1Mag;
    const factor1 = Math.exp(Math.min(Math.log(w[25]) / decay1, 60.0)) - 1.0;
    const r1 = Math.pow(1.0 + factor1 * (elapsed / sFast), decay1);
    const decay2 = -clamp(w[24], 0.01, 0.95);
    const factor2 = Math.pow(w[26], 1.0 / decay2) - 1.0;
    const dTimescale = Math.exp((d - 5.0) * (w[32] - 0.3));
    const r2 = Math.pow(1.0 + factor2 * dTimescale * (elapsed / s), decay2);
    const weight1 = w[27] * Math.pow(sFast, -w[29]);
    const weight2 = w[28] * Math.pow(s, w[30]) * Math.exp((d - 5.0) * (w[31] - 0.5));
    const retention = (weight1 * r1 + weight2 * r2) / (weight1 + weight2);
    return retention * (1.0 - 2e-5) + 1e-5;
}
function forgettingCurveAndDerivativeScalarForState(w, t, state) {
    const elapsed = Math.max(0.0, t);
    const s = Math.max(state.stability, S_MIN);
    const sFast = Math.max(state.stability_fast, S_MIN);
    const d = clamp(state.difficulty, D_MIN, D_MAX);
    const decay1Mag = clamp(w[23] * Math.pow(sFast, w[33] - 0.3), 0.01, 0.95);
    const decay1 = -decay1Mag;
    const factor1 = Math.exp(Math.min(Math.log(w[25]) / decay1, 60.0)) - 1.0;
    const b1 = 1.0 + factor1 * (elapsed / sFast);
    const r1 = Math.pow(b1, decay1);
    const dr1Dt = (decay1 * Math.pow(b1, decay1 - 1.0) * factor1) / sFast;
    const decay2 = -clamp(w[24], 0.01, 0.95);
    const factor2 = Math.pow(w[26], 1.0 / decay2) - 1.0;
    const dTimescale = Math.exp((d - 5.0) * (w[32] - 0.3));
    const b2 = 1.0 + factor2 * dTimescale * (elapsed / s);
    const r2 = Math.pow(b2, decay2);
    const dr2Dt = (decay2 * Math.pow(b2, decay2 - 1.0) * factor2 * dTimescale) / s;
    const weight1 = w[27] * Math.pow(sFast, -w[29]);
    const weight2 = w[28] * Math.pow(s, w[30]) * Math.exp((d - 5.0) * (w[31] - 0.5));
    const weightSum = Math.max(weight1 + weight2, 1e-9);
    const retention = (weight1 * r1 + weight2 * r2) / weightSum;
    const derivative = (weight1 * dr1Dt + weight2 * dr2Dt) / weightSum;
    return [retention * (1.0 - 2e-5) + 1e-5, derivative * (1.0 - 2e-5)];
}
function nextIntervalBisectionScalarForState(w, state, desiredRetention) {
    const target = clamp(desiredRetention, DR_MIN, DR_MAX);
    if (target >= DR_MAX) {
        return 0.0;
    }
    let low = 0.0;
    let high = Math.max(state.stability, state.stability_fast, 1.0);
    while (forgettingCurveScalarForState(w, high, state) > target && high < S_MAX) {
        high = Math.min(high * 2.0, S_MAX);
    }
    for (let i = 0; i < BISECTION_ITERS; i += 1) {
        const mid = (low + high) * 0.5;
        if (forgettingCurveScalarForState(w, mid, state) > target) {
            low = mid;
        }
        else {
            high = mid;
        }
    }
    return clamp((low + high) * 0.5, 0.0, S_MAX);
}
export function nextInterval(w, state, desiredRetention) {
    const target = clamp(desiredRetention, DR_MIN, DR_MAX);
    if (target >= DR_MAX) {
        return 0.0;
    }
    const clampedState = {
        stability: clamp(state.stability, S_MIN, S_MAX),
        difficulty: clamp(state.difficulty, D_MIN, D_MAX),
        stability_fast: clamp(state.stability_fast, S_MIN, S_MAX),
    };
    const minLogT = Math.log(MIN_T);
    const maxLogT = Math.log(S_MAX);
    let logT = Math.log(Math.max(clampedState.stability, clampedState.stability_fast, MIN_T));
    for (let i = 0; i < INTERVAL_NEWTON_ITERS; i += 1) {
        logT = clamp(logT, minLogT, maxLogT);
        const t = clamp(Math.exp(logT), MIN_T, S_MAX);
        const [retrievability, derivative] = forgettingCurveAndDerivativeScalarForState(w, t, clampedState);
        const dfDu = Math.min(derivative * t, -1e-12);
        const step = clamp((retrievability - target) / dfDu, -4.0, 4.0);
        logT -= step;
        if (!Number.isFinite(logT)) {
            return nextIntervalBisectionScalarForState(w, clampedState, target);
        }
    }
    const interval = clamp(Math.exp(logT), 0.0, S_MAX);
    const retrievability = forgettingCurveScalarForState(w, interval, clampedState);
    if (Number.isFinite(retrievability) && Math.abs(retrievability - target) <= 1e-3) {
        return interval;
    }
    return nextIntervalBisectionScalarForState(w, clampedState, target);
}
export function nextStateScalar(w, state, deltaT, rating) {
    const elapsed = Math.max(0.0, deltaT);
    const r = clamp(Math.round(rating), 1, 4);
    const retrievability = forgettingCurveScalarForState(w, elapsed, state);
    const newSSlow = stabilityForSetScalar(w, state.stability, state.difficulty, retrievability, r, 7);
    const rFast = fastComponentRecallScalar(w, elapsed, state.stability_fast);
    let newSFast = stabilityForSetScalar(w, state.stability_fast, state.difficulty, rFast, r, 15);
    if (r === 1) {
        newSFast = Math.min(newSFast, newSSlow * 0.8);
    }
    const newD = nextDifficultyScalarForRetention(w, state.difficulty, r, retrievability);
    return {
        stability: newSSlow,
        difficulty: newD,
        stability_fast: clamp(newSFast, S_MIN, S_MAX),
    };
}
function isInitialState(state) {
    return state.stability === 0 && state.difficulty === 0 && state.stability_fast === 0;
}
function initStabilityScalar(w, rating) {
    const r = clamp(Math.round(rating), 1, 4);
    return w[r - 1];
}
export function stepMemoryState(w, current, deltaT, rating, nth) {
    if (rating === 0) {
        return current;
    }
    const lastS = clamp(current.stability, S_MIN, S_MAX);
    const lastD = clamp(current.difficulty, D_MIN, D_MAX);
    const lastSFast = clamp(current.stability_fast, S_MIN, S_MAX);
    let next = nextStateScalar(w, { stability: lastS, difficulty: lastD, stability_fast: lastSFast }, deltaT, rating);
    if (nth === 0 && isInitialState(current)) {
        const initS = initStabilityScalar(w, rating);
        const initD = clamp(initDifficultyScalar(w, rating), D_MIN, D_MAX);
        next = {
            stability: initS,
            difficulty: initD,
            stability_fast: initS * 0.8,
        };
    }
    return {
        stability: clamp(next.stability, S_MIN, S_MAX),
        difficulty: clamp(next.difficulty, D_MIN, D_MAX),
        stability_fast: clamp(next.stability_fast, S_MIN, S_MAX),
    };
}
function clampInterval(interval, maximumInterval) {
    if (maximumInterval === undefined) {
        return interval;
    }
    return Math.min(interval, maximumInterval);
}
function buildItemState(w, memory, desiredRetention, maximumInterval) {
    const interval = clampInterval(nextInterval(w, memory, desiredRetention), maximumInterval);
    return { memory, interval };
}
export function nextStatesWithElapsedDays(w, currentMemoryState, daysElapsed, options = {}) {
    const desiredRetention = options.desiredRetention ?? 0.9;
    const maximumInterval = options.maximumInterval;
    const elapsed = Math.max(0.0, daysElapsed);
    const current = currentMemoryState ?? {
        stability: 0,
        difficulty: 0,
        stability_fast: 0,
    };
    const nth = currentMemoryState ? 1 : 0;
    const buildForRating = (rating) => {
        const memory = stepMemoryState(w, current, elapsed, rating, nth);
        return buildItemState(w, memory, desiredRetention, maximumInterval);
    };
    return {
        again: buildForRating(1),
        hard: buildForRating(2),
        good: buildForRating(3),
        easy: buildForRating(4),
    };
}
export function currentRetrievability(w, state, daysElapsed) {
    return forgettingCurveScalarForState(w, Math.max(0.0, daysElapsed), state);
}
//# sourceMappingURL=schedule.js.map