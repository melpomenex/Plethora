import { getAllDisclosures } from './disclosureRegistry';
import type {
  PrivacyDisclosure,
  PrivacyLabelDataType,
  PrivacyLabelPurpose,
} from '../../types/privacy';

/**
 * App Store Connect privacy nutrition-label draft generator (Change C §3.2).
 *
 * The registry is the single source of truth: every disclosure's
 * `labelMapping` is folded into the per-data-type answers Apple's
 * questionnaire expects (one row per collected data type, with
 * linked-to-identity / used-for-tracking flags and purposes).
 *
 * The emitted draft guides MANUAL entry in App Store Connect —
 * reproducibility comes from this generator + the snapshot test + the
 * mapping document (`docs/release/ios-privacy-labels.md`), not from ASC API
 * automation (design: rejected for v1).
 */

/** One App Store Connect "Data Collected" questionnaire row. */
export interface AscLabelAnswer {
  dataType: PrivacyLabelDataType;
  linkedToIdentity: boolean;
  usedForTracking: boolean;
  purposes: PrivacyLabelPurpose[];
}

/** Which registry disclosures contributed to each questionnaire row. */
export interface AscLabelAnswerWithSources extends AscLabelAnswer {
  sourceDisclosureIds: string[];
}

export interface AscQuestionnaireDraft {
  /** Folded, deduplicated questionnaire rows ready for manual ASC entry. */
  collectedData: AscLabelAnswerWithSources[];
  /** Per-disclosure raw answers, kept for traceability in the mapping doc. */
  perDisclosure: Array<{
    id: string;
    name: string;
    dataLeavesDevice: boolean;
    dataTypes: PrivacyLabelDataType[];
    linkedToIdentity: boolean;
    usedForTracking: boolean;
    purposes: PrivacyLabelPurpose[];
  }>;
}

type DisclosureRecordAlias = PrivacyDisclosure;

function fold(disclosures: DisclosureRecordAlias[]): AscLabelAnswerWithSources[] {
  const byType = new Map<PrivacyLabelDataType, AscLabelAnswerWithSources>();
  for (const d of disclosures) {
    const lm = d.labelMapping;
    if (lm.dataTypes.length === 0) continue;
    for (const dataType of lm.dataTypes) {
      const existing = byType.get(dataType);
      if (!existing) {
        byType.set(dataType, {
          dataType,
          linkedToIdentity: lm.linkedToIdentity,
          usedForTracking: lm.usedForTracking,
          purposes: [...lm.purposes],
          sourceDisclosureIds: [d.id],
        });
        continue;
      }
      existing.sourceDisclosureIds.push(d.id);
      // ASC rows are per data type: any flow linking the data makes the row
      // "linked"; purposes are the union across contributing flows.
      existing.linkedToIdentity = existing.linkedToIdentity || lm.linkedToIdentity;
      existing.usedForTracking = existing.usedForTracking || lm.usedForTracking;
      for (const p of lm.purposes) {
        if (!existing.purposes.includes(p)) existing.purposes.push(p);
      }
    }
  }
  return [...byType.values()].sort((a, b) => a.dataType.localeCompare(b.dataType));
}

/**
 * Generate the App Store Connect questionnaire draft from the current
 * registry. Pure: same registry → same draft (snapshot-tested).
 */
export function generatePrivacyLabelDraft(): AscQuestionnaireDraft {
  const disclosures = getAllDisclosures();
  return {
    collectedData: fold(disclosures),
    perDisclosure: disclosures.map((d) => ({
      id: d.id,
      name: d.name,
      dataLeavesDevice: d.dataLeavesDevice,
      dataTypes: d.labelMapping.dataTypes,
      linkedToIdentity: d.labelMapping.linkedToIdentity,
      usedForTracking: d.labelMapping.usedForTracking,
      purposes: d.labelMapping.purposes,
    })),
  };
}
