/**
 * Deadline workload projection (task 1.2).
 *
 * Projects remaining ordered lessons onto the learner's chosen study days
 * between today and the optional deadline. Rest days reduce the suggested NEW
 * lesson load only; actual/projected due reviews stay visible and unchanged.
 * This is a pure projection — it never writes scheduler state, cards or dates.
 */

import type { StudyPlanDetail } from '../../../types/learningPaths';

export interface StudyPlanPreferencesInput {
  deadline?: string | null;
  restDays?: number[];
}

export interface LessonDayLoad {
  date: string; // YYYY-MM-DD
  newLessons: number;
}

export interface DeadlineProjection {
  remainingLessons: number;
  /** Suggested distribution of NEW lessons across study days (rest days skipped). */
  studyLoad: LessonDayLoad[];
  /** True when fewer study days remain than lessons (overflow). */
  overflow: boolean;
  /** True when the deadline is already in the past. */
  passed: boolean;
  /** Projected due reviews per day (pass-through; unaffected by rest days). */
  projectedDueReviews: LessonDayLoad[];
  /** Unavailable forecast flag: no forecast data → null and no fabrication. */
  forecastAvailable: boolean;
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

export function projectDeadline(
  planDetail: StudyPlanDetail,
  preferences: StudyPlanPreferencesInput,
  opts: { today?: string; forecast?: LessonDayLoad[] | null; dailyCap?: number } = {}
): DeadlineProjection {
  const today = opts.today ?? toIsoDate(new Date());
  const remaining = planDetail.version.nodes.filter((n) => n.included).length;
  const rest = new Set(preferences.restDays ?? []);
  const deadline = preferences.deadline ?? null;
  const dailyCap = opts.dailyCap ?? 8;
  const forecast = opts.forecast ?? [];
  const forecastAvailable = opts.forecast !== undefined;

  if (!deadline) {
    return {
      remainingLessons: remaining,
      studyLoad: [],
      overflow: false,
      passed: false,
      projectedDueReviews: forecast,
      forecastAvailable,
    };
  }

  const passed = deadline < today;
  if (passed) {
    return {
      remainingLessons: remaining,
      studyLoad: [],
      overflow: true,
      passed: true,
      projectedDueReviews: forecast,
      forecastAvailable,
    };
  }

  // Build study days from today (inclusive) through the deadline.
  const studyDays: string[] = [];
  let cursor = today;
  let guard = 0;
  while (cursor <= deadline && guard < 1000) {
    const weekday = new Date(`${cursor}T00:00:00Z`).getUTCDay();
    if (!rest.has(weekday)) studyDays.push(cursor);
    cursor = addDays(cursor, 1);
    guard += 1;
  }

  const load: LessonDayLoad[] = [];
  let remainingToAssign = remaining;
  for (const day of studyDays) {
    if (remainingToAssign <= 0) break;
    const batch = Math.min(Math.ceil(remainingToAssign / (studyDays.length - load.length)) || 1, dailyCap);
    const assigned = Math.min(batch, remainingToAssign);
    load.push({ date: day, newLessons: assigned });
    remainingToAssign -= assigned;
  }

  return {
    remainingLessons: remaining,
    studyLoad: load,
    overflow: remainingToAssign > 0 || studyDays.length === 0,
    passed: false,
    projectedDueReviews: forecast,
    forecastAvailable,
  };
}
