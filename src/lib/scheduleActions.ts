/**
 * Typed schedule-item action contract.
 *
 * One place that defines which actions apply to which item types and how they
 * are invoked. Shared by `ScheduleItemActions`, `ScheduleItemContextMenu`,
 * Agenda rows, and Data grid rows so behavior cannot drift between surfaces.
 */

import type { ScheduleDayItem } from "../types/queue";

export type ScheduleActionType =
  | "open"
  | "postpone"
  | "suspend"
  | "unsuspend"
  | "dismiss"
  | "delete";

export interface ScheduleActionCallbacks {
  onOpen?: (item: ScheduleDayItem) => void;
  onPostpone?: (itemId: string, days: number, itemType?: string) => Promise<void> | void;
  onSuspend?: (itemId: string, itemType: string) => Promise<void> | void;
  onUnsuspend?: (itemId: string, itemType: string) => Promise<void> | void;
  onDismiss?: (itemId: string) => Promise<void> | void;
  onDelete?: (itemId: string, itemType: string) => Promise<void> | void;
}

export interface ScheduleActionContext {
  /** True while a mutation for this item is in flight (prevents duplicates). */
  busy: boolean;
}

/** Postpone presets offered for documents and learning items. */
export const POSTPONE_PRESETS = [1, 3, 7, 14, 30] as const;
export type PostponeDays = (typeof POSTPONE_PRESETS)[number];

export interface ScheduleActionDefinition {
  type: ScheduleActionType;
  /** Item types this action applies to. */
  appliesTo: ScheduleDayItem["itemType"][];
  /** Whether the action is currently disabled (e.g. while busy). */
  disabled?: (ctx: ScheduleActionContext) => boolean;
}

export const SCHEDULE_ACTION_DEFINITIONS: ScheduleActionDefinition[] = [
  { type: "open", appliesTo: ["document", "extract", "learning-item"] },
  { type: "postpone", appliesTo: ["document", "learning-item"] },
  { type: "suspend", appliesTo: ["learning-item"] },
  { type: "unsuspend", appliesTo: ["learning-item"] },
  { type: "dismiss", appliesTo: ["document"] },
  { type: "delete", appliesTo: ["document", "extract", "learning-item"] },
];

/** Whether an action applies to a given item type. */
export function actionAppliesTo(
  action: ScheduleActionType,
  itemType: ScheduleDayItem["itemType"],
): boolean {
  const def = SCHEDULE_ACTION_DEFINITIONS.find((d) => d.type === action);
  if (!def) return false;
  return def.appliesTo.includes(itemType);
}

/** Whether an action is disabled under the current context. */
export function actionDisabled(
  action: ScheduleActionType,
  ctx: ScheduleActionContext,
): boolean {
  const def = SCHEDULE_ACTION_DEFINITIONS.find((d) => d.type === action);
  return def?.disabled?.(ctx) ?? false;
}

/**
 * Invoke a typed action for an item through the callbacks. Returns false when
 * the action is not applicable (e.g. suspending a document) or not wired.
 */
export async function runScheduleAction(
  action: ScheduleActionType,
  item: ScheduleDayItem,
  callbacks: ScheduleActionCallbacks,
): Promise<boolean> {
  if (!actionAppliesTo(action, item.itemType)) return false;
  switch (action) {
    case "open":
      callbacks.onOpen?.(item);
      return true;
    case "postpone":
      // Postpone is always invoked with an explicit preset (see runPostpone).
      return false;
    case "suspend":
      await callbacks.onSuspend?.(item.id, item.itemType);
      return true;
    case "unsuspend":
      await callbacks.onUnsuspend?.(item.id, item.itemType);
      return true;
    case "dismiss":
      await callbacks.onDismiss?.(item.id);
      return true;
    case "delete":
      await callbacks.onDelete?.(item.id, item.itemType);
      return true;
    default:
      return false;
  }
}

/** Invoke a postpone with an explicit preset. */
export function runPostpone(
  item: ScheduleDayItem,
  days: PostponeDays,
  callbacks: ScheduleActionCallbacks,
): Promise<boolean> {
  if (!actionAppliesTo("postpone", item.itemType)) return Promise.resolve(false);
  callbacks.onPostpone?.(item.id, days, item.itemType);
  return Promise.resolve(true);
}
