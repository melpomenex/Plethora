/**
 * Capability ids copied from the app registry.
 * MUST match `src/types/entitlements.ts` (`CAPABILITY_IDS`).
 * Do not import application source into the website bundle.
 */
export const ENTITLEMENT_IDS = [
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

export type EntitlementId = (typeof ENTITLEMENT_IDS)[number];
