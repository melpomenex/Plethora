/**
 * Bounded candidate queue for passage scoring (task 2.1).
 *
 * Encounters never classify. The queue holds at most 8 anchored passages;
 * excess candidates are skipped and counted instead of growing memory or AI
 * work without bound.
 */

import { PASSAGE_QUEUE_LIMIT } from "./types";

export interface PassageCandidate {
  readonly passageId: string;
  /** Monotonic sequence for deterministic ordering (encounter order). */
  readonly sequence: number;
}

export class PassageCandidateQueue {
  private readonly items: PassageCandidate[] = [];
  private readonly ids = new Set<string>();
  private sequence = 0;

  constructor(readonly limit = PASSAGE_QUEUE_LIMIT) {}

  /** False when the queue is full or the passage is already queued. */
  push(passageId: string): boolean {
    if (this.ids.has(passageId)) return false;
    if (this.items.length >= this.limit) return false;
    this.ids.add(passageId);
    this.items.push({ passageId, sequence: this.sequence++ });
    return true;
  }

  pop(): PassageCandidate | undefined {
    const next = this.items.shift();
    if (next) this.ids.delete(next.passageId);
    return next;
  }

  remove(passageId: string): boolean {
    const index = this.items.findIndex((item) => item.passageId === passageId);
    if (index < 0) return false;
    this.items.splice(index, 1);
    this.ids.delete(passageId);
    return true;
  }

  has(passageId: string): boolean {
    return this.ids.has(passageId);
  }

  clear(): void {
    this.items.length = 0;
    this.ids.clear();
  }

  get size(): number {
    return this.items.length;
  }

  get capacity(): number {
    return this.limit;
  }

  idsInOrder(): string[] {
    return this.items.map((item) => item.passageId);
  }
}
