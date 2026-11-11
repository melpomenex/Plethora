import React from 'react';

export interface NextPracticePanelProps {
  conceptId: string;
  advisedDifficulty: number;
  reason: 'decrease' | 'increase' | 'same';
  excludedFingerprints: string[];
  onCreateNext?: () => void | Promise<void>;
}

export const NextPracticePanel: React.FC<NextPracticePanelProps> = ({
  conceptId,
  advisedDifficulty,
  reason,
  excludedFingerprints,
  onCreateNext,
}) => {
  return (
    <div data-testid="next-practice" className="rounded-xl border border-outline-variant/30 p-3 space-y-1">
      <p className="text-xs" data-testid="next-practice-advice">
        Next practice for {conceptId}: difficulty {advisedDifficulty} ({reason}); excludes {excludedFingerprints.length} prior fingerprint(s).
      </p>
      <p className="text-xs text-on-surface-variant">Created only on your request as a new Draft with current sources.</p>
      <button
        type="button"
        data-testid="next-practice-create"
        onClick={() => void onCreateNext?.()}
        className="text-xs underline min-h-[32px]"
      >
        Create next practice draft
      </button>
    </div>
  );
};
