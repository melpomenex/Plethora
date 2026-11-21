import type { AssistantContext } from '../../../components/assistant/AssistantPanel';
import type { AssistantSourceProvenance } from '../../../components/assistant/mobile/contracts';
import { getDocument, extractDocumentText } from '../../../api/documents';
import { loadDocumentQaText } from '../../documentQa/sectionContextRequest';
import { resolvePdfOutlineSectionContext } from '../../documentQa/pdfOutlineContext';
import { pdfSourceTokenBudget, resolvePdfDocumentEvidence, type PdfPageSource } from '../../../utils/pdfAssistantEvidence';
import { buildSectionsSnapshot, resolveMixedSectionFocusedContext, type FocusedSectionContextResult } from '../../../utils/sectionIndex';
import { trimToTokenWindow } from '../../../utils/tokenizer';
import { resolveRequestPolicy } from '../../../api/llm/policy';
import { parseAssistantToolCalls, type ToolDefinitionLike } from '../../../lib/ai/assistant/toolCallParser';
import type { LLMProviderConfig } from '../../../stores/llmProvidersStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useDocumentOutlineStore } from '../../../stores/documentOutlineStore';
import { buildActionPrompt, isolateCardActionCalls, parseQuizQuestion, type ActionEnvelope, type ActionTarget } from './model';

export class ContextActionError extends Error {
  constructor(public readonly key: string) { super(key); }
}
type ActionSource = { pdfPageSource?: PdfPageSource; signal?: AbortSignal };

async function loadActionDocument(
  target: ActionTarget,
  { pdfPageSource, signal }: ActionSource,
  tokenBudget: number,
  model?: string,
): Promise<Pick<ActionTarget, 'content' | 'coverage'>> {
  const { documentId, revision } = target;
  if (!target.resolved && documentId && !documentId.startsWith('extract:')) {
    const record = await getDocument(documentId);
    if (revision && record?.contentHash && revision !== record.contentHash) throw new ContextActionError('assistant.actions.targetChanged');
    const canonical = (await loadDocumentQaText(documentId, { getDocument, extractDocumentText })).trim();
    if (canonical) return { content: canonical, coverage: 'full' };
    if (pdfPageSource?.documentId === documentId) {
      const evidence = await resolvePdfDocumentEvidence(pdfPageSource, tokenBudget, model, signal);
      if (evidence) return evidence;
    }
  }
  if (!target.content.trim()) throw new ContextActionError('assistant.actions.documentTextUnavailable');
  return { content: target.content, coverage: target.coverage };
}

function hasSectionBody(target: ActionTarget, content: string): boolean {
  const body = content.trim().replace(/\s+/g, ' ');
  // A previously saved action may have been marked resolved with just its title.
  const labels = Array.isArray(target.sourceContext?.labels)
    ? target.sourceContext.labels.join(' ').trim().replace(/\s+/g, ' ')
    : undefined;
  return Boolean(body && body !== labels && body !== target.locator?.trim().replace(/\s+/g, ' '));
}

async function loadActionSections(
  documentId: string,
  sectionIds: readonly string[],
  tokenBudget: number,
  { pdfPageSource, signal }: ActionSource,
): Promise<FocusedSectionContextResult | undefined> {
  const outline = useDocumentOutlineStore.getState().getOutline(documentId);
  if (pdfPageSource?.documentId === documentId && outline?.pdfOutline?.length) {
    const { flat } = buildSectionsSnapshot(documentId, '', outline);
    const selected = flat.filter(node => sectionIds.includes(node.id));
    if (selected.length === sectionIds.length) {
      const resolved = await resolvePdfOutlineSectionContext(selected, flat, pdfPageSource, tokenBudget, signal);
      if (resolved) return resolved;
      if (signal?.aborted || !pdfPageSource.isCurrent()) throw new ContextActionError('assistant.actions.sectionTextUnavailable');
    }
  }

  const canonical = await loadDocumentQaText(documentId, { getDocument, extractDocumentText });
  if (!canonical?.trim() || signal?.aborted) return;
  const { flat } = buildSectionsSnapshot(documentId, canonical, outline);
  const selected = flat.filter(node => sectionIds.includes(node.id));
  if (selected.length !== sectionIds.length) return;
  const resolved = resolveMixedSectionFocusedContext(selected, flat, canonical, {
    documentId, maxTokens: tokenBudget, includeNeighbors: false,
  });
  if (resolved.ok) return resolved;
}

/** Resolves the captured target against its document or matching PDF reader. */
export async function resolveActionEnvelope(
  action: ActionEnvelope,
  providerId: string,
  provider?: LLMProviderConfig,
  source: ActionSource = {},
): Promise<ActionEnvelope> {
  const target = action.target;
  let content = target.content;
  let coverage = target.coverage;
  let sourceContext = target.sourceContext;
  const policy = resolveRequestPolicy({
    provider: providerId,
    model: provider?.model,
    providerMaxOutput: provider?.maxTokens,
    perModelOverride: provider?.model ? provider.modelContextWindows?.[provider.model] : undefined,
    providerContextTokens: provider?.contextWindowTokens,
    globalContextTokens: useSettingsStore.getState().settings.ai.maxTokens,
    autoPreset: provider?.contextWindowPreset === 'auto',
  });
  let maxSourceTokens = Math.max(64, Math.floor(policy.promptBudgetTokens * 0.55));
  if (target.kind === 'document') {
    const budget = pdfSourceTokenBudget(policy.promptBudgetTokens, buildActionPrompt(action, 'en'), [], provider?.systemPrompt);
    const document = await loadActionDocument(target, source, budget, provider?.model);
    return Object.freeze({ ...action, target: Object.freeze({ ...target, ...document, resolved: true }) });
  }
  if (target.kind === 'sections') {
    const hasBody = hasSectionBody(target, content);
    const canReadPdf = source.pdfPageSource && source.pdfPageSource.documentId === target.documentId;
    maxSourceTokens = pdfSourceTokenBudget(policy.promptBudgetTokens, buildActionPrompt(action, 'en'), [], provider?.systemPrompt);
    if (maxSourceTokens < 64) throw new ContextActionError('assistant.actions.sectionContextBudget');
    if ((!hasBody || (!target.resolved && (canReadPdf || !target.sourceContext?.ranges?.length))) &&
      target.documentId && !target.documentId.startsWith('extract:') &&
      target.sectionIds?.some(id => !id.startsWith('selection-') && !id.startsWith('media-section-'))
    ) {
      const focused = await loadActionSections(target.documentId, target.sectionIds, maxSourceTokens, source);
      if (focused) {
        content = focused.content;
        coverage = focused.truncated ? 'window' : 'chunks';
        sourceContext = focused.source;
      }
    }
    if (!hasSectionBody(target, content)) throw new ContextActionError('assistant.actions.sectionTextUnavailable');
  }
  if (!content.trim()) throw new ContextActionError('assistant.actions.noTarget');
  const trimmed = await trimToTokenWindow(content, maxSourceTokens, provider?.model);
  return Object.freeze({ ...action, target: Object.freeze({ ...target, resolved: true, sourceContext, content: trimmed, coverage: trimmed !== content ? 'window' : coverage }) });
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
