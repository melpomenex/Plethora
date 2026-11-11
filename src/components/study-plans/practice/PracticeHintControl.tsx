import React from 'react';
import { hintForLevel } from '../../../lib/study-plans/practice/hintState';

export interface PracticeHintControlProps {
  hints: string[];
  revealed: number;
  mode: 'exam' | 'practice' | 'diagnostic';
  onReveal?: (nextLevel: number) => void;
}

export const PracticeHintControl: React.FC<PracticeHintControlProps> = ({
  hints,
  revealed,
  mode,
  onReveal,
}) => {
  if (mode !== 'practice') return null;
  if (hints.length === 0) {
    return (
      <p data-testid="practice-hint-empty" className="text-xs text-on-surface-variant">
        No committed hints for this question.
      </p>
    );
  }
  const current = hintForLevel({ hints } as never, revealed);
  return (
    <div data-testid="practice-hint-control" className="space-y-1 rounded-xl border border-outline-variant/30 p-3">
      <p className="text-xs" data-testid="practice-hint-status">
        Hint {Math.min(revealed, hints.length)} of {hints.length}
        {revealed > 0 ? '' : ' (hidden until requested)'}
      </p>
      {current && (
        <p data-testid={`practice-hint-${revealed}`} className="text-xs">
          {current}
        </p>
      )}
      {revealed < hints.length && (
        <button
          type="button"
          data-testid="practice-hint-reveal"
          onClick={() => onReveal?.(revealed + 1)}
          className="text-xs underline min-h-[32px]"
        >
          Reveal hint {revealed + 1} of {hints.length}
        </button>
      )}
    </div>
  );
};
