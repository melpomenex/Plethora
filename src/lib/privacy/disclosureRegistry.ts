import type { PrivacyDisclosure } from '../../types/privacy';

/**
 * Canonical Privacy & Data-Flow Registry.
 *
 * Maps every cloud-touching subsystem to its data egress characteristics,
 * encryption state, retention policy, and third-party model involvement.
 *
 * Sourced by docs/PRIVACY_ARCHITECTURE.md, in-app Privacy Center, and store privacy labels.
 */
export const DISCLOSURE_REGISTRY: Record<string, PrivacyDisclosure> = {
  cloud_sync: {
    id: 'cloud_sync',
    name: 'End-to-End Encrypted Cloud Sync',
    category: 'sync',
    dataLeavesDevice: true,
    trigger: 'automatic',
    destination: 'Plethora Cloud Object Store / Relay',
    retention: 'Until deleted by user or account closure',
    encryptionState: 'e2e_encrypted',
    thirdPartyInvolvement: 'None (zero-knowledge ciphertext; server holds no keys)',
    userDeletable: true,
    localFallback: 'Local SQLite database and local device storage only',
    description:
      'Encrypted sync payloads and document blobs are encrypted on-device before transmission and decrypted only on authenticated client devices.',
  },
  cloud_backup: {
    id: 'cloud_backup',
    name: 'Cloud Encrypted Backups',
    category: 'sync',
    dataLeavesDevice: true,
    trigger: 'scheduled',
    destination: 'Plethora Cloud Backup Vault / User BYO Cloud',
    retention: 'Rolling 30-day retention or user-configured backup history',
    encryptionState: 'e2e_encrypted',
    thirdPartyInvolvement: 'None (encrypted with client-derived backup passphrase/key)',
    userDeletable: true,
    localFallback: 'Local manual and automated .plethora export files',
    description:
      'Full database and collection snapshots exported into encrypted archive containers.',
  },
  cloud_ai_intelligence: {
    id: 'cloud_ai_intelligence',
    name: 'Cloud Intelligence & RAG Indexing',
    category: 'ai',
    dataLeavesDevice: true,
    trigger: 'manual',
    destination: 'Plethora AI Gateway / Configured Model Provider',
    retention: 'Ephemeral processing (zero data retention for training)',
    encryptionState: 'in_transit_tls',
    thirdPartyInvolvement: 'OpenAI, Anthropic, DeepSeek, or OpenRouter (BYO key or Pro gateway)',
    userDeletable: true,
    localFallback: 'On-device EmbeddingGemma, Ollama, and SQLite FTS5 vector search',
    description:
      'Document excerpts and query embeddings sent for semantic search, tutoring, and flashcard generation. Excluded if document is flagged local-only.',
  },
  cloud_document_processing: {
    id: 'cloud_document_processing',
    name: 'Cloud Document Reconstruction & OCR',
    category: 'core',
    dataLeavesDevice: true,
    trigger: 'manual',
    destination: 'Plethora Document Conversion Service',
    retention: 'Ephemeral (deleted immediately upon job completion)',
    encryptionState: 'in_transit_tls',
    thirdPartyInvolvement: 'Cloud OCR / Parser workers',
    userDeletable: true,
    localFallback: 'Local native PDF parser, on-device OCR, and Markdown/EPUB renderers',
    description:
      'Scanned PDFs and complex layouts processed into clean reflowed text and SVG math equations.',
  },
  cloud_tts: {
    id: 'cloud_tts',
    name: 'Premium Neural Text-to-Speech',
    category: 'media',
    dataLeavesDevice: true,
    trigger: 'manual',
    destination: 'Neural TTS Voice Synthesis Endpoints',
    retention: 'Ephemeral audio synthesis (cached locally in app audio cache)',
    encryptionState: 'in_transit_tls',
    thirdPartyInvolvement: 'Neural voice synthesis provider',
    userDeletable: true,
    localFallback: 'System native TTS engines and on-device Pocket/Sherpa models',
    description:
      'Extracted sentence text synthesized to natural neural audio streams.',
  },
  cloud_transcription: {
    id: 'cloud_transcription',
    name: 'Cloud Audio & Video Transcription',
    category: 'media',
    dataLeavesDevice: true,
    trigger: 'manual',
    destination: 'Plethora Whisper Transcription Clusters',
    retention: 'Ephemeral audio chunks deleted after segment generation',
    encryptionState: 'in_transit_tls',
    thirdPartyInvolvement: 'Hosted Whisper models',
    userDeletable: true,
    localFallback: 'On-device Whisper.cpp and native platform speech recognition',
    description:
      'Audio segments sent for speech-to-text conversion and word-level timestamp alignment.',
  },
  cloud_web_capture: {
    id: 'cloud_web_capture',
    name: 'Web Inbox & Remote Capture',
    category: 'integrations',
    dataLeavesDevice: true,
    trigger: 'manual',
    destination: 'Plethora Remote Capture Ingestion Queue',
    retention: 'Until fetched and synced to local device inbox',
    encryptionState: 'stored_encrypted',
    thirdPartyInvolvement: 'None',
    userDeletable: true,
    localFallback: 'Local browser extension bridge and manual clipboard/HTML import',
    description:
      'URLs, newsletters, and articles sent from mobile share sheets or browser extensions to your reading inbox.',
  },
  telemetry_crash_reporting: {
    id: 'telemetry_crash_reporting',
    name: 'Anonymous Diagnostics & Telemetry (Opt-In)',
    category: 'telemetry',
    dataLeavesDevice: true,
    trigger: 'opt_in',
    destination: 'Plethora Telemetry Endpoint',
    retention: 'Aggregated counters retained 90 days; no raw user identifiers',
    encryptionState: 'in_transit_tls',
    thirdPartyInvolvement: 'None',
    userDeletable: true,
    localFallback: 'Disabled completely by default; zero egress',
    description:
      'Opt-in anonymous error classes and performance counters. Strictly scrubs all document titles, URLs, and personal content.',
  },
};

/**
 * Returns list of all registered privacy disclosures.
 */
export function getAllDisclosures(): PrivacyDisclosure[] {
  return Object.values(DISCLOSURE_REGISTRY);
}

/**
 * Lookup disclosure by feature ID.
 */
export function getDisclosure(id: string): PrivacyDisclosure | undefined {
  return DISCLOSURE_REGISTRY[id];
}
