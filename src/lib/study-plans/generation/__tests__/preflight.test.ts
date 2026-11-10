import { describe, it, expect } from 'vitest';
import {
  performStudyAiPreflight,
  validatePreflightUnchanged,
  classifyRouteDestination,
} from '../preflight';
import type { AITaskRoute } from '../../../ai/tasks/router';
import type { AITaskDefinition } from '../../../ai/tasks/types';
import type { AIProvider } from '../../../ai/providers/types';

function createMockProvider(overrides: Partial<AIProvider> & { baseUrl?: string | null; hasApiKey?: boolean; name?: string } = {}): AIProvider {
  return {
    id: overrides.id || 'test-provider',
    kind: overrides.kind || 'cloud',
    name: overrides.name || 'Test Provider',
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
    ...overrides,
  } as unknown as AIProvider;
}

const dummyTask: AITaskDefinition<never, unknown> = {
  id: 'study-decompose-test',
  modelClass: 'reasoning',
  taskType: 'prompt',
  systemInstruction: 'Test instruction',
  outputKind: 'structured',
  timeoutMs: 60000,
  maxOutputTokens: 1800,
  buildInput: () => ({ text: 'test' }),
  schema: { name: 'TestSchema', nativeName: 'test_schema', json: '{}' },
  validate: () => ({ ok: true, value: {} }),
};

describe('Study AI Preflight & Privacy Gating (C2-T05)', () => {
  it('approves native on-device provider without disclosure or cost consent', async () => {
    const provider = createMockProvider({ id: 'ondevice', kind: 'ondevice' });
    const route: AITaskRoute = {
      task: dummyTask,
      provider,
      requestedModelClass: 'reasoning',
      servedModelClass: 'reasoning',
      fallbackPath: 'none',
    };

    const classification = classifyRouteDestination(route);
    expect(classification.locality).toBe('device');
    expect(classification.sendsOffDevice).toBe(false);

    const result = await performStudyAiPreflight({
      primaryTask: dummyTask,
      documents: [{ id: 'doc_1', title: 'Doc 1' }],
      sourceExcerptCount: 5,
      plannedModelSteps: 2,
      routeOverride: route,
    });

    expect(result.preflight.featureAllowed).toBe(true);
    expect(result.preflight.sendsSourceOffDevice).toBe(false);
    expect(result.preflight.billable).toBe(false);
    expect(result.preflight.maximumModelCalls).toBe(4);
    expect(result.preflight.providerId).toBe('ondevice');
  });

  it('approves loopback Ollama destination without cloud disclosure or cost consent', async () => {
    const provider = createMockProvider({
      id: 'ollama',
      kind: 'cloud',
      baseUrl: 'http://localhost:11434',
    });
    const route: AITaskRoute = {
      task: dummyTask,
      provider,
      requestedModelClass: 'reasoning',
      servedModelClass: 'reasoning',
      fallbackPath: 'none',
    };

    const result = await performStudyAiPreflight({
      primaryTask: dummyTask,
      documents: [{ id: 'doc_1', title: 'Local Paper' }],
      sourceExcerptCount: 3,
      routeOverride: route,
    });

    expect(result.preflight.sendsSourceOffDevice).toBe(false);
    expect(result.preflight.billable).toBe(false);
  });

  it('rejects remote Ollama / LAN box when cloud disclosure is not accepted', async () => {
    const provider = createMockProvider({
      id: 'ollama',
      kind: 'cloud',
      baseUrl: 'http://ollama-box.lan:11434',
    });
    const route: AITaskRoute = {
      task: dummyTask,
      provider,
      requestedModelClass: 'reasoning',
      servedModelClass: 'reasoning',
      fallbackPath: 'none',
    };

    await expect(
      performStudyAiPreflight({
        primaryTask: dummyTask,
        documents: [{ id: 'doc_1', title: 'Local Paper' }],
        sourceExcerptCount: 3,
        routeOverride: route,
        cloudDisclosureAccepted: false,
      })
    ).rejects.toMatchObject({
      code: 'privacy_denied',
      messageKey: 'study_plan.error.cloud_disclosure_required',
    });
  });

  it('rejects billable cloud provider when cost consent is not accepted', async () => {
    const provider = createMockProvider({
      id: 'openai',
      kind: 'cloud',
      hasApiKey: true,
    });
    const route: AITaskRoute = {
      task: dummyTask,
      provider,
      requestedModelClass: 'reasoning',
      servedModelClass: 'reasoning',
      fallbackPath: 'none',
    };

    await expect(
      performStudyAiPreflight({
        primaryTask: dummyTask,
        documents: [{ id: 'doc_1', title: 'Paper' }],
        sourceExcerptCount: 3,
        routeOverride: route,
        cloudDisclosureAccepted: true,
        costConsentAccepted: false,
      })
    ).rejects.toMatchObject({
      code: 'cost_consent_required',
      messageKey: 'study_plan.error.cost_consent_required',
    });
  });

  it('rejects when any document is AI-excluded', async () => {
    const provider = createMockProvider({ id: 'ondevice', kind: 'ondevice' });
    const route: AITaskRoute = {
      task: dummyTask,
      provider,
      requestedModelClass: 'reasoning',
      servedModelClass: 'reasoning',
      fallbackPath: 'none',
    };

    await expect(
      performStudyAiPreflight({
        primaryTask: dummyTask,
        documents: [
          { id: 'doc_1', title: 'Allowed' },
          { id: 'doc_2', title: 'Secret Doc', isAiExcluded: true },
        ],
        sourceExcerptCount: 3,
        routeOverride: route,
      })
    ).rejects.toMatchObject({
      code: 'source_ai_excluded',
      messageKey: 'study_plan.error.source_ai_excluded',
    });
  });

  it('rejects when document is local-only but generation sends off-device', async () => {
    const provider = createMockProvider({
      id: 'openai',
      kind: 'cloud',
      hasApiKey: true,
    });
    const route: AITaskRoute = {
      task: dummyTask,
      provider,
      requestedModelClass: 'reasoning',
      servedModelClass: 'reasoning',
      fallbackPath: 'none',
    };

    await expect(
      performStudyAiPreflight({
        primaryTask: dummyTask,
        documents: [{ id: 'doc_1', title: 'Private Notes', isLocalOnly: true }],
        sourceExcerptCount: 3,
        routeOverride: route,
        cloudDisclosureAccepted: true,
        costConsentAccepted: true,
      })
    ).rejects.toMatchObject({
      code: 'privacy_denied',
      messageKey: 'study_plan.error.local_only_generation_required',
    });
  });

  it('rejects when document is local-only but embedding sends off-device', async () => {
    const provider = createMockProvider({ id: 'ondevice', kind: 'ondevice' });
    const route: AITaskRoute = {
      task: dummyTask,
      provider,
      requestedModelClass: 'reasoning',
      servedModelClass: 'reasoning',
      fallbackPath: 'none',
    };

    await expect(
      performStudyAiPreflight({
        primaryTask: dummyTask,
        documents: [{ id: 'doc_1', title: 'Private Notes', isLocalOnly: true }],
        sourceExcerptCount: 3,
        routeOverride: route,
        embeddingSettings: {
          provider: 'openai',
          hasApiKey: true,
        },
      })
    ).rejects.toMatchObject({
      code: 'privacy_denied',
      messageKey: 'study_plan.error.local_only_embedding_required',
    });
  });

  it('rejects when strict local mode is active and any destination sends off-device', async () => {
    const provider = createMockProvider({
      id: 'openai',
      kind: 'cloud',
      hasApiKey: true,
    });
    const route: AITaskRoute = {
      task: dummyTask,
      provider,
      requestedModelClass: 'reasoning',
      servedModelClass: 'reasoning',
      fallbackPath: 'none',
    };

    await expect(
      performStudyAiPreflight({
        primaryTask: dummyTask,
        documents: [{ id: 'doc_1', title: 'Normal Doc' }],
        sourceExcerptCount: 3,
        strictLocalOnly: true,
        routeOverride: route,
        cloudDisclosureAccepted: true,
        costConsentAccepted: true,
      })
    ).rejects.toMatchObject({
      code: 'privacy_denied',
      messageKey: 'study_plan.error.strict_local_required',
    });
  });

  it('rejects with provider_unavailable if no provider can be resolved', async () => {
    await expect(
      performStudyAiPreflight({
        primaryTask: dummyTask,
        documents: [{ id: 'doc_1', title: 'Doc' }],
        sourceExcerptCount: 1,
        resolveRouteFn: async () => null,
      })
    ).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
  });

  it('validates preflight unchanged and detects provider changes on resume', () => {
    const frozenPreflight = {
      providerId: 'ollama',
      generationDestination: { sendsOffDevice: false } as any,
      embeddingDestination: null,
      featureAllowed: true,
      documentIds: ['doc_1'],
      sourceExcerptCount: 1,
      sendsSourceOffDevice: false,
      sendsAnswersOffDevice: false,
      billable: false,
      cloudDisclosureAccepted: false,
      costConsentAccepted: false,
      maximumModelCalls: 4,
    };

    const matchingRoute: AITaskRoute = {
      task: dummyTask,
      provider: createMockProvider({ id: 'ollama' }),
      requestedModelClass: 'reasoning',
      servedModelClass: 'reasoning',
      fallbackPath: 'none',
    };
    expect(() => validatePreflightUnchanged(frozenPreflight, matchingRoute)).not.toThrow();

    const changedRoute: AITaskRoute = {
      task: dummyTask,
      provider: createMockProvider({ id: 'openai' }),
      requestedModelClass: 'reasoning',
      servedModelClass: 'reasoning',
      fallbackPath: 'none',
    };
    expect(() => validatePreflightUnchanged(frozenPreflight, changedRoute)).toThrowError(
      expect.objectContaining({
        code: 'invalid_state',
        messageKey: 'study_generation.error.provider_changed_on_resume',
      })
    );
  });
});
