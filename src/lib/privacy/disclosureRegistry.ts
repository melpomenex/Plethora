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
    labelMapping: {
      dataTypes: ['user_content'],
      linkedToIdentity: true,
      usedForTracking: false,
      purposes: ['app_functionality'],
    },
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
    labelMapping: {
      dataTypes: ['user_content'],
      linkedToIdentity: true,
      usedForTracking: false,
      purposes: ['app_functionality'],
    },
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
    labelMapping: {
      dataTypes: ['user_content'],
      linkedToIdentity: true,
      usedForTracking: false,
      purposes: ['app_functionality'],
    },
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
    labelMapping: {
      dataTypes: ['user_content'],
      linkedToIdentity: true,
      usedForTracking: false,
      purposes: ['app_functionality'],
    },
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
    labelMapping: {
      dataTypes: ['user_content'],
      linkedToIdentity: true,
      usedForTracking: false,
      purposes: ['app_functionality'],
    },
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
    labelMapping: {
      dataTypes: ['user_content'],
      linkedToIdentity: true,
      usedForTracking: false,
      purposes: ['app_functionality'],
    },
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
    labelMapping: {
      dataTypes: ['user_content'],
      linkedToIdentity: true,
      usedForTracking: false,
      purposes: ['app_functionality'],
    },
  },
  // NOTE (Change C task 1.1): this entry is drafted from Proposal B's
  // DOCUMENTED PLANNED flows (StoreKit 2 signed transaction JWS payloads
  // forwarded to the Plethora server over TLS; App Store Server Notifications
  // received server-side). Final wording is CONTINGENT on Proposal B's landed
  // implementation — revisit destination/retention strings when B merges.
  store_transactions: {
    id: 'store_transactions',
    name: 'Store Transactions & Entitlements',
    category: 'core',
    dataLeavesDevice: true,
    trigger: 'manual',
    destination: 'Apple App Store (StoreKit 2); signed transaction records forwarded to Plethora billing server',
    retention:
      'Minimal transaction identifiers and signed payloads retained for accounting, refunds, and entitlement restoration; no document content',
    encryptionState: 'in_transit_tls',
    thirdPartyInvolvement: 'Apple (App Store / StoreKit 2 / App Store Server Notifications)',
    // Rationale for userDeletable=false: these are minimal financial records
    // (transaction ids + Apple-signed JWS payloads) required for accounting,
    // refund handling, and entitlement integrity. They contain no document or
    // reading content. Account deletion (Proposal F) removes all
    // account-linked personal data; transaction ledgers are retained per
    // accounting obligations and disassociated from the deleted account.
    userDeletable: false,
    localFallback: 'None (billing requires Apple servers); all learning features work free without any purchase',
    description:
      'When you purchase, restore, or renew a subscription, Apple provides signed transaction records that Plethora forwards to its billing server over TLS to grant and restore your entitlements.',
    labelMapping: {
      dataTypes: ['purchases'],
      linkedToIdentity: true,
      usedForTracking: false,
      purposes: ['app_functionality'],
    },
  },
  web_analytics: {
    id: 'web_analytics',
    name: 'Web Analytics (Web/PWA builds only)',
    category: 'telemetry',
    dataLeavesDevice: true,
    trigger: 'automatic',
    destination: 'Vercel Analytics (loaded ONLY in browser web/PWA builds; never in native desktop/iOS apps)',
    retention: 'Aggregated, cookieless page-view metrics per Vercel Web Analytics default retention',
    encryptionState: 'in_transit_tls',
    thirdPartyInvolvement: 'Vercel (cookieless, aggregated; no document content, no cross-app tracking)',
    // Aggregated anonymous metrics cannot be attributed back to a user, so
    // there is nothing user-deletable to offer.
    userDeletable: false,
    localFallback: 'Not loaded at all in native desktop/iOS builds — zero egress outside the browser web/PWA',
    description:
      'On web/PWA builds only, cookieless page-view counts are sent to Vercel Analytics. Native desktop and iOS builds never load it.',
    labelMapping: {
      dataTypes: ['usage_data'],
      linkedToIdentity: false,
      usedForTracking: false,
      purposes: ['analytics'],
    },
  },
  telemetry_crash_reporting: {
    id: 'telemetry_crash_reporting',
    name: 'Diagnostics & Crash Reporting (Not Currently Shipped)',
    category: 'telemetry',
    dataLeavesDevice: false,
    trigger: 'never',
    destination: 'None — no crash-reporting or telemetry SDK ships in current builds',
    retention: 'No diagnostic data is collected or transmitted today',
    encryptionState: 'none_local_only',
    thirdPartyInvolvement: 'None',
    userDeletable: true,
    localFallback: 'Complete disablement (default). The opt-in endpoint described previously does not exist yet; if a crash reporter ships under a future proposal, this entry will be updated before it ever transmits.',
    description:
      'Corrected disclosure: no crash-reporting SDK ships in current builds and no diagnostics leave the device. This entry is reserved for a strictly opt-in, content-scrubbed diagnostics flow that may ship later.',
    labelMapping: {
      dataTypes: [],
      linkedToIdentity: false,
      usedForTracking: false,
      purposes: [],
    },
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
