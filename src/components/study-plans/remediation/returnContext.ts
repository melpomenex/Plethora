export interface ReassessmentReturnContext {
  planId?: string | null;
  versionId?: string | null;
  nodeId?: string | null;
  gapId?: string | null;
  sourceAttemptId?: string | null;
}

export function returnContextLabel(ctx: ReassessmentReturnContext | null | undefined): string {
  if (!ctx) return 'no return context';
  return `plan ${ctx.planId ?? '—'} · version ${ctx.versionId ?? '—'} · node ${ctx.nodeId ?? '—'} · gap ${ctx.gapId ?? '—'}`;
}
