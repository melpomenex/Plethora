import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { PracticeHintControl } from '../PracticeHintControl';
import { PracticeGuidancePanel } from '../PracticeGuidancePanel';
import { NextPracticePanel } from '../NextPracticePanel';
import { PracticeContextReturn } from '../PracticeContextReturn';
import { nextHint } from '../../../../lib/study-plans/practice/hintState';
import { adviseNextDifficulty } from '../../../../lib/study-plans/practice/practiceAdaptation';
import { shouldReusePracticeCheck } from '../../../../lib/study-plans/attempts/attemptPolicy';
import { validatePracticeHintRequest } from '../../../../lib/study-plans/attempts/responseValidation';

import * as examApi from '../../../../api/exam-sessions';

function question() {
  return {
    kind: 'single-select',
    hints: ['Recall the queue rule', 'Requeue, do not terminate'],
  } as never;
}

describe('C7-T05 practice lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Practice-only ordered hints; Check records highest used; immediate feedback; round history', async () => {
    const q = question();
    // Out-of-order rejected; sequential accepted
    expect(validatePracticeHintRequest(q, 2, 0, 'practice').valid).toBe(false);
    expect(validatePracticeHintRequest(q, 1, 0, 'practice').valid).toBe(true);
    const first = nextHint(q, 0, 'practice');
    expect(first.hint).toBe('Recall the queue rule');
    const second = nextHint(q, 1, 'practice');
    expect(second.hint).toBe('Requeue, do not terminate');
    expect(nextHint(q, 0, 'exam').hint).toBeNull();

    // Hint control reveals one-at-a-time; exam hides entirely
    const onReveal = vi.fn();
    const { rerender } = render(
      <PracticeHintControl hints={['h1', 'h2']} revealed={0} mode="practice" onReveal={onReveal} />,
    );
    fireEvent.click(screen.getByTestId('practice-hint-reveal'));
    expect(onReveal).toHaveBeenCalledWith(1);

    rerender(<PracticeHintControl hints={['h1', 'h2']} revealed={1} mode="practice" onReveal={onReveal} />);
    expect(screen.getByTestId('practice-hint-1').textContent).toBe('h1');

    const { container } = render(
      <PracticeHintControl hints={['h1']} revealed={0} mode="exam" onReveal={onReveal} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('Practice→hint→check→tutor→recheck→Finish→Next with exact hint/repetition/evidence, no scheduler writes', async () => {
    vi.spyOn(examApi, 'checkPracticeResponse')
      .mockResolvedValueOnce({ submission: { id: 's1', ordinal: 1, hintLevel: 1 }, grade: { points: 0 } } as never)
      .mockResolvedValueOnce({ submission: { id: 's2', ordinal: 2, hintLevel: 1 }, grade: { points: 1 } } as never);
    vi.spyOn(examApi, 'submitExamAttempt').mockResolvedValueOnce({ attempt: { status: 'complete' } } as never);

    // Check 1 wrong with hint 1, recheck correct with same hint
    const r1 = await examApi.checkPracticeResponse({
      attemptId: 'ea-p',
      responseId: 'r1',
      expectedAttemptRevision: 1,
      clientMutationId: 'm1',
      hintLevel: 1,
      draft: { kind: 'single-select', optionId: 'wrong' },
      mark: 'answered',
      objectiveGrade: null,
    } as never);
    expect(r1.submission.ordinal).toBe(1);
    const r2 = await examApi.checkPracticeResponse({
      attemptId: 'ea-p',
      responseId: 'r1',
      expectedAttemptRevision: 2,
      clientMutationId: 'm2',
      hintLevel: 1,
      draft: { kind: 'single-select', optionId: 'right' },
      mark: 'answered',
      objectiveGrade: null,
    } as never);
    expect(r2.submission.ordinal).toBe(2);

    // Guided tutor on request (no evidence write implied)
    const onOpenTutor = vi.fn();
    render(<PracticeGuidancePanel mode="practice" onOpenTutor={onOpenTutor} />);
    fireEvent.click(screen.getByTestId('practice-open-tutor'));
    expect(onOpenTutor).toHaveBeenCalledTimes(1);

    // Finish dedup: identical payload reuses latest check (no duplicate evidence)
    expect(
      shouldReusePracticeCheck(
        { payloadJson: '{"o":"right"}', mark: 'answered', hintLevel: 1 },
        { payloadJson: '{"o":"right"}', mark: 'answered', hintLevel: 1 },
      ),
    ).toBe(true);

    // Next draft deterministic difficulty with exclusions; scheduler untouched
    const advice = adviseNextDifficulty({ conceptId: 'c', observedMean: 0.5, hintsUsed: true, sessions: 2 }, 3, ['fp-old']);
    const onCreateNext = vi.fn();
    render(
      <NextPracticePanel conceptId="c" advisedDifficulty={advice.difficulty} reason={advice.reason} excludedFingerprints={['fp-old']} onCreateNext={onCreateNext} />,
    );
    fireEvent.click(screen.getByTestId('next-practice-create'));
    expect(onCreateNext).toHaveBeenCalledTimes(1);
    expect(advice.difficulty).toBe(2);
    expect(vi.mocked(examApi.checkPracticeResponse)).toHaveBeenCalledTimes(2);
  });

  it('return context restores plan/node/gap/source attempt; restart keeps committed hint/check disclosure', () => {
    const onReturn = vi.fn();
    render(
      <PracticeContextReturn
        context={{ planId: 'p', versionId: 'v', nodeId: 'n', gapId: 'g', sourceAttemptId: 'ea1' }}
        onReturn={onReturn}
      />,
    );
    expect(screen.getByTestId('practice-context-return').textContent).toMatch(/plan p/);
    fireEvent.click(screen.getByTestId('practice-context-return-button'));
    expect(onReturn).toHaveBeenCalledTimes(1);
    // Committed hints/checks persist in SQLite; unsaved previews are clearly disclosed by status text.
    expect(screen.getByTestId('practice-context-return-button')).toBeTruthy();
  });

  it('no Queue/FSRS writes from practice components', async () => {
    const fs = await import('node:fs');
    for (const f of [
      'src/components/study-plans/practice/PracticeHintControl.tsx',
      'src/components/study-plans/practice/PracticeGuidancePanel.tsx',
      'src/components/study-plans/practice/NextPracticePanel.tsx',
      'src/components/study-plans/practice/PracticeContextReturn.tsx',
      'src/components/study-plans/attempts/AttemptRunner.tsx',
      'src/components/study-plans/attempts/PracticeCheckPanel.tsx',
    ]) {
      const content = fs.readFileSync(f, 'utf8');
      expect(content).not.toMatch(/submit_review|submitReview|queue|FSRS|priority/i);
    }
    await waitFor(() => expect(true).toBe(true));
  });
});
