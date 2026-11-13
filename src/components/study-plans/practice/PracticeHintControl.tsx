import React from 'react';
import { hintForLevel } from '../../../lib/study-plans/practice/hintState';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


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
        useI18n();
        if (mode !== 'practice') return null;
  if (hints.length === 0) {
    return (
      <p data-testid="practice-hint-empty" className="text-xs text-on-surface-variant">
        {translateRecentFeature("studyPlans.ui.no-committed-hints-for-this-.f8eb0cd3")}</p>
    );
  }
  const current = hintForLevel({ hints } as never, revealed);
  return (
    <div data-testid="practice-hint-control" className="space-y-1 rounded-xl border border-outline-variant/30 p-3">
      <p className="text-xs" data-testid="practice-hint-status">{translateRecentFeature("studyPlans.ui.hint-var0-of-var1.ca731b3a", {var0: Math.min(revealed, hints.length), var1: hints.length})}{revealed > 0 ? '' : (" " + translateRecentFeature("studyPlans.ui.hidden-until-requested.8ed310f6"))}
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
        >{translateRecentFeature("studyPlans.ui.reveal-hint-var0-of-var1.16fec75b", {var0: revealed + 1, var1: hints.length})}</button>
      )}
    </div>
  );
};
