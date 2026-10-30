import {
  updateLearningItemContentWithVersion,
  type LearningItem,
  type UpdateLearningItemContentInput,
} from "./learning-items";

export type MutationOperation = "edit" | "delete" | "rate" | "restore";

export interface EntityMutationState {
  busy: boolean;
  activeOperation: MutationOperation | null;
  currentRevision: number;
  lastError: Error | null;
  lastCommittedItem: LearningItem | null;
  lastAcquiredTick: number;
}

export interface MutationToken {
  readonly itemId: string;
  readonly operation: MutationOperation;
  readonly revision: number;
  /** Commit canonical result. Discards stale completions automatically. */
  commit: (updated: LearningItem) => boolean;
  /** Rollback operation on error. */
  rollback: (error: Error) => void;
  /** Release lock without committing. */
  release: () => void;
}

export type CardReconciler = (committedItem: LearningItem) => void;

class LearningItemMutationCoordinator {
  private entityStates = new Map<string, EntityMutationState>();
  private reconcilers = new Set<CardReconciler>();
  private tickCounter = 0;
  private tickScheduled = false;

  private scheduleTickAdvance(): void {
    if (!this.tickScheduled) {
      this.tickScheduled = true;
      const advance = () => {
        this.tickCounter++;
        this.tickScheduled = false;
      };
      if (typeof queueMicrotask === "function") {
        queueMicrotask(advance);
      } else {
        setTimeout(advance, 0);
      }
    }
  }

  private getOrCreateState(itemId: string): EntityMutationState {
    let state = this.entityStates.get(itemId);
    if (!state) {
      state = {
        busy: false,
        activeOperation: null,
        currentRevision: 0,
        lastError: null,
        lastCommittedItem: null,
        lastAcquiredTick: -1,
      };
      this.entityStates.set(itemId, state);
    }
    return state;
  }

  /**
   * Check if an entity is currently busy with any pending mutation.
   */
  public isItemBusy(itemId: string): boolean {
    const state = this.entityStates.get(itemId);
    return Boolean(state?.busy);
  }

  /**
   * Synchronously acquire an exclusive mutation token for an item.
   * Returns null if the item is already busy or if called twice in the same synchronous tick.
   */
  public acquireMutationToken(
    itemId: string,
    operation: MutationOperation
  ): MutationToken | null {
    if (!itemId) return null;
    const state = this.getOrCreateState(itemId);

    // Reject if already busy with a pending mutation
    if (state.busy) {
      return null;
    }

    // Synchronous operation tokens block two activations in the same tick
    if (state.lastAcquiredTick === this.tickCounter) {
      return null;
    }

    state.busy = true;
    state.activeOperation = operation;
    state.lastError = null;
    state.currentRevision += 1;
    state.lastAcquiredTick = this.tickCounter;
    this.scheduleTickAdvance();

    const revision = state.currentRevision;
    let released = false;

    const release = () => {
      if (released) return;
      released = true;
      if (state.currentRevision === revision) {
        state.busy = false;
        state.activeOperation = null;
      }
    };

    const rollback = (error: Error) => {
      if (released) return;
      released = true;
      if (state.currentRevision === revision) {
        state.busy = false;
        state.activeOperation = null;
        state.lastError = error;
      }
    };

    const commit = (updated: LearningItem): boolean => {
      if (released) return false;
      released = true;

      // Stale completion / wrong item guard:
      if (updated.id !== itemId || state.currentRevision !== revision) {
        return false;
      }

      state.busy = false;
      state.activeOperation = null;
      state.lastError = null;
      state.lastCommittedItem = updated;

      // Reconcile committed canonical record into every registered store / cache
      this.reconcile(updated);
      return true;
    };

    return {
      itemId,
      operation,
      revision,
      commit,
      rollback,
      release,
    };
  }

  /**
   * Register a store / cache reconciler function that receives committed canonical cards by ID.
   */
  public registerReconciler(reconciler: CardReconciler): () => void {
    this.reconcilers.add(reconciler);
    return () => {
      this.reconcilers.delete(reconciler);
    };
  }

  /**
   * Broadcast a canonical committed item to all registered reconcilers.
   */
  public reconcile(committedItem: LearningItem): void {
    if (!committedItem || !committedItem.id) return;
    for (const reconciler of this.reconcilers) {
      try {
        reconciler(committedItem);
      } catch (err) {
        console.error("CardReconciler error:", err);
      }
    }
  }

  /**
   * High-level atomic content & tag edit workflow.
   * Acquires a token, invokes atomic persistence, reconciles caches, and handles rollback.
   */
  public async mutateLearningItemContent(
    input: UpdateLearningItemContentInput
  ): Promise<LearningItem> {
    const token = this.acquireMutationToken(input.itemId, "edit");
    if (!token) {
      throw new Error(`LearningItem ${input.itemId} is busy or mutation already in flight`);
    }

    try {
      const canonical = await updateLearningItemContentWithVersion(input);
      const committed = token.commit(canonical);
      if (!committed) {
        throw new Error(`Edit for ${input.itemId} was superseded by a newer mutation`);
      }
      return canonical;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      token.rollback(error);
      throw error;
    }
  }

  /**
   * Reset all entity mutation states (useful for test teardown).
   */
  public resetForTesting(): void {
    this.entityStates.clear();
    this.reconcilers.clear();
    this.tickCounter = 0;
    this.tickScheduled = false;
  }
}

export const cardMutationCoordinator = new LearningItemMutationCoordinator();
