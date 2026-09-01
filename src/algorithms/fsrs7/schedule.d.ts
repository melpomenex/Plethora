import type { Fsrs7MemoryState, Fsrs7NextStates, Fsrs7Parameters, Fsrs7ScheduleOptions } from "./types";
export declare const S_MIN = 0.0001;
export declare const S_MAX = 36500;
export declare const D_MIN = 1;
export declare const D_MAX = 10;
export declare function forgettingCurveScalarForState(w: Fsrs7Parameters, t: number, state: Fsrs7MemoryState): number;
export declare function nextInterval(w: Fsrs7Parameters, state: Fsrs7MemoryState, desiredRetention: number): number;
export declare function nextStateScalar(w: Fsrs7Parameters, state: Fsrs7MemoryState, deltaT: number, rating: number): Fsrs7MemoryState;
export declare function stepMemoryState(w: Fsrs7Parameters, current: Fsrs7MemoryState, deltaT: number, rating: number, nth: number): Fsrs7MemoryState;
export declare function nextStatesWithElapsedDays(w: Fsrs7Parameters, currentMemoryState: Fsrs7MemoryState | null | undefined, daysElapsed: number, options?: Fsrs7ScheduleOptions): Fsrs7NextStates;
export declare function currentRetrievability(w: Fsrs7Parameters, state: Fsrs7MemoryState, daysElapsed: number): number;
//# sourceMappingURL=schedule.d.ts.map