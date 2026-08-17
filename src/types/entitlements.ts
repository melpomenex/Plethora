/**
 * Plethora Capability Entitlements Architecture
 *
 * Canonical registry of capabilities, snapshots, and entitlement states.
 * Capabilities (not plans) are the unit of client-side feature enablement.
 */

export const CAPABILITY_IDS = [
  'cloud_sync',
  'cloud_backup',
  'library_intelligence',
  'semantic_connections',
  'knowledge_graph',
  'knowledge_gap_detection',
  'adaptive_learning_paths',
  'ai_tutoring',
  'enhanced_card_generation',
  'card_optimizer',
  'advanced_analytics',
  'cloud_document_processing',
  'premium_tts',
  'transcription',
  'web_capture',
  'integrations',
  'automation',
  'api_access',
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export type PlanId = 'free' | 'pro' | (string & {});

export type CapabilityReason =
  | 'plan'
  | 'signed_out'
  | 'offline'
  | 'quota_exhausted'
  | 'region'
  | 'unavailable';

export type QuotaWindow = 'daily' | 'monthly' | 'rolling_30d' | 'lifetime';

export interface QuotaState {
  used: number;
  limit: number;
  window: QuotaWindow;
  resetsAt?: string;
}

export interface CapabilityState {
  enabled: boolean;
  reason?: CapabilityReason;
  quota?: QuotaState;
}

export type SnapshotSource =
  | 'local_defaults'
  | 'server'
  | 'cache'
  | 'grace'
  | 'override';

export interface EntitlementSnapshot {
  accountId?: string;
  plan: PlanId;
  capabilities: Record<CapabilityId, CapabilityState>;
  fetchedAt: string;
  expiresAt?: string;
  source: SnapshotSource;
}

export interface CapabilityDescriptor {
  id: CapabilityId;
  defaultPlan: 'free' | 'pro';
  requiresAccount: boolean;
  hasQuotas: boolean;
  localFallback: string;
}

export const CAPABILITY_REGISTRY: Record<CapabilityId, CapabilityDescriptor> = {
  cloud_sync: {
    id: 'cloud_sync',
    defaultPlan: 'pro',
    requiresAccount: true,
    hasQuotas: false,
    localFallback: 'Local SQLite database and local device storage only.',
  },
  cloud_backup: {
    id: 'cloud_backup',
    defaultPlan: 'pro',
    requiresAccount: true,
    hasQuotas: true,
    localFallback: 'Local automated and manual backup exports (.plethora).',
  },
  library_intelligence: {
    id: 'library_intelligence',
    defaultPlan: 'pro',
    requiresAccount: true,
    hasQuotas: true,
    localFallback: 'Local on-device EmbeddingGemma and SQLite FTS5 cosine search.',
  },
  semantic_connections: {
    id: 'semantic_connections',
    defaultPlan: 'pro',
    requiresAccount: true,
    hasQuotas: true,
    localFallback: 'Explicit tags, manual cross-links, and local search associations.',
  },
  knowledge_graph: {
    id: 'knowledge_graph',
    defaultPlan: 'pro',
    requiresAccount: true,
    hasQuotas: false,
    localFallback: 'Local concept tagging and manual note linking.',
  },
  knowledge_gap_detection: {
    id: 'knowledge_gap_detection',
    defaultPlan: 'pro',
    requiresAccount: true,
    hasQuotas: true,
    localFallback: 'Manual review performance metrics and standard retention graphs.',
  },
  adaptive_learning_paths: {
    id: 'adaptive_learning_paths',
    defaultPlan: 'pro',
    requiresAccount: true,
    hasQuotas: true,
    localFallback: 'Standard category-based and priority-sorted queue navigation.',
  },
  ai_tutoring: {
    id: 'ai_tutoring',
    defaultPlan: 'pro',
    requiresAccount: true,
    hasQuotas: true,
    localFallback: 'Direct BYO-key AI provider queries and local Ollama execution.',
  },
  enhanced_card_generation: {
    id: 'enhanced_card_generation',
    defaultPlan: 'pro',
    requiresAccount: true,
    hasQuotas: true,
    localFallback: 'Standard manual card creation and local BYO-key flashcard prompts.',
  },
  card_optimizer: {
    id: 'card_optimizer',
    defaultPlan: 'pro',
    requiresAccount: true,
    hasQuotas: true,
    localFallback: 'Manual card editing and FSRS/SM-20 parameter tuning.',
  },
  advanced_analytics: {
    id: 'advanced_analytics',
    defaultPlan: 'pro',
    requiresAccount: true,
    hasQuotas: false,
    localFallback: 'Core daily study statistics, heatmaps, and retention summaries.',
  },
  cloud_document_processing: {
    id: 'cloud_document_processing',
    defaultPlan: 'pro',
    requiresAccount: true,
    hasQuotas: true,
    localFallback: 'Local PDF parsing, on-device OCR, and native format extraction.',
  },
  premium_tts: {
    id: 'premium_tts',
    defaultPlan: 'pro',
    requiresAccount: true,
    hasQuotas: true,
    localFallback: 'System native speech synthesizers and local Pocket/Sherpa TTS models.',
  },
  transcription: {
    id: 'transcription',
    defaultPlan: 'pro',
    requiresAccount: true,
    hasQuotas: true,
    localFallback: 'Local Whisper.cpp and on-device whisper models (ungated).',
  },
  web_capture: {
    id: 'web_capture',
    defaultPlan: 'pro',
    requiresAccount: true,
    hasQuotas: true,
    localFallback: 'Local browser extension bridge and manual URL/HTML import.',
  },
  integrations: {
    id: 'integrations',
    defaultPlan: 'pro',
    requiresAccount: true,
    hasQuotas: false,
    localFallback: 'Local Obsidian vault sync, Anki deck exports, and MCP stdio servers.',
  },
  automation: {
    id: 'automation',
    defaultPlan: 'pro',
    requiresAccount: true,
    hasQuotas: false,
    localFallback: 'Local scheduled tasks and desktop background processing.',
  },
  api_access: {
    id: 'api_access',
    defaultPlan: 'pro',
    requiresAccount: true,
    hasQuotas: true,
    localFallback: 'Localhost REST automation endpoints and MCP server tools.',
  },
};

/**
 * Construct default capability states for the Free plan.
 * All Free plan capabilities resolve to disabled with reason "plan" or "signed_out".
 */
export function createFreeDefaultCapabilities(): Record<CapabilityId, CapabilityState> {
  const capabilities = {} as Record<CapabilityId, CapabilityState>;
  for (const id of CAPABILITY_IDS) {
    const desc = CAPABILITY_REGISTRY[id];
    capabilities[id] = {
      enabled: desc.defaultPlan === 'free',
      reason: desc.defaultPlan === 'free' ? undefined : 'plan',
    };
  }
  return capabilities;
}

export const FREE_DEFAULT_SNAPSHOT: EntitlementSnapshot = {
  plan: 'free',
  capabilities: createFreeDefaultCapabilities(),
  fetchedAt: new Date(0).toISOString(),
  source: 'local_defaults',
};
