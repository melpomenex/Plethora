/**
 * Tool authority and artifact preservation (design D5/D6, task 3.6).
 *
 * Rules, enforced here so every adapter shares them:
 *
 *  - Only an explicit user action or explicit creation intent grants an
 *    allowed action set. Model text / source text cannot grant privileges.
 *  - Execution goes through existing tool allowlists, permission and
 *    confirmation checks before running.
 *  - Each accepted action records an idempotency key *before* execution;
 *    retries, hydration and synchronization never replay a successful effect.
 *  - A crash-uncertain execution is "check saved result", not auto-retry.
 *  - Only user-promoted artifacts enter the durable index; a saved response
 *    referencing artifacts keeps those links and never recreates them.
 */

export type ToolPermissionVerdict =
  | { allowed: true }
  | { allowed: false; reason: "not_authorized" | "needs_confirmation" | "source_not_owned" };

export interface AllowedActionSet {
  /** Tool names the *user* authorized for this turn/thread. */
  tools: ReadonlySet<string>;
  /** Source ids the user owns and explicitly attached. */
  ownedSourceIds: ReadonlySet<string>;
  /** Tools that additionally require an explicit confirmation step. */
  requireConfirmation: ReadonlySet<string>;
}

export function emptyAllowedActions(): AllowedActionSet {
  return {
    tools: new Set(),
    ownedSourceIds: new Set(),
    requireConfirmation: new Set(),
  };
}

/**
 * Derive the allowed action set from explicit signals only. `modelText` and
 * `sourceText` are accepted as parameters purely so tests can prove they are
 * ignored.
 */
export function deriveAllowedActions(options: {
  userRequestedTools?: readonly string[];
  uiActionTools?: readonly string[];
  ownedSourceIds?: readonly string[];
  confirmationRequiredTools?: readonly string[];
  modelText?: string;
  sourceText?: string;
}): AllowedActionSet {
  void options.modelText;
  void options.sourceText;
  const tools = new Set<string>([
    ...(options.userRequestedTools ?? []),
    ...(options.uiActionTools ?? []),
  ]);
  return {
    tools,
    ownedSourceIds: new Set(options.ownedSourceIds ?? []),
    requireConfirmation: new Set(
      (options.confirmationRequiredTools ?? []).filter((tool) => tools.has(tool)),
    ),
  };
}

export interface ToolExecutionRequest {
  name: string;
  /** Source ids the model's parameters reference. */
  referencedSourceIds?: readonly string[];
  /** True once the user completed the confirmation step. */
  confirmed?: boolean;
}

/**
 * The pre-execution check. Returns `allowed: false` for unauthorized tools,
 * unowned sources and unconfirmed sensitive tools — regardless of what the
 * model or source text asked for.
 */
export function authorizeToolExecution(
  request: ToolExecutionRequest,
  allowed: AllowedActionSet,
): ToolPermissionVerdict {
  if (!allowed.tools.has(request.name)) {
    return { allowed: false, reason: "not_authorized" };
  }
  for (const sourceId of request.referencedSourceIds ?? []) {
    if (!allowed.ownedSourceIds.has(sourceId)) {
      return { allowed: false, reason: "source_not_owned" };
    }
  }
  if (allowed.requireConfirmation.has(request.name) && !request.confirmed) {
    return { allowed: false, reason: "needs_confirmation" };
  }
  return { allowed: true };
}

export type ExecutionState =
  | { status: "completed"; artifactIds: string[]; executedAt: number }
  | { status: "uncertain"; idempotencyKey: string }
  | { status: "failed"; reason: string; retryable: boolean };

export interface RecordedEffect {
  idempotencyKey: string;
  toolName: string;
  state: ExecutionState;
}

/**
 * Durable execution ledger. The key is written *before* dispatch so a crash
 * leaves an `uncertain` record that requires "Check saved result".
 */
export class ToolEffectLedger {
  private effects = new Map<string, RecordedEffect>();

  /** Record the intent to execute. Returns the key to pass to the runner. */
  beginExecution(options: { conversationId: string; turnId: string; attemptId: string; toolName: string; callIndex: number }): string {
    const key = `${options.conversationId}:${options.turnId}:${options.attemptId}:${options.toolName}:${options.callIndex}`;
    if (!this.effects.has(key)) {
      this.effects.set(key, {
        idempotencyKey: key,
        toolName: options.toolName,
        state: { status: "uncertain", idempotencyKey: key },
      });
    }
    return key;
  }

  complete(key: string, artifactIds: string[], now?: () => number): void {
    const existing = this.effects.get(key);
    if (!existing) return;
    this.effects.set(key, {
      ...existing,
      state: { status: "completed", artifactIds, executedAt: (now ?? Date.now)() },
    });
  }

  fail(key: string, reason: string, retryable: boolean): void {
    const existing = this.effects.get(key);
    if (!existing) return;
    this.effects.set(key, { ...existing, state: { status: "failed", reason, retryable } });
  }

  get(key: string): RecordedEffect | undefined {
    return this.effects.get(key);
  }

  /**
   * Whether a retry may execute a call. A completed effect is never replayed;
   * an uncertain one requires an explicit "check saved result" reconciliation
   * (`reconcile`) before it may run again.
   */
  retryDecision(key: string): { run: boolean; reason: "never_replay" | "check_saved_result" | "safe_to_retry" | "never_started" } {
    const effect = this.effects.get(key);
    if (!effect) return { run: true, reason: "never_started" };
    switch (effect.state.status) {
      case "completed":
        return { run: false, reason: "never_replay" };
      case "uncertain":
        return { run: false, reason: "check_saved_result" };
      case "failed":
        return effect.state.retryable
          ? { run: true, reason: "safe_to_retry" }
          : { run: false, reason: "never_replay" };
    }
  }

  /** Resolve a crash-uncertain effect after the user checks the saved result. */
  reconcile(key: string, outcome: { artifactIds: string[] } | { missing: true }, now?: () => number): void {
    const existing = this.effects.get(key);
    if (!existing) return;
    if ("missing" in outcome) {
      this.effects.set(key, {
        ...existing,
        state: { status: "failed", reason: "checked: no saved result", retryable: true },
      });
      return;
    }
    this.effects.set(key, {
      ...existing,
      state: { status: "completed", artifactIds: outcome.artifactIds, executedAt: (now ?? Date.now)() },
    });
  }

  /** Artifacts are only indexed when the user promoted them. */
  listPromotedArtifacts(promoted: ReadonlySet<string>): string[] {
    const out: string[] = [];
    for (const effect of this.effects.values()) {
      if (effect.state.status !== "completed") continue;
      for (const artifactId of effect.state.artifactIds) {
        if (promoted.has(artifactId)) out.push(artifactId);
      }
    }
    return out;
  }
}

/**
 * Hydration guard: saved responses, retries and synchronization never execute
 * tools. They only re-link artifacts that were already created.
 */
export function hydrationMayExecuteTools(): false {
  return false;
}
