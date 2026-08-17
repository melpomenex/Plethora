import type { CapabilityId } from './entitlements';

export interface PaywallTriggerContext {
  capabilityId: CapabilityId;
  sourceSurface: string;
  title: string;
  description: string;
  quotaDetails?: string;
}

export interface TrialState {
  isActive: boolean;
  daysRemaining: number;
  expiresAt?: string;
}

export interface ProFeatureMetadata {
  capabilityId: CapabilityId;
  title: string;
  description: string;
  isCloudAugmentation: boolean;
  quotaWindow: string;
}

export const PRO_FEATURES_CATALOG: ProFeatureMetadata[] = [
  {
    capabilityId: 'library_intelligence',
    title: 'Whole-Library RAG & Deep Citations',
    description: 'Query your entire multi-format library with grounded page and timestamp citations.',
    isCloudAugmentation: true,
    quotaWindow: 'Monthly queries',
  },
  {
    capabilityId: 'semantic_connections',
    title: 'Semantic Connections & Graph Traversal',
    description: 'Discover automatic concept relationships and bridge disparate documents.',
    isCloudAugmentation: true,
    quotaWindow: 'Monthly operations',
  },
  {
    capabilityId: 'cloud_sync',
    title: 'Zero-Knowledge E2E Encrypted Cloud Sync',
    description: 'Sync your library across macOS, Windows, Linux, and Android with client-side encryption.',
    isCloudAugmentation: true,
    quotaWindow: 'Unlimited encrypted sync',
  },
  {
    capabilityId: 'cloud_document_processing',
    title: 'Document Reconstruction & Reflow OCR',
    description: 'Reconstruct scanned PDFs into accessible, reflowable, structured documents.',
    isCloudAugmentation: true,
    quotaWindow: 'Monthly pages',
  },
  {
    capabilityId: 'premium_tts',
    title: 'Neural Audiobook Voices & Sync',
    description: 'Listen to articles and books with premium studio-quality neural voices.',
    isCloudAugmentation: true,
    quotaWindow: 'Monthly audio hours',
  },
  {
    capabilityId: 'transcription',
    title: 'Diarized Video & Podcast Transcription',
    description: 'Transcribe lectures and podcasts with speaker diarization and timestamp deep links.',
    isCloudAugmentation: true,
    quotaWindow: 'Monthly audio hours',
  },
  {
    capabilityId: 'web_capture',
    title: 'Remote Web Inbox & Cloud Capture',
    description: 'Save articles and web pages to your Plethora inbox from any browser or email.',
    isCloudAugmentation: true,
    quotaWindow: 'Monthly captures',
  },
  {
    capabilityId: 'ai_tutoring',
    title: 'Adaptive Socratic AI Tutoring',
    description: 'Interactive mini-lessons that adapt to your knowledge gaps and remediate misconceptions.',
    isCloudAugmentation: true,
    quotaWindow: 'Monthly lesson turns',
  },
  {
    capabilityId: 'card_optimizer',
    title: 'Flashcard Lifecycle Optimizer',
    description: 'Proactive recommendations to simplify, split, and refine deteriorating flashcards.',
    isCloudAugmentation: true,
    quotaWindow: 'Monthly optimizations',
  },
  {
    capabilityId: 'adaptive_learning_paths',
    title: 'AI-Generated Learning Curricula',
    description: 'Convert your library into an adaptive, prerequisite-ordered learning path.',
    isCloudAugmentation: true,
    quotaWindow: 'Monthly paths',
  },
];
