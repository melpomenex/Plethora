import React, { useMemo } from 'react';
import { TutorSheet } from '../../tutor/TutorSheet';
import type { StudyTutorContext } from '../../../types/learningEvidence';
import type { StudySourceRefV1 } from '../../../types/studySource';
import { buildStudyTutorContext, buildStudyTutorMaterial } from './studyTutorContext';
import { checkStudyTutorPrivacy } from './studyTutorPrivacy';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";
import { studyErrorMessage } from "../../../lib/study-plans/studyErrorMessage";


export interface StudyTutorHostProps {
  open: boolean;
  planId: string;
  planVersionId: string;
  nodeId: string;
  conceptId?: string | null;
  gapId?: string | null;
  sourceRefs: StudySourceRefV1[];
  excerptsByRefId?: Record<string, string>;
  objectives?: string[];
  misconception?: string | null;
  evidenceSummary?: string;
  documentFlags?: Array<{ documentId: string; isAiExcluded?: boolean; isLocalOnly?: boolean }>;
  generationSendsOffDevice?: boolean;
  strictLocalOnly?: boolean;
  cloudDisclosureAccepted?: boolean;
  costConsentAccepted?: boolean;
  billable?: boolean;
  topic?: string;
  documentTitle?: string;
  onClose: () => void;
}

export const StudyTutorHost: React.FC<StudyTutorHostProps> = ({
  open,
  planId,
  planVersionId,
  nodeId,
  conceptId = null,
  gapId = null,
  sourceRefs,
  excerptsByRefId = {},
  objectives = [],
  misconception = null,
  evidenceSummary = '',
  documentFlags = [],
  generationSendsOffDevice = false,
  strictLocalOnly = false,
  cloudDisclosureAccepted = false,
  costConsentAccepted = false,
  billable = false,
  topic,
  documentTitle,
  onClose,
}) => {
        useI18n();
        const built = useMemo(() => {
    try {
      const context: StudyTutorContext = buildStudyTutorContext({
        planId,
        planVersionId,
        nodeId,
        conceptId,
        gapId,
        sourceRefs,
        objectives,
        misconception,
        evidenceSummary,
      });
      checkStudyTutorPrivacy({
        documents: documentFlags.length > 0
          ? documentFlags
          : context.sourceDocumentIds.map((documentId) => ({ documentId })),
        generationSendsOffDevice,
        strictLocalOnly,
        cloudDisclosureAccepted,
        costConsentAccepted,
        billable,
      });
      return { context, error: null as string | null };
    } catch (err) {
      return {
        context: null as StudyTutorContext | null,
        error: studyErrorMessage(err, translateRecentFeature("studyPlans.ui.operation-failed")),
      };
    }
  }, [planId, planVersionId, nodeId, conceptId, gapId, sourceRefs, objectives, misconception, evidenceSummary, documentFlags, generationSendsOffDevice, strictLocalOnly, cloudDisclosureAccepted, costConsentAccepted, billable]);

  const material = useMemo(() => {
    if (!built.context) return '';
    return buildStudyTutorMaterial(built.context, excerptsByRefId);
  }, [built.context, excerptsByRefId]);

  if (!open) return null;
  if (!built.context) {
    return (
      <div role="alert" data-testid="study-tutor-refused" className="p-4 text-sm">{translateRecentFeature("studyPlans.ui.study-tutor-refused-var0-no-.65ea726c", {var0: built.error})}<button type="button" onClick={onClose} className="underline ml-2 min-h-[32px]">
          {translateRecentFeature("common.close")}</button>
      </div>
    );
  }

  return (
    <TutorSheet
      open={open}
      material={material}
      topic={topic ?? nodeId}
      documentTitle={documentTitle}
      documentId={built.context.sourceDocumentIds[0]}
      studyContext={built.context}
      onClose={onClose}
    />
  );
};
