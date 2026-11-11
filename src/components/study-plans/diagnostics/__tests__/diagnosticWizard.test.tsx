import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { DiagnosticChoice } from '../DiagnosticChoice';
import { DiagnosticGenerationPanel } from '../DiagnosticGenerationPanel';
import { DiagnosticResumeCard } from '../DiagnosticResumeCard';
import { DiagnosticResultsAdapter } from '../DiagnosticResultsAdapter';
import { buildDefaultDiagnosticConfig } from '../../../../lib/study-plans/diagnostics/diagnosticConfig';
import { buildDiagnosticPriorEvidence } from '../../../../lib/study-plans/diagnostics/diagnosticPriorEvidence';
import { computeCurriculumPreferences } from '../../../../lib/study-plans/diagnostics/curriculumAdaptation';

vi.mock('../../../../api/exam-sessions', () => ({
  startExamAttempt: vi.fn(),
  getExamAttempt: vi.fn(),
  checkPracticeResponse: vi.fn(),
}));
vi.mock('../../../../api/assessment-blueprints', () => ({
  createAssessmentBlueprint: vi.fn(),
}));
vi.mock('../../../../api/learning-evidence', () => ({
  getDiagnosticPriorEvidence: vi.fn(),
}));

import { startExamAttempt } from '../../../../api/exam-sessions';
import { createAssessmentBlueprint } from '../../../../api/assessment-blueprints';

describe('C7-T03 diagnostic Take/Skip wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Skip creates no artifacts; Take builds/starts only on click with persisted results', async () => {
    const onTake = vi.fn();
    const onSkip = vi.fn();
    render(<DiagnosticChoice onTake={onTake} onSkip={onSkip} />);
    fireEvent.click(screen.getByTestId('diagnostic-skip'));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(startExamAttempt).not.toHaveBeenCalled();
    expect(createAssessmentBlueprint).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('diagnostic-take'));
    expect(onTake).toHaveBeenCalledTimes(1);
  });

  it('Take flow persists blueprint + attempt and restart restores resume card', async () => {
    vi.mocked(createAssessmentBlueprint).mockResolvedValueOnce({ revision: { id: 'abr_diag' } } as never);
    vi.mocked(startExamAttempt).mockResolvedValueOnce({ attempt: { id: 'ea_diag' } } as never);

    const started: string[] = [];
    const Harness: React.FC = () => {
      const [attemptId, setAttemptId] = useState<string | null>(null);
      return (
        <div>
          <DiagnosticGenerationPanel
            config={buildDefaultDiagnosticConfig()}
            status="idle"
            onStart={async () => {
              const bp = await createAssessmentBlueprint({} as never);
              const att = await startExamAttempt({
                blueprintRevisionId: (bp as never as { revision: { id: string } }).revision.id,
                clientStartKey: 'start_diag_1',
              });
              started.push((att as never as { attempt: { id: string } }).attempt.id);
              setAttemptId((att as never as { attempt: { id: string } }).attempt.id);
            }}
          />
          {attemptId && (
            <DiagnosticResumeCard
              attempt={{ id: attemptId } as never}
              onResume={async (id) => {
                started.push(`resume:${id}`);
              }}
            />
          )}
        </div>
      );
    };
    render(<Harness />);
    fireEvent.click(screen.getByTestId('diagnostic-start'));
    await waitFor(() => expect(createAssessmentBlueprint).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(startExamAttempt).toHaveBeenCalledTimes(1));
    expect(started).toEqual(['ea_diag']);
    // Restart reachability: resume card appears with persisted id
    expect(screen.getByTestId('diagnostic-resume')).toBeTruthy();
    fireEvent.click(screen.getByTestId('diagnostic-resume-button'));
    await waitFor(() => expect(started).toEqual(['ea_diag', 'resume:ea_diag']));
  });

  it('pending grading disables Apply; completed evidence applies to reviewable draft diff', async () => {
    const onApply = vi.fn();
    const onReject = vi.fn();
    const { rerender } = render(
      <DiagnosticResultsAdapter priorEvidence={null} onApply={onApply} onReject={onReject} />,
    );
    expect(screen.getByTestId('diagnostic-results-empty')).toBeTruthy();

    const detail = {
      attempt: { id: 'ea1', mode: 'diagnostic', status: 'complete', blueprintRevisionId: 'abr1' },
      currentGrades: [{ state: 'final', points: 1, maxPoints: 1, questionRevisionId: 'q1' }],
      questions: [{ id: 'q1', targets: [{ conceptId: 'c1' }] }],
    } as never;
    const prior = buildDiagnosticPriorEvidence(detail, { blueprintRevisionId: 'abr1' });
    rerender(
      <DiagnosticResultsAdapter
        priorEvidence={prior}
        hasPendingGrading
        onApply={onApply}
        onReject={onReject}
      />,
    );
    expect(screen.getByTestId('diagnostic-pending')).toBeTruthy();
    expect(screen.getByTestId('diagnostic-apply')).toBeDisabled();
    fireEvent.click(screen.getByTestId('diagnostic-reject'));
    expect(onReject).toHaveBeenCalledTimes(1);

    rerender(
      <DiagnosticResultsAdapter priorEvidence={prior} hasPendingGrading={false} onApply={onApply} />,
    );
    fireEvent.click(screen.getByTestId('diagnostic-apply'));
    expect(onApply).toHaveBeenCalledTimes(1);
    const prefs = computeCurriculumPreferences(
      [{ nodeId: 'n1', conceptId: 'c1', included: true, locked: false }] as never,
      prior,
    );
    expect(prefs).toHaveLength(1); // reviewable diff input, publish stays explicit
  });

  it('no earlier change imports diagnostic modules', async () => {
    const fs = await import('node:fs');
    const roots = [
      'src/components/study-plans/StudyPlanEditor.tsx',
      'src/components/study-plans/assessments/AssessmentBuilder.tsx',
      'src/lib/study-plans/generation/coordinator.ts',
    ];
    for (const r of roots) {
      const content = fs.readFileSync(r, 'utf8');
      expect(content).not.toMatch(/diagnostics\/(diagnosticConfig|diagnosticPriorEvidence|curriculumAdaptation)/);
    }
  });
});
