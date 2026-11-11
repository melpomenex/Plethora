export interface StudyTutorDocFlag {
  documentId: string;
  isAiExcluded?: boolean;
  isLocalOnly?: boolean;
}

export interface StudyTutorPrivacyInput {
  documents: StudyTutorDocFlag[];
  generationSendsOffDevice: boolean;
  strictLocalOnly?: boolean;
  cloudDisclosureAccepted?: boolean;
  costConsentAccepted?: boolean;
  billable?: boolean;
}

/** Explicit Study tutor preflight (C7-T04): fail-closed, no silent fallback. */
export function checkStudyTutorPrivacy(input: StudyTutorPrivacyInput): void {
  for (const doc of input.documents) {
    if (doc.isAiExcluded) throw new Error('study.tutor.error.source_ai_excluded');
    if (doc.isLocalOnly && input.generationSendsOffDevice) {
      throw new Error('study.tutor.error.privacy_denied');
    }
  }
  if (input.strictLocalOnly && input.generationSendsOffDevice) {
    throw new Error('study.tutor.error.privacy_denied');
  }
  if (input.generationSendsOffDevice && !input.cloudDisclosureAccepted) {
    throw new Error('study.tutor.error.privacy_denied');
  }
  if (input.billable && !input.costConsentAccepted) {
    throw new Error('study.tutor.error.cost_consent_required');
  }
}
