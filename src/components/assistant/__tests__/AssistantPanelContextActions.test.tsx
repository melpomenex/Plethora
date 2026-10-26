import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantPanel, type AssistantContext } from '../AssistantPanel';
import { useLLMProvidersStore } from '../../../stores/llmProvidersStore';
import { useDocumentStore } from '../../../stores/documentStore';

const mocks = vi.hoisted(() => ({ turn: vi.fn(), getDoc: vi.fn(), tools: vi.fn(), callTool: vi.fn() }));
vi.mock('../../../lib/ai/assistant/orchestrator', () => ({ runAssistantTurn: mocks.turn }));
vi.mock('../../../api/documents', () => ({ getDocument: mocks.getDoc, extractDocumentText: vi.fn().mockResolvedValue(''), getDocuments: vi.fn().mockResolvedValue([]) }));
vi.mock('../../../api/mcp', () => ({ getAppMCPTools: mocks.tools, callAppMCPTool: mocks.callTool }));
vi.mock('../../../lib/tauri', async original => ({ ...await original<typeof import('../../../lib/tauri')>(), isTauri: () => false, isNativeMobile: () => false, invokeCommand: vi.fn().mockResolvedValue([]) }));
vi.mock('../../../hooks/useComposerDictation', () => ({ useComposerDictation: () => ({ phase: 'idle', cancel: vi.fn(), onEdit: vi.fn(), disabled: true }) }));
vi.mock('../mobile/MobileAssistantCommands', () => ({ useAssistantCommandMatches: () => [], MobileAssistantCommands: () => null }));
vi.mock('../../../utils/imageCompression', () => ({ readFileAsDataUrl: async () => 'data:image/png;base64,draft', compressImage: async (s: string) => s }));
vi.mock('../../../utils/tokenizer', () => ({ countTokens: async (s: string) => s.length / 4, trimToTokenWindow: async (s: string, max: number) => s.slice(0, max * 4) }));

const source: AssistantContext = { type: 'document', documentId: 'a', content: 'Captured passage evidence', coverage: 'window', selection: 'Selected text only', metadata: { title: 'Source A' } };
const props = { context: source, conversationKey: 'mobile:global', mobilePresentation: { visible: true }, fillContainer: true, appendContextMessages: false };
const seed = (messages: unknown[], input = '') => localStorage.setItem('assistant-panel-conversations-v1', JSON.stringify({ 'mobile:global': { messages, input, updatedAt: 1 } }));
const menu = () => fireEvent.click(screen.getByRole('button', { name: 'Add to your message' }));
const action = (name: string) => screen.getAllByRole('button', { name: new RegExp(`^${name} ·`) }).at(-1)!;
const pending = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); Element.prototype.scrollTo = vi.fn();
  useLLMProvidersStore.setState({ providers: [{ id: 'provider', provider: 'openai', name: 'OpenAI', enabled: true, model: 'gpt-4o-mini', apiKey: 'test', maxTokens: 1024, temperature: 0.2 }] });
  useDocumentStore.setState({ documents: [{ id: 'a', title: 'Source A', content: 'Canonical complete source', contentHash: 'v1' } as never], currentDocument: null });
  mocks.getDoc.mockResolvedValue({ id: 'a', title: 'Source A', content: 'Canonical complete source', contentHash: 'v1' });
  mocks.tools.mockResolvedValue([{ name: 'create_qa_card', description: 'Card', inputSchema: {} }, { name: 'create_extract', inputSchema: {} }, { name: 'batch_create_cards', inputSchema: {} }]);
  mocks.callTool.mockResolvedValue({ isError: false, content: [{ type: 'text', text: '{"id":"card-1"}' }] });
  mocks.turn.mockResolvedValue({ rawContent: 'A useful response explaining only the selected material.' });
});

describe('contextual action integration', () => {
  it('renders/opens without inference, preserves draft text, cursor and image attachments, and ignores ambient resolver', async () => {
    const resolver = vi.fn().mockResolvedValue({ content: 'Wrong whole document', status: 'ready' });
    seed([{ id: 'user-old', role: 'user', content: 'Earlier', timestamp: 1 }], 'Unsent draft');
    render(<AssistantPanel {...props} context={{ ...source, resolveForPrompt: resolver }} />);
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    input.setSelectionRange(3, 3);
    const file = new File(['image'], 'draft.png', { type: 'image/png' });
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [file] } });
    await screen.findByRole('img', { name: 'draft.png' });
    expect(mocks.turn).not.toHaveBeenCalled(); menu(); expect(mocks.turn).not.toHaveBeenCalled();
    fireEvent.click(action('Explain'));
    await waitFor(() => expect(mocks.turn).toHaveBeenCalledOnce());
    const request = mocks.turn.mock.calls[0][0];
    expect(request.action.target).toMatchObject({ documentId: 'a', content: 'Selected text only', coverage: 'window' });
    expect(request.history).toEqual([]); expect(request.userImages).toBeUndefined();
    expect(resolver).not.toHaveBeenCalled(); expect(input.value).toBe('Unsent draft'); expect(input.selectionStart).toBe(3);
    expect(screen.getByRole('img', { name: 'draft.png' })).toBeVisible();
  });
  it('locks synchronously before full-source loading and uses canonical full text for outline', async () => {
    const doc = pending<unknown>(); mocks.getDoc.mockReturnValue(doc.promise);
    render(<AssistantPanel {...props} />); menu();
    const outline = action('Outline document'); fireEvent.click(outline); fireEvent.click(outline);
    expect(mocks.turn).not.toHaveBeenCalled();
    await act(async () => doc.resolve({ id: 'a', title: 'Source A', content: 'Entire canonical book', contentHash: 'v1' }));
    await waitFor(() => expect(mocks.turn).toHaveBeenCalledOnce());
    expect(mocks.turn.mock.calls[0][0].action.target).toMatchObject({ kind: 'document', content: 'Entire canonical book', coverage: 'full' });
  });
  it('stops async loading, discards late responses and permits an exact-target retry after source switch', async () => {
    const response = pending<{ rawContent: string }>(); mocks.turn.mockReturnValueOnce(response.promise);
    const { rerender } = render(<AssistantPanel {...props} />); menu(); fireEvent.click(action('Explain'));
    await waitFor(() => expect(mocks.turn).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    rerender(<AssistantPanel {...props} context={{ type: 'document', documentId: 'b', content: 'New source B', metadata: { title: 'Source B' } }} />);
    await act(async () => response.resolve({ rawContent: 'Late response must be discarded' }));
    expect(screen.queryByText('Late response must be discarded')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mocks.turn).toHaveBeenCalledTimes(2));
    expect(mocks.turn.mock.calls[1][0].action.target.documentId).toBe('a');
  });
  it('requires language, cancels without submit and rejects a source change during translation', async () => {
    const { rerender } = render(<AssistantPanel {...props} />); menu(); fireEvent.click(action('Translate'));
    expect(screen.getByRole('combobox', { name: 'Translate into' })).toHaveValue('en');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(mocks.turn).not.toHaveBeenCalled();
    fireEvent.click(action('Translate'));
    rerender(<AssistantPanel {...props} context={{ ...source, documentId: 'b', selection: 'New selected text' }} />);
    expect(screen.getByRole('button', { name: 'Translate' })).toBeDisabled();
    expect(mocks.turn).not.toHaveBeenCalled();
  });
  it('runs selected translation and preserves explicit language in the envelope', async () => {
    render(<AssistantPanel {...props} />); menu(); fireEvent.click(action('Translate'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Translate into' }), { target: { value: 'ja' } });
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    await waitFor(() => expect(mocks.turn).toHaveBeenCalledOnce());
    expect(mocks.turn.mock.calls[0][0].action.parameters.language).toBe('ja');
  });
  it('conceals quiz answer/hint, reveals locally, generates Next on the same target and restores without inference', async () => {
    mocks.turn.mockResolvedValue({ rawContent: '{"question":"What powers cells?","answer":"Secret ATP answer","hint":"Secret energy hint"}' });
    const { unmount } = render(<AssistantPanel {...props} />); menu(); fireEvent.click(action('Quiz me'));
    await screen.findByText('What powers cells?');
    expect(screen.queryByText('Secret ATP answer')).toBeNull(); expect(document.body.textContent).not.toContain('Secret energy hint');
    fireEvent.click(screen.getByRole('button', { name: 'Hint' })); expect(screen.getByText('Secret energy hint')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' })); expect(screen.getByText('Secret ATP answer')).toBeVisible();
    expect(mocks.turn).toHaveBeenCalledOnce();
    unmount(); render(<AssistantPanel {...props} />);
    expect(screen.getByText('Secret ATP answer')).toBeVisible(); expect(mocks.turn).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
    await waitFor(() => expect(mocks.turn).toHaveBeenCalledTimes(2));
    expect(mocks.turn.mock.calls[1][0].action.parameters.excludedQuestions).toEqual(['What powers cells?']);
  });
  it('handles invalid quiz content without exposing the generated answer and retires controls after switch', async () => {
    mocks.turn.mockResolvedValueOnce({ rawContent: 'The answer is exposed without a question' });
    const { rerender } = render(<AssistantPanel {...props} />); menu(); fireEvent.click(action('Quiz me'));
    await screen.findByRole('button', { name: 'Retry' });
    expect(document.body.textContent).not.toContain('The answer is exposed');
    mocks.turn.mockResolvedValueOnce({ rawContent: '{"question":"Question?","answer":"Answer"}' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await screen.findByText('Question?');
    rerender(<AssistantPanel {...props} context={{ ...source, documentId: 'b', selection: 'B' }} />);
    expect(screen.getByRole('button', { name: 'Restart quiz on current source' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Show answer' })).toBeNull();
    menu(); fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(screen.queryByText('Question?')).toBeNull();
  });
  it('cannot run mutations for a read action even if the provider returns write tools', async () => {
    mocks.turn.mockResolvedValue({ rawContent: '```tool_calls\n[{"name":"create_qa_card","arguments":{"question":"Q","answer":"A"}}]\n```' });
    render(<AssistantPanel {...props} />); menu(); fireEvent.click(action('Summarize'));
    await waitFor(() => expect(mocks.turn).toHaveBeenCalledOnce());
    expect(mocks.turn.mock.calls[0][0].tools).toEqual([]); expect(mocks.callTool).not.toHaveBeenCalled();
  });
  it('keeps flashcard source/deck captured and recovers only the failed card without inference replay', async () => {
    const response = pending<{ rawContent: string }>(); mocks.turn.mockReturnValueOnce(response.promise);
    mocks.callTool.mockResolvedValueOnce({ isError: false, content: [{ type: 'text', text: '{"id":"saved"}' }] }).mockRejectedValueOnce(new Error('Write failed')).mockResolvedValueOnce({ isError: false, content: [{ type: 'text', text: '{"id":"retry-saved"}' }] });
    const { rerender } = render(<AssistantPanel {...props} />); menu(); await waitFor(() => expect(action('Make flashcards')).toBeEnabled()); fireEvent.click(action('Make flashcards'));
    await waitFor(() => expect(mocks.turn).toHaveBeenCalledOnce());
    rerender(<AssistantPanel {...props} context={{ ...source, documentId: 'b', selection: 'Other source', metadata: { title: 'Source B' } }} />);
    await act(async () => response.resolve({ rawContent: '```tool_calls\n[{"name":"batch_create_cards","arguments":{"cards":[{"type":"qa","question":"Saved Q","answer":"A"},{"type":"qa","question":"Failed Q","answer":"A"}]}}]\n```' }));
    await waitFor(() => expect(mocks.callTool).toHaveBeenCalledTimes(2));
    expect(mocks.callTool.mock.calls.every(call => call[1].document_id === 'a')).toBe(true);
    const retry = await screen.findByRole('button', { name: /Retry/i }); fireEvent.click(retry);
    await waitFor(() => expect(mocks.callTool).toHaveBeenCalledTimes(3));
    expect(mocks.callTool.mock.calls[2][1].question).toBe('Failed Q');
    expect(mocks.callTool.mock.calls[2][1].document_id).toBe('a'); expect(mocks.turn).toHaveBeenCalledOnce();
  });
  it('shows setup recovery with no request when provider is missing', async () => {
    useLLMProvidersStore.setState({ providers: [] });
    render(<AssistantPanel {...props} />); menu();
    expect(action('Explain')).toBeDisabled(); expect(screen.getByRole('button', { name: /Set up AI in Settings/ })).toBeVisible();
    expect(mocks.turn).not.toHaveBeenCalled();
  });
  it('releases the synchronous lock after background cancellation', async () => {
    const response = pending<{ rawContent: string }>(); mocks.turn.mockReturnValueOnce(response.promise);
    render(<AssistantPanel {...props} />); menu(); fireEvent.click(action('Explain'));
    await waitFor(() => expect(mocks.turn).toHaveBeenCalledOnce());
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    hidden.mockReturnValue(false); fireEvent(document, new Event('visibilitychange'));
    menu(); fireEvent.click(action('Explain'));
    await waitFor(() => expect(mocks.turn).toHaveBeenCalledTimes(2));
    await act(async () => response.resolve({ rawContent: 'Discard background completion' }));
    expect(screen.queryByText('Discard background completion')).toBeNull(); hidden.mockRestore();
  });
  it('loads legacy conversations without action metadata', () => {
    seed([{ id: 'old', role: 'assistant', content: 'Legacy response', timestamp: 1 }]); render(<AssistantPanel {...props} />);
    expect(screen.getByText('Legacy response')).toBeVisible(); expect(mocks.turn).not.toHaveBeenCalled();
  });
});

describe('target availability and coverage', () => {
  it.each([false, true])('captures a source on either presentation (mobile=%s)', async mobile => {
    render(<AssistantPanel {...props} mobilePresentation={mobile ? props.mobilePresentation : undefined} />);
    if (mobile) menu(); else fireEvent.click(screen.getByRole('button', { name: /^(More|Actions)$/ }));
    fireEvent.click(action('Explain'));
    await waitFor(() => expect(mocks.turn).toHaveBeenCalledOnce());
    expect(mocks.turn.mock.calls[0][0].action.target.content).toBe('Selected text only');
  });
  it('discloses whole-source overflow and does not silently label the excerpt full', async () => {
    mocks.getDoc.mockResolvedValue({ id: 'a', title: 'A', content: 'Long canonical source. '.repeat(10000), contentHash: 'v1' });
    render(<AssistantPanel {...props} />); menu(); fireEvent.click(action('Outline document'));
    await waitFor(() => expect(mocks.turn).toHaveBeenCalledOnce());
    expect(mocks.turn.mock.calls[0][0].action.target.coverage).toBe('window');
    expect(mocks.turn.mock.calls[0][0].sourceCoverage).toBe('window');
  });
  it('requires a visible choice for a pin from another source before any action', async () => {
    const { rerender } = render(<AssistantPanel {...props} />);
    rerender(<AssistantPanel {...props} context={{ type: 'document', documentId: 'b', content: 'New source body', metadata: { title: 'Source B' } }} />);
    menu(); expect(action('Explain')).toBeDisabled();
    const select = screen.getByRole('combobox', { name: 'Use' });
    const oldSelection = withinSelect(select, 'Source A');
    fireEvent.change(select, { target: { value: oldSelection } });
    fireEvent.click(action('Explain'));
    await waitFor(() => expect(mocks.turn).toHaveBeenCalledOnce());
    expect(mocks.turn.mock.calls[0][0].action.target).toMatchObject({ documentId: 'a', content: 'Selected text only' });
  });
});
function withinSelect(select: HTMLElement, label: string) {
  return Array.from(select.querySelectorAll('option')).find(o => o.textContent?.includes(label))!.value;
}
