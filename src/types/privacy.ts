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
