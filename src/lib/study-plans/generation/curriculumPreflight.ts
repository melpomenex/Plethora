import { resolveEmbeddingConfigForRag } from '../../../components/assistant/ragConfig';
import { getAIIndexStatus, type EmbeddingConfig } from '../../../api/ai-learning';
import { StudyApiError } from '../../../api/study-plans';
import { resolveStudySourceScope } from '../../../api/study-sources';
import type { StudySourceScopeV1 } from '../../../types/studySource';
import {
  curriculumDecomposeTask,
  CURRICULUM_DECOMPOSE_MAX_TOKENS,
  CURRICULUM_PREREQUISITE_MAX_TOKENS,
} from '../../ai/tasks/definitions/curriculumTasks';
import { EVIDENCE_LIMITS } from './planEvidence';
import { performStudyAiPreflight, validatePreflightUnchanged } from './preflight';
import { sha256 } from './requestHash';
import type { StudyAiPreflight } from './types';

const handlesPerBatch = Math.min(
  EVIDENCE_LIMITS.MAX_HANDLES_PER_BATCH,
  Math.floor(EVIDENCE_LIMITS.MAX_CHARS_PER_BATCH / EVIDENCE_LIMITS.MAX_EXCERPT_CHARS),
);
const maximumBatches = Math.ceil(EVIDENCE_LIMITS.MAX_GLOBAL_HITS / handlesPerBatch);

async function resolveStudyEmbeddingConfig(): Promise<{
  config?: EmbeddingConfig;
  description: NonNullable<StudyAiPreflight['embedding']>;
}> {
  const config = await resolveEmbeddingConfigForRag();
  const maximumQueries = 1 + EVIDENCE_LIMITS.MAX_CONCEPT_SEEDS;
  if (config?.provider === 'Ollama' && config.ollamaModel?.trim() && config.ollamaBaseUrl?.trim()) {
    let endpoint: URL;
    try {
      endpoint = new URL(config.ollamaBaseUrl);
      if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password ||
          endpoint.search || endpoint.hash) throw new Error('Invalid endpoint');
    } catch {
      throw new StudyApiError({ code: 'invalid_input', messageKey: 'study_generation.error.invalid_endpoint', retryable: false });
    }
    const baseUrl = endpoint.href.replace(/\/$/, '');
    const model = config.ollamaModel.trim();
    return {
      config: { provider: 'Ollama', ollamaBaseUrl: baseUrl, ollamaModel: model },
      description: { provider: 'Ollama', model, endpointHash: sha256(baseUrl), maximumQueries },
    };
  }
  if (config?.provider === 'OpenAI' && config.openaiApiKey?.trim()) {
    const model = config.openaiModel?.trim() || 'text-embedding-3-small';
    return {
      config: { provider: 'OpenAI', openaiApiKey: config.openaiApiKey, openaiModel: model },
      description: { provider: 'OpenAI', model, maximumQueries },
    };
  }
  if (config?.provider === 'Cohere' && config.cohereApiKey?.trim()) {
    const model = config.cohereModel?.trim() || 'embed-english-v3.0';
    return {
      config: { provider: 'Cohere', cohereApiKey: config.cohereApiKey, cohereModel: model },
      description: { provider: 'Cohere', model, maximumQueries },
    };
  }
  if (config?.provider === 'OpenRouter' && config.openrouterApiKey?.trim() && config.openrouterModel?.trim()) {
    const model = config.openrouterModel.trim();
    return {
      config: { provider: 'OpenRouter', openrouterApiKey: config.openrouterApiKey, openrouterModel: model },
      description: { provider: 'OpenRouter', model, maximumQueries },
    };
  }
  return {
    description: { provider: 'On-device if available', model: 'Determined during retrieval', maximumQueries },
  };
}

export async function refreshCurriculumScope(scope: StudySourceScopeV1): Promise<StudySourceScopeV1> {
  const live = await resolveStudySourceScope(scope.selected, scope);
  const current = new Map(live.resolvedDocuments.map((doc) => [doc.documentId, doc]));
  const sourceChanged = scope.resolvedDocuments.some((doc) => {
    const updated = current.get(doc.documentId);
    return !updated || updated.revision !== doc.revision ||
      JSON.stringify(updated.extractIds) !== JSON.stringify([...doc.extractIds].sort());
  });
  if (sourceChanged || live.resolvedDocuments.length === 0 || (scope.resolvedDocuments.length > 0 &&
      scope.resolvedDocuments.length !== live.resolvedDocuments.length)) {
    throw new StudyApiError({ code: 'stale_source', messageKey: 'study_generation.error.source_changed', retryable: false });
  }
  return live;
}

export async function prepareCurriculumPreflight(
  scope: StudySourceScopeV1,
  selectedConfigId?: string,
  authorized?: StudyAiPreflight,
) {
  const live = await refreshCurriculumScope(scope);
  const embedding = await resolveStudyEmbeddingConfig();
  const result = await performStudyAiPreflight({
    primaryTask: curriculumDecomposeTask,
    documents: live.resolvedDocuments.map((doc) => ({
      id: doc.documentId, isAiExcluded: doc.isAiExcluded, isLocalOnly: doc.isLocalOnly,
    })),
    selectedConfigId,
    inspectOnly: !authorized,
    cloudDisclosureAccepted: authorized?.cloudDisclosureAccepted,
    costConsentAccepted: authorized?.costConsentAccepted,
    embeddingSettings: embedding.config && {
      provider: embedding.config.provider.toLowerCase(),
      ollamaBaseUrl: embedding.config.ollamaBaseUrl,
    },
    sourceExcerptCount: EVIDENCE_LIMITS.MAX_GLOBAL_HITS,
    plannedModelSteps: maximumBatches + 1,
    estimateTokens: {
      // Up to one pass over bounded passages for each stage, plus task prompts and topic summaries.
      input: Math.ceil(EVIDENCE_LIMITS.MAX_GLOBAL_HITS * EVIDENCE_LIMITS.MAX_EXCERPT_CHARS * 2 / 4) +
        (maximumBatches + 1) * 600,
      output: (route) => {
        const configuredLimit = route.provider.getRequestPolicy?.()?.maxOutputTokens;
        return configuredLimit != null
          ? configuredLimit * (maximumBatches + 1)
          : maximumBatches * CURRICULUM_DECOMPOSE_MAX_TOKENS + CURRICULUM_PREREQUISITE_MAX_TOKENS;
      },
    },
  });
  result.preflight.modelSelection = selectedConfigId ?? '';
  result.preflight.embedding = embedding.description;

  if (authorized) {
    validatePreflightUnchanged(authorized, result.route);
    if (authorized.reasoningFallback !== result.preflight.reasoningFallback ||
        JSON.stringify(authorized.embedding) !== JSON.stringify(result.preflight.embedding) ||
        JSON.stringify(authorized.documentIds) !== JSON.stringify(result.preflight.documentIds)) {
      throw new StudyApiError({ code: 'invalid_state', messageKey: 'study_generation.error.provider_changed_on_resume', retryable: false });
    }
  }

  return { ...result, sourceScope: live, embeddingConfig: embedding.config };
}

export async function countIndexedCurriculumSources(documentIds: string[]): Promise<number | null> {
  try {
    const ids = new Set(documentIds);
    const status = await getAIIndexStatus();
    // Native status is a bounded inventory. A missing status can be a pagination limit.
    const selected = status.documents.filter((doc) => ids.has(doc.documentId));
    if (selected.length < ids.size && status.documents.length >= 500) return null;
    // chunksIndexed counts embeddings. A lexical-only index still has usable chunks.
    return selected.filter((doc) => doc.state === 'indexed' && doc.totalChunks > 0).length;
  } catch {
    return null;
  }
}
