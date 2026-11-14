import type { StudyPlanGraphPrefs } from './types';

const STORAGE_KEY_PREFIX = 'plethora:study-plan-graph-prefs:';

export const DEFAULT_STUDY_PLAN_GRAPH_PREFS: StudyPlanGraphPrefs = {
  outlineMode: 'list',
  orientation: 'TB',
  showMinimap: true,
  showLegend: true,
};

export function loadStudyPlanGraphPrefs(planId: string): StudyPlanGraphPrefs {
  if (!planId || typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_STUDY_PLAN_GRAPH_PREFS };
  }
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${planId}`);
    if (!raw) return { ...DEFAULT_STUDY_PLAN_GRAPH_PREFS };
    const parsed = JSON.parse(raw) as Partial<StudyPlanGraphPrefs>;
    return {
      outlineMode: parsed.outlineMode === 'graph' ? 'graph' : 'list',
      orientation: parsed.orientation === 'LR' ? 'LR' : 'TB',
      showMinimap: typeof parsed.showMinimap === 'boolean' ? parsed.showMinimap : true,
      showLegend: typeof parsed.showLegend === 'boolean' ? parsed.showLegend : true,
    };
  } catch {
    return { ...DEFAULT_STUDY_PLAN_GRAPH_PREFS };
  }
}

export function saveStudyPlanGraphPrefs(
  planId: string,
  patch: Partial<StudyPlanGraphPrefs>
): StudyPlanGraphPrefs {
  const current = loadStudyPlanGraphPrefs(planId);
  const next: StudyPlanGraphPrefs = {
    ...current,
    ...patch,
  };
  if (planId && typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${planId}`, JSON.stringify(next));
    } catch {
      // Ignore storage quota or private browsing errors
    }
  }
  return next;
}
