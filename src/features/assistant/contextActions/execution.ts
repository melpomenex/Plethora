import type { AssistantContext } from '../../../components/assistant/AssistantPanel';
import type { AssistantSourceProvenance } from '../../../components/assistant/mobile/contracts';
import { getDocument, extractDocumentText } from '../../../api/documents';
import { loadDocumentQaText } from '../../documentQa/sectionContextRequest';
import { trimToTokenWindow } from '../../../utils/tokenizer';
import { resolveRequestPolicy } from '../../../api/llm/policy';
import { parseAssistantToolCalls, type ToolDefinitionLike } from '../../../lib/ai/assistant/toolCallParser';
import type { LLMProviderConfig } from '../../../stores/llmProvidersStore';
import { isolateCardActionCalls, parseQuizQuestion, type ActionEnvelope } from './model';

export class ContextActionError extends Error {
  constructor(public readonly key: string) { super(key); }
}
/** Reads only frozen identities, never a live viewer or resolver callback. */
export async function resolveActionEnvelope(action: ActionEnvelope, providerId: string, provider?: LLMProviderConfig): Promise<ActionEnvelope> {
  const target = action.target;
  let content = target.content;
  let coverage = target.coverage;
  if (!target.resolved && target.kind === 'document' && target.documentId && !target.documentId.startsWith('extract:')) {
    const record = await getDocument(target.documentId);
    if (target.revision && record?.contentHash && target.revision !== record.contentHash) throw new ContextActionError('assistant.actions.targetChanged');
    const canonical = (await loadDocumentQaText(target.documentId, { getDocument, extractDocumentText })).trim();
    if (canonical) { content = canonical; coverage = 'full'; }
  }
  if (!content.trim()) throw new ContextActionError('assistant.actions.noTarget');
  const policy = resolveRequestPolicy({ provider: providerId, providerMaxOutput: provider?.maxTokens, configuredContextOverride: provider?.contextWindowTokens });
  const trimmed = await trimToTokenWindow(content, Math.max(64, Math.floor(policy.promptBudgetTokens * 0.55)), provider?.model);
  return Object.freeze({ ...action, target: Object.freeze({ ...target, resolved: true, content: trimmed, coverage: trimmed !== content ? 'window' : coverage }) });
}
export function actionTurnContext(action?: ActionEnvelope): AssistantContext | undefined {
  if (!action) return;
  const target = action.target;
  return { type: target.sourceType, documentId: target.documentId, url: target.url,
    metadata: { title: target.title }, content: target.content,
    privacyDocumentIds: target.privacyDocumentIds ? [...target.privacyDocumentIds] : undefined,
  };
}
export function actionProvenance(action?: ActionEnvelope): AssistantSourceProvenance | undefined {
  if (!action) return;
  const target = action.target;
  return { documentIds: target.privacyDocumentIds ? [...target.privacyDocumentIds] : target.documentId && !target.documentId.startsWith('extract:') ? [target.documentId] : [], sourceId: target.documentId ?? target.url, sourceTitle: target.title };
}
export function parseSubmittedActionReply(answer: string, tools: readonly ToolDefinitionLike[], action?: ActionEnvelope) {
  const parsed = parseAssistantToolCalls(answer, tools);
  const toolCalls = action ? action.actionId === 'flashcards' ? isolateCardActionCalls(parsed.toolCalls) : [] : parsed.toolCalls;
  const quiz = action?.actionId === 'quiz' ? parseQuizQuestion(answer) : undefined;
  if (action?.actionId === 'quiz' && !quiz) throw new ContextActionError('assistant.actions.invalidQuiz');
  return { ...parsed, toolCalls, quiz };
}
