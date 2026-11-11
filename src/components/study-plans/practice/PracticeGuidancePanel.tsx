import React from 'react';

export interface PracticeGuidancePanelProps {
  mode: 'exam' | 'practice' | 'diagnostic';
  onOpenTutor?: () => void;
}

export const PracticeGuidancePanel: React.FC<PracticeGuidancePanelProps> = ({ mode, onOpenTutor }) => {
  if (mode !== 'practice') return null;
  return (
    <div data-testid="practice-guidance" className="rounded-xl border border-outline-variant/30 p-3 space-y-1">
      <p className="text-xs">Stuck? Open the source-scoped Study tutor with this question&apos;s context.</p>
      <button
        type="button"
        data-testid="practice-open-tutor"
        onClick={() => onOpenTutor?.()}
        className="text-xs underline min-h-[32px]"
      >
        Open Study tutor
      </button>
      <p className="text-xs text-on-surface-variant">Tutor dialogue alone creates no performance evidence.</p>
    </div>
  );
};
