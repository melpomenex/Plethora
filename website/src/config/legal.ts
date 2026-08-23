export interface LegalPlaceholders {
  legalEntityName: string | null;
  jurisdiction: string | null;
  mailingAddress: string | null;
  supportEmail: string | null;
  privacyEmail: string | null;
  dunsNumber: string | null;
  taxInformation: string | null;
  refundPolicyFinal: boolean;
  termsFinal: boolean;
  privacyFinal: boolean;
}

export const LEGAL: LegalPlaceholders = {
  legalEntityName: null,
  jurisdiction: null,
  mailingAddress: null,
  supportEmail: null,
  privacyEmail: null,
  dunsNumber: null,
  taxInformation: null,
  refundPolicyFinal: false,
  termsFinal: false,
  privacyFinal: false,
};

export function legalIsDraft(legal: LegalPlaceholders = LEGAL): boolean {
  return (
    !legal.termsFinal ||
    !legal.privacyFinal ||
    !legal.refundPolicyFinal ||
    legal.legalEntityName === null
  );
}
