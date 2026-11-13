import { invokeCommand, isTauri } from '../lib/tauri';
import type { ExternalSnapshot } from '../lib/study-plans/webresearch/snapshots';

export interface StudyPlanWebResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
}

function ensureNativeSupport(): void {
  if (!isTauri()) throw new Error('Web Research is available in the desktop app.');
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'The Web Research request failed.';
}

export async function searchStudyPlanWeb(query: string, requestId: string): Promise<StudyPlanWebResult[]> {
  ensureNativeSupport();
  try {
    return await invokeCommand<StudyPlanWebResult[]>('search_study_plan_web', {
      query,
      approved: true,
      requestId,
    });
  } catch (error) {
    throw new Error(readableError(error));
  }
}

export async function captureStudyPlanResearchSnapshot(input: {
  planId: string;
  planVersionId: string;
  query: string;
  url: string;
  title: string;
  requestId: string;
}): Promise<ExternalSnapshot> {
  ensureNativeSupport();
  try {
    return await invokeCommand<ExternalSnapshot>('capture_study_plan_research_snapshot', {
      planId: input.planId,
      planVersionId: input.planVersionId,
      query: input.query,
      url: input.url,
      title: input.title,
      requestId: input.requestId,
    });
  } catch (error) {
    throw new Error(readableError(error));
  }
}

export async function cancelStudyPlanResearchRequest(requestId: string): Promise<boolean> {
  ensureNativeSupport();
  try {
    return await invokeCommand<boolean>('cancel_study_plan_research_request', { requestId });
  } catch (error) {
    throw new Error(readableError(error));
  }
}

export async function listStudyPlanResearchSnapshots(
  planId: string,
  planVersionId: string
): Promise<ExternalSnapshot[]> {
  ensureNativeSupport();
  try {
    return await invokeCommand<ExternalSnapshot[]>('list_study_plan_research_snapshots', {
      planId,
      planVersionId,
    });
  } catch (error) {
    throw new Error(readableError(error));
  }
}

export async function acceptStudyPlanResearchSnapshot(
  snapshotId: string,
  planId: string,
  planVersionId: string
): Promise<ExternalSnapshot> {
  ensureNativeSupport();
  try {
    return await invokeCommand<ExternalSnapshot>('accept_study_plan_research_snapshot', {
      snapshotId,
      planId,
      planVersionId,
    });
  } catch (error) {
    throw new Error(readableError(error));
  }
}
