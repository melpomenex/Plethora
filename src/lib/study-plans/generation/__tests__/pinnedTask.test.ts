import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPinnedStudyTask } from '../pinnedTask';
import type { AITaskDefinition, AITaskResult } from '../../../ai/tasks/types';
import type { AITaskRoute } from '../../../ai/tasks/router';
import type { AIProvider } from '../../../ai/providers/types';
import type { StudyAiPreflight } from '../types';
import * as runTaskModule from '../../../ai/tasks/runTask';

vi.mock('../../../ai/tasks/runTask', () => ({
  runTask: vi.fn(),
}));

function createMockProvider(id: string): AIProvider {
  return {
    id,
    kind: 'cloud',
    name: id,
    isAvailable: async () => true,
    getCapabilities: async () => ({
      contextWindow: 8192,
      maxOutputTokens: 2048,
      structuredOutput: true,
      streaming: false,
      reasoning: false,
      vision: false,
    }),
    generate: async () => ({ text: '{}' }),
    countTokens: async (text: string) => Math.ceil(text.length / 4),
  } as unknown as AIProvider;
}

const mockPrimaryTask: AITaskDefinition<{ text: string }, { topics: string[] }> = {
  id: 'study-decompose',
  modelClass: 'reasoning',
  taskType: 'prompt',
  systemInstruction: 'Test instruction',
  outputKind: 'structured',
  timeoutMs: 60000,
  maxOutputTokens: 1800,
  buildInput: (i) => ({ text: i.text }),
  schema: { name: 'TestSchema', nativeName: 'test_schema', json: '{}' },
  validate: (val) => ({ ok: true, value: val as { topics: string[] } }),
};

const mockFallbackTwinTask: AITaskDefinition<{ text: string }, { topics: string[] }> = {
  id: 'study-decompose-full',
  modelClass: 'full',
  taskType: 'prompt',
  systemInstruction: 'Test instruction fallback',
  outputKind: 'structured',
  timeoutMs: 60000,
  maxOutputTokens: 1800,
  buildInput: (i) => ({ text: i.text }),
  schema: { name: 'TestFallbackSchema', nativeName: 'test_fallback_schema', json: '{}' },
  validate: (val) => ({ ok: true, value: val as { topics: string[] } }),
};

describe('Pinned Study Task Execution (C2-T05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const frozenPreflight: StudyAiPreflight = {
    providerId: 'pinned-provider-1',
    generationDestination: {
      providerClass: 'configured-external',
      locality: 'remote',
      keyless: false,
      billable: true,
      sendsOffDevice: true,
      requiresDisclosure: true,
      requiresCostConsent: true,
      reasonKey: 'ai.destination.cloud',
    },
    embeddingDestination: null,
    featureAllowed: true,
    documentIds: ['doc_1'],
    sourceExcerptCount: 1,
    sendsSourceOffDevice: true,
    sendsAnswersOffDevice: false,
    billable: true,
    cloudDisclosureAccepted: true,
    costConsentAccepted: true,
    maximumModelCalls: 4,
  };

  it('runs with pinned provider and merges route metadata including reasoning fallback', async () => {
    const pinnedProvider = createMockProvider('pinned-provider-1');
    const mockRoute: AITaskRoute = {
      task: mockFallbackTwinTask as unknown as AITaskDefinition<never, unknown>,
      provider: pinnedProvider,
      requestedModelClass: 'reasoning',
      servedModelClass: 'full',
      fallbackPath: 'reasoning-fallback',
    };

    const mockRunResult: AITaskResult<{ topics: string[] }> = {
      output: { topics: ['Topic 1', 'Topic 2'] },
      text: '{"topics":["Topic 1","Topic 2"]}',
      taskId: 'study-decompose-full',
      providerId: 'pinned-provider-1',
      providerKind: 'ondevice',
      requestedModelClass: 'full',
      servedModelClass: 'full',
      fallbackPath: 'none',
      validationOutcome: 'native-structured',
    };
    vi.mocked(runTaskModule.runTask).mockResolvedValue(mockRunResult as any);

    const result = await runPinnedStudyTask(
      mockPrimaryTask,
      { text: 'Source text' },
      { preflightRoute: mockRoute },
      frozenPreflight
    );

    // Verify runTask was called with options.provider explicitly set
    expect(runTaskModule.runTask).toHaveBeenCalledWith(
      mockFallbackTwinTask,
      { text: 'Source text' },
      expect.objectContaining({
        provider: pinnedProvider,
      })
    );

    // Verify metadata was merged with the primary route's requested class and fallback path
    expect(result.requestedModelClass).toBe('reasoning');
    expect(result.servedModelClass).toBe('full');
    expect(result.fallbackPath).toBe('reasoning-fallback');
    expect(result.output).toEqual({ topics: ['Topic 1', 'Topic 2'] });
  });

  it('fails immediately without contacting provider if signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runPinnedStudyTask(
        mockPrimaryTask,
        { text: 'Source text' },
        { signal: controller.signal },
        frozenPreflight
      )
    ).rejects.toMatchObject({
      code: 'cancelled',
      messageKey: 'study_generation.error.cancelled',
    });

    expect(runTaskModule.runTask).not.toHaveBeenCalled();
  });

  it('rejects with invalid_state if the resolved provider changed from frozen preflight', async () => {
    const changedProvider = createMockProvider('different-provider');
    const changedRoute: AITaskRoute = {
      task: mockPrimaryTask as unknown as AITaskDefinition<never, unknown>,
      provider: changedProvider,
      requestedModelClass: 'reasoning',
      servedModelClass: 'reasoning',
      fallbackPath: 'none',
    };

    await expect(
      runPinnedStudyTask(
        mockPrimaryTask,
        { text: 'Source text' },
        { preflightRoute: changedRoute },
        frozenPreflight // frozen with 'pinned-provider-1'
      )
    ).rejects.toMatchObject({
      code: 'invalid_state',
      messageKey: 'study_generation.error.provider_changed_on_resume',
    });

    expect(runTaskModule.runTask).not.toHaveBeenCalled();
  });
});
