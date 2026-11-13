import React from 'react';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export interface PracticeGuidancePanelProps {
  mode: 'exam' | 'practice' | 'diagnostic';
  onOpenTutor?: () => void;
}

export const PracticeGuidancePanel: React.FC<PracticeGuidancePanelProps> = ({ mode, onOpenTutor }) => {
        useI18n();
        if (mode !== 'practice') return null;
  return (
    <div data-testid="practice-guidance" className="rounded-xl border border-outline-variant/30 p-3 space-y-1">
      <p className="text-xs">{translateRecentFeature("studyPlans.ui.stuck-open-the-source-scoped.485e8f62")}</p>
      <button
        type="button"
        data-testid="practice-open-tutor"
        onClick={() => onOpenTutor?.()}
        className="text-xs underline min-h-[32px]"
      >
        {translateRecentFeature("studyPlans.ui.open-study-tutor.6c97f729")}</button>
      <p className="text-xs text-on-surface-variant">{translateRecentFeature("studyPlans.ui.tutor-dialogue-alone-creates.dc3ce696")}</p>
    </div>
  );
};
