import type { AssistantContext } from '../../../components/assistant/AssistantPanel';
import type { SelectionAskSnapshot } from '../../../utils/selectionAskHandoff';
import { hashSectionContent, type SectionNode } from '../../../utils/sectionIndex';
import { canCreateFlashcardsFromMessage, type AssistantMessageLike } from '../assistantMessageFlashcards';
import type { ActionTarget } from './model';

export function actionSourceIdentity(context?: AssistantContext): string {
  return context && context.type !== 'general' ? `${context.type}:${context.documentId || context.url || context.metadata?.videoId || context.metadata?.title || 'attached'}` : 'conversation';
}
export interface TargetResolution {
  targets: ActionTarget[];
  target?: ActionTarget;
  fullTarget?: ActionTarget;
  mismatch: boolean;
}
export function resolveActionTargets(input: { context?: AssistantContext; pin?: SelectionAskSnapshot | null; sections: readonly SectionNode[]; messages: readonly (AssistantMessageLike & { provenance?: { documentIds: string[] }; toolCalls?: unknown; quiz?: unknown; agentRun?: unknown })[]; manual?: { owner: string; key: string }; revision?: string }): TargetResolution {
  const { context, pin, messages, revision } = input;
  const sections = input.sections.filter(s => !s.documentId || s.documentId === context?.documentId);
  const owner = actionSourceIdentity(context);
  const targets: ActionTarget[] = [];
  const hasSource = context && context.type !== "general";
  const base = { owner, sourceType: context?.type ?? 'general', documentId: context?.documentId, url: context?.url, title: context?.metadata?.title, revision, privacyDocumentIds: context?.privacyDocumentIds };
  const locator = context?.position?.pageNumber ? `p. ${context.position.pageNumber}` : typeof context?.position?.currentTime === 'number' ? `${Math.floor(context.position.currentTime / 60)}:${Math.floor(context.position.currentTime % 60).toString().padStart(2, '0')}` : undefined;
  const add = (target: Omit<ActionTarget, 'key'>) => targets.push({ ...target, key: `${target.kind}:${target.owner}:${hashSectionContent(target.content)}:${target.locator ?? ''}` });
  if (context?.selection?.trim()) add({ ...base, kind: 'selection', content: context.selection, coverage: 'window', locator, labelKey: 'selection' });
  if (hasSource && pin?.excerpt && pin.excerpt !== context?.selection) add({ ...base, documentId: pin.documentId, title: pin.documentTitle, revision: pin.documentId === context?.documentId ? revision : undefined, owner: pin.documentId ? `document:${pin.documentId}` : owner, sourceType: 'document', kind: 'selection', content: pin.excerpt, locator: pin.locator, coverage: 'window', labelKey: 'selection' });
  const sectionText = sections.map(s => `${s.title}\n${s.content}`).join('\n\n');
  const sectionSource = { documentId: context?.documentId, sectionIds: sections.map(s => s.id), labels: sections.map(s => s.title), contentHash: hashSectionContent(sectionText), contextKey: hashSectionContent(sections.map(s => s.id).join(',')), ranges: sections.flatMap(s => s.hasAuthoritativeRange && s.startChar != null && s.endChar != null ? [{ start: s.startChar, end: s.endChar }] : []) };
  if (hasSource && sections.length) add({ ...base, sourceContext: sectionSource, kind: 'sections', sectionIds: sections.map(s => s.id), content: sectionText, coverage: 'chunks', locator: sections.map(s => s.title).join(', '), labelKey: 'sections' });
  const bounded = context?.coverage === 'window' || context?.coverage === 'chunks' || context?.source === 'pdf-window' || context?.source === 'ocr';
  if (hasSource && context.content?.trim() && bounded) add({ ...base, kind: 'passage', content: context.content, coverage: context.coverage ?? 'window', locator, labelKey: context.type === 'video' ? 'segment' : context.source === 'pdf-window' ? 'pages' : 'passage' });
  if (hasSource && (context.content?.trim() || (context.documentId && context.status !== 'unavailable'))) add({ ...base, kind: 'document', content: bounded && context.documentId && !context.documentId.startsWith('extract:') ? '' : context.content ?? '', coverage: bounded ? 'window' : context.coverage ?? 'full', labelKey: context.type === 'video' ? 'transcript' : 'document' });
  const substantive = messages.filter(m => !m.toolCalls && !m.quiz && !m.agentRun && m.role !== 'system' && !m.id.startsWith('assistant-confirm-') && m.content.trim());
  const hasAnswer = substantive.some(m => canCreateFlashcardsFromMessage(m) && m.content.length >= 40 && !/^(hello|hi[!,. ]|how can i help|welcome)/i.test(m.content));
  if (hasAnswer) add({ owner, kind: 'conversation', sourceType: 'general', content: substantive.slice(-12).map(m => `${m.role}: ${m.content}`).join('\n\n'), coverage: substantive.length > 12 ? 'window' : 'full', labelKey: 'conversation', privacyDocumentIds: [...new Set(substantive.flatMap(m => m.provenance?.documentIds ?? []))] });
  const manualTarget = input.manual?.owner === owner ? targets.find(t => t.key === input.manual?.key) : undefined;
  const mismatch = Boolean(pin?.documentId && context?.documentId && pin.documentId !== context.documentId && !context.selection?.trim() && !manualTarget);
  const fullTarget = targets.find(t => t.kind === 'document');
  return { targets, target: manualTarget ?? targets.find(t => hasSource || t.kind === 'conversation'), fullTarget, mismatch };
}
