import { describe, expect, it, vi } from 'vitest';
import { runAssistantTurn } from '../orchestrator';
import { captureAction, type ActionId, type ActionTarget } from '../../../../features/assistant/contextActions/model';
const target: ActionTarget = { key: 'passage-a', owner: 'document:a', kind: 'passage', sourceType: 'document', documentId: 'a', title: 'A', content: 'Only the captured paragraph.', coverage: 'window', labelKey: 'passage', locator: 'p. 42' };

describe('authoritative context action envelopes', () => {
  it.each(['summarize','explain','quiz','flashcards'] as ActionId[])('keeps %s on the named source in Library scope without retrieval or mutation widening', async id => {
    const chatExecutor = vi.fn().mockResolvedValue({ content: 'A grounded answer.\n```tool_calls\n[{"name":"create_extract","arguments":{"content":"wrong"}},{"name":"create_qa_card","arguments":{"question":"Q","answer":"A"}}]\n```' });
    const libraryExecutor = vi.fn(); const executeTool = vi.fn();
    const result = await runAssistantTurn({ action: captureAction(id, target, 'library'), scope: 'chat',
      userQuestion: 'Summarize this document and create flashcards', sourceId: 'b', sourceTitle: 'Wrong source', sourceContent: 'Wrong content', selectionExcerpt: 'Wrong pin',
      history: [{ role: 'assistant', content: 'Unrelated previous answer' }], provider: 'openai', model: 'gpt-4o-mini',
      tools: [{ name: 'create_extract' }, { name: 'create_qa_card' }], libraryExecutor, chatExecutor, executeTool,
    });
    expect(libraryExecutor).not.toHaveBeenCalled();
    const args = chatExecutor.mock.calls[0][0];
    expect(args.context).toMatchObject({ documentId: 'a', scope: 'library' });
    expect(args.context.content).toContain('Only the captured paragraph');
    expect(args.context.content).not.toMatch(/Wrong|Unrelated/);
    expect(args.messages[0].content).toContain('SOURCE COVERAGE LIMIT');
    expect(args.messages).toHaveLength(2);
    expect(executeTool).toHaveBeenCalledTimes(id === 'flashcards' ? 1 : 0);
    expect(result.toolCalls.every(call => call.name === 'create_qa_card')).toBe(true);
  });
  it('an explicit whole source action ignores ambient selection and preserves partial coverage disclosure', async () => {
    const chatExecutor = vi.fn().mockResolvedValue({ content: 'Partial outline.' });
    const result = await runAssistantTurn({ action: captureAction('outline-document', { ...target, kind: 'document' }, 'document'), scope: 'document', sourceContent: 'Wrong selection', selectionExcerpt: 'Wrong selection', userQuestion: 'Outline document', provider: 'openai', chatExecutor });
    expect(chatExecutor.mock.calls[0][0].context.content).not.toContain('Wrong selection');
    expect(result.sourceCoverage).toBe('window');
    expect(chatExecutor.mock.calls[0][0].messages[0].content).toContain('bounded window');
  });
  it('conversation actions do not inject a detached source or its selection', async () => {
    const chatExecutor = vi.fn().mockResolvedValue({ content: 'Recap' });
    await runAssistantTurn({ action: captureAction('summarize', { ...target, kind: 'conversation', documentId: undefined, sourceType: 'general', content: 'Frozen discussion' }, 'chat'), scope: 'document', sourceId: 'detached', sourceContent: 'Detached book', selectionExcerpt: 'Old pin', userQuestion: 'Recap', provider: 'openai', chatExecutor });
    const args = chatExecutor.mock.calls[0][0];
    expect(args.context.content).toContain('Frozen discussion');
    expect(args.context.content).not.toMatch(/Detached book|Old pin/);
    expect(args.context.documentId).toBeUndefined();
  });
});
