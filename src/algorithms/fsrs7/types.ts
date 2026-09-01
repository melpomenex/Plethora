export interface Fsrs7MemoryState {
  stability: number;
  stability_fast: number;
  difficulty: number;
}

/** FSRS-7 weight vector (34 elements). */
export type Fsrs7Parameters = readonly number[];

export interface Fsrs7ReviewLogEntry {
  rating: number;
  delta_t: number;
}

export interface Fsrs7ItemState {
  memory: Fsrs7MemoryState;
  interval: number;
}

export interface Fsrs7NextStates {
  again: Fsrs7ItemState;
  hard: Fsrs7ItemState;
  good: Fsrs7ItemState;
  easy: Fsrs7ItemState;
}

export interface Fsrs7ScheduleOptions {
  desiredRetention?: number;
  maximumInterval?: number;
}
