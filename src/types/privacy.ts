import type { Document } from './document';

/**
 * Encryption states for data leaving the device.
 */
export type EncryptionState =
  | 'none_local_only'
  | 'in_transit_tls'
  | 'stored_encrypted'
  | 'e2e_encrypted';

/**
 * Trigger condition for data egress.
 */
export type DataEgressTrigger = 'never' | 'manual' | 'opt_in' | 'automatic' | 'scheduled';

/**
 * App Store Connect "Data Collected" categories used by the privacy
 * nutrition-label mapping (Change C §3). Values mirror the ASC questionnaire
 * taxonomy so the generated draft maps 1:1 onto manual label entry.
 */
export type PrivacyLabelDataType =
  | 'contact_info'
  | 'health_fitness'
  | 'financial_info'
  | 'location'
  | 'sensitive_info'
  | 'contacts'
  | 'user_content'
  | 'browsing_history'
  | 'search_history'
  | 'identifiers'
  | 'purchases'
  | 'usage_data'
  | 'diagnostics'
  | 'other_data';

/**
 * App Store Connect "Purpose" values for collected data.
 */
export type PrivacyLabelPurpose =
  | 'app_functionality'
  | 'analytics'
  | 'developer_advertising'
  | 'marketing'
  | 'third_party_advertising'
  | 'personalization'
  | 'other';

/**
 * Label-mapping fields attached to every disclosure so the App Store
 * questionnaire draft (`src/lib/privacy/labelMapping.ts`) is generated from
 * the same source of truth as the in-app Privacy Center.
 */
export interface PrivacyLabelMapping {
  /** ASC data types collected by this flow (empty when nothing is collected). */
  dataTypes: PrivacyLabelDataType[];
  /** Whether the collected data is linked to the user's identity/account. */
  linkedToIdentity: boolean;
  /** Whether this flow contributes to cross-app/device tracking. Always false in Plethora. */
  usedForTracking: boolean;
  /** ASC purposes for the collected data. */
  purposes: PrivacyLabelPurpose[];
}

/**
 * Disclosure entry describing data flows for a specific feature or subsystem.
 */
export interface PrivacyDisclosure {
  id: string;
  name: string;
  category: 'core' | 'ai' | 'sync' | 'media' | 'integrations' | 'telemetry';
  dataLeavesDevice: boolean;
  trigger: DataEgressTrigger;
  destination: string;
  retention: string;
  encryptionState: EncryptionState;
  thirdPartyInvolvement: string;
  userDeletable: boolean;
  localFallback: string;
  description: string;
  /** App Store nutrition-label mapping (Change C §3.1). */
  labelMapping: PrivacyLabelMapping;
}

/**
 * Checks whether a document is eligible for cloud processing, hosted AI, or remote synchronization.
 * If a document is flagged `isLocalOnly`, all cloud features MUST skip egress and fallback to local pipelines.
 */
export function isCloudEligible(document?: Document | null): boolean {
  if (!document) return false;
  if (document.isLocalOnly === true) return false;
  if (document.metadata?.isLocalOnly === true) return false;
  return true;
}
