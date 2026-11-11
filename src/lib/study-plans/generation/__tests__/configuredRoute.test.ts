import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatWithLLM } from '../../../../api/llm';
import { useLLMProvidersStore, type LLMProviderConfig } from '../../../../stores/llmProvidersStore';
import { curriculumDecomposeTask } from '../../../ai/tasks/definitions/curriculumTasks';
import { performStudyAiPreflight, validatePreflightUnchanged } from '../preflight';
import { runPinnedStudyTask } from '../pinnedTask';

vi.mock('../../../../api/llm', async (original) => ({
  ...await original<typeof import('../../../../api/llm')>(),
  chatWithLLM: vi.fn(),
}));

const mercury: LLMProviderConfig = {
  id: 'chosen',
  provider: 'openrouter',
  name: 'Configured model',
  apiKey: 'test-only',
  model: 'test-vendor/diffusion-v3',
  enabled: true,
  temperature: 0.2,
  maxTokens: 2000,
  modelPricing: {
    'test-vendor/diffusion-v3': {
      id: 'test-vendor/diffusion-v3',
      name: 'Diffusion V3',
      reasoning: true,
      pricing: { prompt: 0.001, completion: 0.002, request: 0.01 },
    },
  },
};
const originalProviders = useLLMProvidersStore.getState().providers;
afterEach(() => {
  useLLMProvidersStore.setState({ providers: originalProviders });
  vi.clearAllMocks();
});

const request = {
  primaryTask: curriculumDecomposeTask,
  documents: [{ id: 'one' }],
  sourceExcerptCount: 1,
  selectedConfigId: mercury.id,
};

describe('configured Study Plans routes', () => {
  it('inspects without traffic, then sends the approved exact model to the shared transport', async () => {
    const other = { ...mercury, id: 'default', model: 'test-vendor/unselected' };
    useLLMProvidersStore.setState({ providers: [other, mercury] });

    const disclosed = await performStudyAiPreflight({
      ...request, inspectOnly: true, estimateTokens: { input: 1000, output: 1000 },
    });
    expect(disclosed.preflight).toMatchObject({
      featureAllowed: false,
      generationDestination: { locality: 'remote' },
      model: { provider: 'OpenRouter', id: mercury.model, reasoningMetadata: true },
      reasoningFallback: false,
    });
    expect(disclosed.preflight.estimate?.costUsd).toBeCloseTo(0.023);
    expect(JSON.stringify(disclosed.preflight)).not.toContain(mercury.apiKey);
    expect(chatWithLLM).not.toHaveBeenCalled();
    await expect(performStudyAiPreflight({ ...request, cloudDisclosureAccepted: true }))
      .rejects.toMatchObject({ code: 'cost_consent_required' });

    const authorized = await performStudyAiPreflight({
      ...request, cloudDisclosureAccepted: true, costConsentAccepted: true,
    });
    const topics = ['Definition', 'Properties', 'Applications'].map((title, index) => ({
      handle: `t_${index}`, title, summary: title, conceptName: title,
      learningObjectives: [`Explain ${title}`], materialSupport: 'grounded', sourceHandles: ['src_h0'],
      whyHere: 'Supported by the reading',
    }));
    vi.mocked(chatWithLLM).mockResolvedValue({ content: JSON.stringify({ schemaVersion: 1, topics }) });

    // Once execution is authorized and pinned, changing Settings cannot reroute it.
    useLLMProvidersStore.setState({ providers: [other, { ...mercury, model: 'test-vendor/changed' }] });
    const result = await runPinnedStudyTask(curriculumDecomposeTask, {
      jobId: 'job-fixture', stepKey: 'decompose:0000', goal: 'Study the reference',
      depth: 'survey', sources: [{ handle: 'src_h0', title: 'Reference', excerpt: 'A verified passage' }],
    }, { preflightRoute: authorized.route }, authorized.preflight);
    expect(result.output.topics).toHaveLength(3);
    expect(chatWithLLM).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      model: mercury.model,
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      pinEndpoint: true,
    }));
    await expect(runPinnedStudyTask(curriculumDecomposeTask, {
      jobId: 'job-fixture', stepKey: 'decompose:0000', goal: 'Study the reference',
      depth: 'survey', sources: [],
    }, {}, authorized.preflight)).rejects.toMatchObject({ code: 'invalid_state' });
    expect(chatWithLLM).toHaveBeenCalledTimes(1);
  });

  it('revalidates the endpoint even when the configuration and model IDs match', async () => {
    useLLMProvidersStore.setState({ providers: [mercury] });
    const disclosed = await performStudyAiPreflight({ ...request, inspectOnly: true });
    useLLMProvidersStore.setState({ providers: [{ ...mercury, baseUrl: 'https://gateway.example/v1' }] });
    const fresh = await performStudyAiPreflight({ ...request, inspectOnly: true });
    expect(() => validatePreflightUnchanged(disclosed.preflight, fresh.route)).toThrow();
    expect(chatWithLLM).not.toHaveBeenCalled();
  });

  it.each([
    ['ollama', 'http://localhost:11434', 'loopback', false],
    ['ollama', 'http://inference.lan:11434', 'lan', true],
    ['ollama', 'https://inference.example', 'remote', true],
    ['openai', 'http://localhost:8000/v1', 'loopback', false],
  ] as const)('classifies configured %s %s', async (provider, baseUrl, locality, offDevice) => {
    useLLMProvidersStore.setState({ providers: [{ ...mercury, provider, baseUrl, apiKey: '', modelPricing: undefined }] });
    const { preflight } = await performStudyAiPreflight({ ...request, inspectOnly: true });
    expect(preflight.generationDestination).toMatchObject({ locality, sendsOffDevice: offDevice });
  });

  it('refuses invalid endpoint URLs and model-routing aliases', async () => {
    useLLMProvidersStore.setState({ providers: [{ ...mercury, baseUrl: 'file:///tmp/local' }] });
    await expect(performStudyAiPreflight({ ...request, inspectOnly: true }))
      .rejects.toMatchObject({ messageKey: 'study_generation.error.invalid_endpoint' });
    useLLMProvidersStore.setState({ providers: [{ ...mercury, model: 'openrouter/auto' }] });
    await expect(performStudyAiPreflight({ ...request, inspectOnly: true }))
      .rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(chatWithLLM).not.toHaveBeenCalled();
  });
});
