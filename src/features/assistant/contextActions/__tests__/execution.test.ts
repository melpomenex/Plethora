import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveActionEnvelope } from '../execution';
import { captureAction, type ActionTarget } from '../model';
import { useSettingsStore } from '../../../../stores/settingsStore';

vi.mock('../../../../api/documents', () => ({
  getDocument: vi.fn().mockResolvedValue({ id: 'doc-1', contentHash: 'hash-1' }),
  extractDocumentText: vi.fn(),
}));

vi.mock('../../../documentQa/sectionContextRequest', () => ({
  loadDocumentQaText: vi.fn(),
}));

describe('resolveActionEnvelope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        ai: {
          ...state.settings.ai,
          maxTokens: 50000,
        },
      },
    }));
  });

  it('retains untruncated full canonical transcript and sets coverage full for document targets', async () => {
    const { loadDocumentQaText } = await import('../../../documentQa/sectionContextRequest');
    // Generate ~30,000 words synthetic transcript text
    const words = Array.from({ length: 30000 }, (_, i) => `word${i}`).join(' ');
    vi.mocked(loadDocumentQaText).mockResolvedValue(words);

    const target: ActionTarget = {
      key: 'doc-target',
      owner: 'document:doc-1',
      kind: 'document',
      sourceType: 'video',
      documentId: 'doc-1',
      title: 'Long 2-Hour Video',
      content: '',
      coverage: 'full',
      labelKey: 'document',
    };

    const action = captureAction('key-points', target, 'document');
    const resolved = await resolveActionEnvelope(action, 'openrouter', {
      id: 'or-1',
      provider: 'openrouter',
      name: 'OpenRouter',
      model: 'anthropic/claude-3.5-sonnet',
      enabled: true,
      temperature: 0.7,
      maxTokens: 4096,
    });

    expect(resolved.target.resolved).toBe(true);
    expect(resolved.target.coverage).toBe('full');
    expect(resolved.target.content).toBe(words);
    expect(resolved.target.content.length).toBeGreaterThan(100000);
  });

  it('incorporates globalContextTokens from useSettingsStore into policy resolution', async () => {
    useSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        ai: {
          ...state.settings.ai,
          maxTokens: 64000,
        },
      },
    }));

    const target: ActionTarget = {
      key: 'sel-target',
      owner: 'document:doc-1',
      kind: 'selection',
      sourceType: 'video',
      documentId: 'doc-1',
      title: 'Short selection',
      content: Array.from({ length: 5000 }, (_, i) => `token${i}`).join(' '),
      coverage: 'window',
      labelKey: 'selection',
    };

    const action = captureAction('explain', target, 'document');
    const resolved = await resolveActionEnvelope(action, 'openrouter', {
      id: 'or-1',
      provider: 'openrouter',
      name: 'OpenRouter',
      model: 'anthropic/claude-3.5-sonnet',
      enabled: true,
      temperature: 0.7,
      maxTokens: 4096,
    });

    expect(resolved.target.resolved).toBe(true);
    // With 64,000 global context tokens and ~5,000 words, promptBudget * 0.55 is > 15,000 tokens,
    // so 5,000 words easily fits without being head-truncated to 2,000 tokens!
    expect(resolved.target.content).toContain('token4999');
  });
});
