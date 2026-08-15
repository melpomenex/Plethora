/**
 * Task registry: id → definition, used by the router to resolve
 * `reasoningFallback` targets. Task modules register at import time.
 */

import type { AITaskDefinition, AITaskId } from "./types";

const tasks = new Map<AITaskId, AITaskDefinition<never, unknown>>();

export function registerTask(task: AITaskDefinition<never, unknown>): void;
export function registerTask<I, O>(task: AITaskDefinition<I, O>): void;
export function registerTask(task: AITaskDefinition<any, any>): void {
  tasks.set(task.id, task as AITaskDefinition<never, unknown>);
}

/** Register several at once (module bottom). */
export function registerTasks(...defs: Array<AITaskDefinition<any, any>>): void {
  for (const def of defs) registerTask(def);
}

export function getTaskDefinition(id: AITaskId): AITaskDefinition<never, unknown> | undefined {
  return tasks.get(id);
}

/** Test/teardown helper. */
export function clearTaskRegistry(): void {
  tasks.clear();
}
